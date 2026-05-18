package middleware

import (
	"github.com/gin-gonic/gin"
)

// SecurityHeaders adds security headers to prevent common attacks.
//
// Headers applied:
//   - X-Content-Type-Options: nosniff — prevents MIME-type sniffing
//   - X-Frame-Options: DENY — prevents clickjacking via iframes
//   - X-XSS-Protection: 0 — disable browser XSS filter (CSP is preferred, the
//     filter itself can create XSS vulnerabilities in certain edge cases)
//   - Content-Security-Policy — restricts where resources can be loaded from
//   - Referrer-Policy — controls referrer header leakage
//   - Permissions-Policy — disables unused browser features
//   - Strict-Transport-Security — enforces HTTPS for future visits
//   - Cross-Origin-Opener-Policy — isolates browsing context
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "0")
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()")
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		// HSTS: only set when behind TLS to avoid issues in local dev
		if c.Request.TLS != nil || c.Request.Header.Get("X-Forwarded-Proto") == "https" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}

