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
	Message   string `json:"message"`
}

func Audit(user, action, resource, namespace, cluster, message string) {
	if !common.LogEnableAudit || AuditLogger == nil {
		return
	}

	entry := AuditEntry{
		User:      user,
		Action:    action,
		Resource:  resource,
		Namespace: namespace,
		Cluster:   cluster,
		Timestamp: time.Now().In(time.Local).Format("2006-01-02 15:04:05"),
		Message:   message,
	}

	if common.LogFormat == "json" {
		b, _ := json.Marshal(entry)
		fmt.Fprintln(AuditLogger, string(b))
	} else {
		// User ssvd performed GET on /api/v1/admin/roles/ at 2026-02-10 23:08:47
		fmt.Fprintf(AuditLogger, "User %s performed %s on %s in %s/%s at %s: %s\n",
			entry.User, entry.Action, entry.Resource, entry.Cluster, entry.Namespace, entry.Timestamp, entry.Message)
	}
}
