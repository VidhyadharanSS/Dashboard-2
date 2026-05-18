package logger

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/common"
)

// AuditSeverity represents the severity level of an audit log entry.
type AuditSeverity string

const (
	AuditInfo     AuditSeverity = "INFO"
	AuditWarning  AuditSeverity = "WARN"
	AuditError    AuditSeverity = "ERROR"
	AuditCritical AuditSeverity = "CRITICAL"
)

type AuditEntry struct {
	Severity  string `json:"severity"`
	User      string `json:"user"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Name      string `json:"name,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Cluster   string `json:"cluster,omitempty"`
	Timestamp string `json:"timestamp"`
	Duration  string `json:"duration,omitempty"`
	Message   string `json:"message"`
	SourceIP  string `json:"sourceIP,omitempty"`
	Success   *bool  `json:"success,omitempty"`
}

// AuditOpts provides optional context for audit entries.
type AuditOpts struct {
	Duration time.Duration
	Severity AuditSeverity
	SourceIP string
	Name     string // Resource name (e.g. "my-deployment")
	Success  *bool
}

// Audit writes a structured audit log entry.
// The variadic opts parameter allows passing AuditOpts for enriched context.
func Audit(user, action, resource, namespace, cluster, message string, opts ...interface{}) {
	if !common.LogEnableAudit || AuditLogger == nil {
		return
	}

	entry := AuditEntry{
		Severity:  string(AuditInfo),
		User:      user,
		Action:    action,
		Resource:  resource,
		Namespace: namespace,
		Cluster:   cluster,
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Message:   message,
	}

	// Parse variadic arguments — supports both legacy `time.Duration` and new `AuditOpts`
	for _, opt := range opts {
		switch v := opt.(type) {
		case time.Duration:
			if v > 0 {
				entry.Duration = v.String()
			}
		case AuditOpts:
			if v.Duration > 0 {
				entry.Duration = v.Duration.String()
			}
			if v.Severity != "" {
				entry.Severity = string(v.Severity)
			}
			if v.SourceIP != "" {
				entry.SourceIP = v.SourceIP
			}
			if v.Name != "" {
				entry.Name = v.Name
			}
			if v.Success != nil {
				entry.Success = v.Success
			}
		}
	}

	if common.LogFormat == "json" {
		b, _ := json.Marshal(entry)
		fmt.Fprintln(AuditLogger, string(b))
	} else {
		durText := ""
		if entry.Duration != "" {
			durText = fmt.Sprintf("[%s] ", entry.Duration)
		}
		ipText := ""
		if entry.SourceIP != "" {
			ipText = fmt.Sprintf("IP: %-15s | ", entry.SourceIP)
		}
		nameText := ""
		if entry.Name != "" {
			nameText = fmt.Sprintf("Name: %-20s | ", entry.Name)
		}
		fmt.Fprintf(AuditLogger, "[%s] %-5s | User: %-12s | Action: %-8s | Resource: %-15s | %s%sCluster: %-10s | NS: %-10s | Msg: %s %s\n",
			entry.Timestamp, entry.Severity, entry.User, entry.Action, entry.Resource,
			ipText, nameText, entry.Cluster, entry.Namespace, entry.Message, durText)
	}
}

// AuditWithOpts is a convenience wrapper that writes an audit entry with rich options.
func AuditWithOpts(user, action, resource, namespace, cluster, message string, opts AuditOpts) {
	Audit(user, action, resource, namespace, cluster, message, opts)
}
