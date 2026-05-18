package middleware

import (
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
)

// CORS configures Cross-Origin Resource Sharing headers.
//
// When HOST is configured, only that origin is allowed. Otherwise, the request
// Origin is reflected — this is acceptable for internal dashboards that may be
// accessed from multiple URLs, but should be locked down via HOST in production.
func CORS() gin.HandlerFunc {
	// Pre-compute the allowed origin from the HOST env var
	var allowedOrigin string
	if common.Host != "" {
		// Extract scheme + host (drop trailing paths)
		if u, err := url.Parse(common.Host); err == nil && u.Scheme != "" {
			allowedOrigin = u.Scheme + "://" + u.Host
		} else {
			allowedOrigin = common.Host
		}
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		if allowedOrigin != "" {
			// Strict: only allow the configured host origin
			if strings.EqualFold(origin, allowedOrigin) {
				c.Writer.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			}
			// If origin doesn't match, no CORS header → browser blocks the request
		} else if origin != "" {
			// No HOST configured — reflect the origin for development flexibility
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Cluster-Name")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

