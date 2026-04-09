package logger

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/common"
)

type AuditEntry struct {
	User      string `json:"user"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace,omitempty"`
	Cluster   string `json:"cluster,omitempty"`
	Timestamp string `json:"timestamp"`
	Duration  string `json:"duration,omitempty"`
	Message   string `json:"message"`
}

func Audit(user, action, resource, namespace, cluster, message string, duration ...time.Duration) {
	if !common.LogEnableAudit || AuditLogger == nil {
		return
	}

	durStr := ""
	if len(duration) > 0 && duration[0] > 0 {
		durStr = duration[0].String()
	}

	entry := AuditEntry{
		User:      user,
		Action:    action,
		Resource:  resource,
		Namespace: namespace,
		Cluster:   cluster,
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Duration:  durStr,
		Message:   message,
	}

	if common.LogFormat == "json" {
		b, _ := json.Marshal(entry)
		fmt.Fprintln(AuditLogger, string(b))
	} else {
		durText := ""
		if entry.Duration != "" {
			durText = fmt.Sprintf("[%s] ", entry.Duration)
		}
		// Standardized audit format: [Timestamp] User: name | Action: verb | Resource: type | Msg: content [duration]
		fmt.Fprintf(AuditLogger, "[%s] User: %-10s | Action: %-8s | Resource: %-15s | Cluster: %-10s | NS: %-10s | Msg: %s %s\n",
			entry.Timestamp, entry.User, entry.Action, entry.Resource, entry.Cluster, entry.Namespace, entry.Message, durText)
	}
}