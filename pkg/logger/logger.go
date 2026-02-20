package logger

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"k8s.io/klog/v2"
)

// Rotator is a thread-safe io.Writer that rotates logs based on size
type Rotator struct {
	filename string
	maxSize  int64
	current  *os.File
	size     int64
	mu       sync.Mutex
}

func NewRotator(filename string, maxSizeMB int) (*Rotator, error) {
	if maxSizeMB <= 0 {
		maxSizeMB = 10 // Default 10MB
	}
	r := &Rotator{
		filename: filename,
		maxSize:  int64(maxSizeMB) * 1024 * 1024,
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

	if r.size+int64(len(p)) > r.maxSize {
		if err := r.rotate(); err != nil {
			fmt.Fprintf(os.Stderr, "failed to rotate log %s: %v\n", r.filename, err)
		}
	}

	n, err = r.current.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *Rotator) rotate() error {
	r.current.Close()

	backupName := fmt.Sprintf("%s.%s", r.filename, time.Now().Format("20060102150405"))
	if err := os.Rename(r.filename, backupName); err != nil {
		// If rename fails, try to reopen original to keep logging if possible
		_ = r.open()
		return err
	}

	return r.open()
}

func (r *Rotator) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current != nil {
		return r.current.Close()
	}
	return nil
}

var (
	AccessLogger      io.Writer
	AuditLogger       io.Writer
	ApplicationLogger io.Writer
)

func Init(logDir string, maxSizeMB int) error {
	// Set log timezone to IST
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		klog.Warningf("Failed to load Asia/Kolkata timezone: %v, falling back to system local", err)
	} else {
		time.Local = loc
		klog.Infof("Logger initialized with timezone: %s", loc.String())
	}

	AccessLogger, err = NewRotator(filepath.Join(logDir, "access.log"), maxSizeMB)
	if err != nil {
		return err
	}

	AuditLogger, err = NewRotator(filepath.Join(logDir, "audit.log"), maxSizeMB)
	if err != nil {
		return err
	}

	ApplicationLogger, err = NewRotator(filepath.Join(logDir, "application.log"), maxSizeMB)
	if err != nil {
		return err
	}

	// MultiWriter to also output to stdout for container logs visibility
	AccessLogger = io.MultiWriter(AccessLogger, os.Stdout)
	AuditLogger = io.MultiWriter(AuditLogger, os.Stdout)
	ApplicationLogger = io.MultiWriter(ApplicationLogger, os.Stdout)

	return nil
}
