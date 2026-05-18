package middleware

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
)

// skipAccessLogPaths are paths we skip from access log to reduce noise.
var skipAccessLogPaths = []string{
	"/healthz",
	"/metrics",
	"/favicon.ico",
}

type AccessLogEntry struct {
	IP           string `json:"ip"`
	Timestamp    string `json:"timestamp"`
	Method       string `json:"method"`
	Path         string `json:"path"`
	Status       int    `json:"status"`
	Latency      string `json:"latency"`
	LatencyMs    int64  `json:"latencyMs"`
	User         string `json:"user"`
	Cluster      string `json:"cluster,omitempty"`
	UserAgent    string `json:"userAgent,omitempty"`
	ResponseSize int    `json:"responseSize"`
}

func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.LogEnableAccess {
			c.Next()
			return
		}

		// Skip noisy paths
		path := c.Request.URL.Path
		for _, skip := range skipAccessLogPaths {
			if path == skip || strings.HasPrefix(path, skip) {
				c.Next()
				return
			}
		}

		start := time.Now().In(time.Local)
		c.Next()
		latency := time.Since(start)

		user := ""
		if v, ok := c.Get("user"); ok {
			if u, ok := v.(model.User); ok {
				if u.Email != "" {
					user = u.Email
				} else {
					user = u.Key()
				}
			}
		}
		// If no authenticated user was set (unauthenticated endpoints like
		// /api/auth/providers, /api/v1/init_check, /api/auth/refresh), try the
		// identity hint that was extracted from the JWT cookie by IdentityHint().
		if user == "" {
			if hint, ok := c.Get("identity_hint"); ok {
				user = hint.(string)
			}
		}
		// Final fallback — truly unauthenticated (no cookie at all)
		if user == "" {
			user = "unauthenticated"
		}

		clusterName := "-"
		if v, ok := c.Get(ClusterNameKey); ok {
			clusterName = v.(string)
		}

		entry := AccessLogEntry{
			IP:           c.ClientIP(),
			Timestamp:    start.Format("2006-01-02 15:04:05"),
			Method:       c.Request.Method,
			Path:         path,
			Status:       c.Writer.Status(),
			Latency:      latency.String(),
			LatencyMs:    latency.Milliseconds(),
			User:         user,
			Cluster:      clusterName,
			UserAgent:    c.Request.UserAgent(),
			ResponseSize: c.Writer.Size(),
		}

		if logger.AccessLogger != nil {
			if common.LogFormat == "json" {
				b, _ := json.Marshal(entry)
				fmt.Fprintln(logger.AccessLogger, string(b))
			} else {
				// Include response size and cluster in text format
				fmt.Fprintf(logger.AccessLogger, "%s - %s \"%s %s\" %d %s %dB [%s] - %s\n",
					entry.IP, entry.Timestamp, entry.Method, entry.Path,
					entry.Status, entry.Latency, entry.ResponseSize, entry.Cluster, entry.User)
			}
		}

		// Log slow requests to application log as warnings
		if latency > 5*time.Second {
			logger.App("WARN", "access", fmt.Sprintf("Slow request: %s %s took %s (user=%s, cluster=%s)",
				entry.Method, entry.Path, entry.Latency, entry.User, entry.Cluster))
		}
	}
}

