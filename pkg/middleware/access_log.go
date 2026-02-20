package middleware

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
)

type AccessLogEntry struct {
	IP        string `json:"ip"`
	Timestamp string `json:"timestamp"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	Latency   string `json:"latency"`
	User      string `json:"user"`
	Cluster   string `json:"cluster,omitempty"`
}

func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.LogEnableAccess {
			c.Next()
			return
		}

		start := time.Now().In(time.Local)
		c.Next()
		latency := time.Since(start)

		user := "anonymous"
		if v, ok := c.Get("user"); ok {
			if u, ok := v.(model.User); ok {
				if u.Email != "" {
					user = u.Email
				} else {
					user = u.Key()
				}
			}
		}

		clusterName := "-"
		if v, ok := c.Get(ClusterNameKey); ok {
			clusterName = v.(string)
		}

		entry := AccessLogEntry{
			IP:        c.ClientIP(),
			Timestamp: start.Format("2006-01-02 15:04:05"),
			Method:    c.Request.Method,
			Path:      c.Request.URL.Path,
			Status:    c.Writer.Status(),
			Latency:   latency.String(),
			User:      user,
			Cluster:   clusterName,
		}

		if logger.AccessLogger != nil {
			if common.LogFormat == "json" {
				b, _ := json.Marshal(entry)
				fmt.Fprintln(logger.AccessLogger, string(b))
			} else {
				fmt.Fprintf(logger.AccessLogger, "%s - %s \"%s %s\" %d %s - %s\n",
					entry.IP, entry.Timestamp, entry.Method, entry.Path, entry.Status, entry.Latency, entry.User)
			}
		}
	}
}
