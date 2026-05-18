package logger

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"k8s.io/klog/v2"
)

// Rotator is a thread-safe io.Writer that rotates logs based on size and
// cleans up old backup files beyond a configurable retention count.
type Rotator struct {
	filename     string
	maxSize      int64
	maxBackups   int
	current      *os.File
	size         int64
	mu           sync.Mutex
}

func NewRotator(filename string, maxSizeMB int) (*Rotator, error) {
	if maxSizeMB <= 0 {
		maxSizeMB = 10 // Default 10MB
	}
	r := &Rotator{
		filename:   filename,
		maxSize:    int64(maxSizeMB) * 1024 * 1024,
		maxBackups: 5, // Keep 5 most recent backups per log file
	}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Rotator) open() error {
	dir := filepath.Dir(r.filename)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	f, err := os.OpenFile(r.filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}

	r.current = f
	r.size = info.Size()
	return nil
}

func (r *Rotator) Write(p []byte) (n int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.current == nil {
		return 0, fmt.Errorf("logger %s: file handle is nil", r.filename)
	}

	if r.size+int64(len(p)) > r.maxSize {
		if err := r.rotate(); err != nil {
			fmt.Fprintf(os.Stderr, "failed to rotate log %s: %v\n", r.filename, err)
			// Still try to write to the current file even if rotation failed
		}
	}

	n, err = r.current.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *Rotator) rotate() error {
	if r.current != nil {
		r.current.Close()
	}

	backupName := fmt.Sprintf("%s.%s", r.filename, time.Now().Format("20060102150405"))
	if err := os.Rename(r.filename, backupName); err != nil {
		// If rename fails, try to reopen original to keep logging if possible
		_ = r.open()
		return err
	}

	if err := r.open(); err != nil {
		return err
	}

	// Clean up old backups beyond retention limit in a goroutine to avoid blocking writes
	go r.cleanOldBackups()
	return nil
}

// cleanOldBackups removes rotated backup files beyond maxBackups retention count.
func (r *Rotator) cleanOldBackups() {
	if r.maxBackups <= 0 {
		return
	}

	dir := filepath.Dir(r.filename)
	base := filepath.Base(r.filename)
	prefix := base + "."

	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	var backups []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, prefix) && !entry.IsDir() {
			backups = append(backups, filepath.Join(dir, name))
		}
	}

	if len(backups) <= r.maxBackups {
		return
	}

	// Sort ascending (oldest first) — backup names contain timestamps so lexicographic sort works
	sort.Strings(backups)

	// Remove oldest backups beyond retention
	toRemove := backups[:len(backups)-r.maxBackups]
	for _, path := range toRemove {
		if err := os.Remove(path); err != nil {
			fmt.Fprintf(os.Stderr, "failed to remove old log backup %s: %v\n", path, err)
		}
	}
}

func (r *Rotator) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current != nil {
		return r.current.Close()
	}
	return nil
}

// safeMultiWriter wraps io.MultiWriter with a mutex so concurrent writes to
// the underlying writers (Rotator + os.Stdout) are not interleaved.
type safeMultiWriter struct {
	mu      sync.Mutex
	writers []io.Writer
}

func newSafeMultiWriter(writers ...io.Writer) io.Writer {
	return &safeMultiWriter{writers: writers}
}

func (w *safeMultiWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, writer := range w.writers {
		n, err = writer.Write(p)
		if err != nil {
			return
		}
		if n != len(p) {
			err = io.ErrShortWrite
			return
		}
	}
	return len(p), nil
}

var (
	AccessLogger      io.Writer
	AuditLogger       io.Writer
	ApplicationLogger io.Writer
	SecurityLogger    io.Writer
)

// App writes a structured application-level log entry.
// Severity should be one of: INFO, WARN, ERROR.
func App(severity, component, message string) {
	if ApplicationLogger == nil {
		return
	}
	ts := time.Now().Format("2006-01-02 15:04:05")
	fmt.Fprintf(ApplicationLogger, "[%s] %-5s [%s] %s\n", ts, severity, component, message)
}

// Security writes a security-sensitive log entry (auth failures, RBAC denials, suspicious activity).
func Security(user, event, detail string) {
	logger := SecurityLogger
	if logger == nil {
		logger = AuditLogger // fallback to audit logger
	}
	if logger == nil {
		return
	}
	ts := time.Now().Format("2006-01-02 15:04:05")
	fmt.Fprintf(logger, "[%s] SECURITY | User: %-15s | Event: %-20s | %s\n", ts, user, event, detail)
}

func Init(logDir string, maxSizeMB int) error {
	// Set log timezone to IST
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		klog.Warningf("Failed to load Asia/Kolkata timezone: %v, falling back to system local", err)
	} else {
		time.Local = loc
		klog.Infof("Logger initialized with timezone: %s", loc.String())
	}

	accessRotator, err := NewRotator(filepath.Join(logDir, "access.log"), maxSizeMB)
	if err != nil {
		return fmt.Errorf("failed to initialize access logger: %w", err)
	}

	auditRotator, err := NewRotator(filepath.Join(logDir, "audit.log"), maxSizeMB)
	if err != nil {
		return fmt.Errorf("failed to initialize audit logger: %w", err)
	}

	appRotator, err := NewRotator(filepath.Join(logDir, "application.log"), maxSizeMB)
	if err != nil {
		return fmt.Errorf("failed to initialize application logger: %w", err)
	}

	var secRotator *Rotator
	secRotator, err = NewRotator(filepath.Join(logDir, "security.log"), maxSizeMB)
	if err != nil {
		// Non-fatal: fall back to audit log
		klog.Warningf("Failed to initialize security log, falling back to audit log: %v", err)
		secRotator = nil
	}

	// Use thread-safe multi-writer to also output to stdout for container logs visibility.
	// The safeMultiWriter wraps writes in a mutex so concurrent goroutines do not interleave
	// their output across the rotator + stdout pair.
	AccessLogger = newSafeMultiWriter(accessRotator, os.Stdout)
	AuditLogger = newSafeMultiWriter(auditRotator, os.Stdout)
	ApplicationLogger = newSafeMultiWriter(appRotator, os.Stdout)
	if secRotator != nil {
		SecurityLogger = newSafeMultiWriter(secRotator, os.Stdout)
	}

	App("INFO", "logger", fmt.Sprintf("Logging system initialized — logDir=%s maxSizeMB=%d timezone=%s", logDir, maxSizeMB, time.Local.String()))

	return nil
}

