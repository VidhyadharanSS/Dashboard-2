package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimitEntry tracks request counts for a single client.
type rateLimitEntry struct {
	count     int
	windowEnd time.Time
}

// RateLimiter provides a simple in-memory sliding window rate limiter per client IP.
// For production clusters behind a load balancer, consider a Redis-backed approach.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateLimitEntry
	limit   int           // max requests per window
	window  time.Duration // window duration
}

// NewRateLimiter creates a rate limiter allowing `limit` requests per `window` duration.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		entries: make(map[string]*rateLimitEntry),
		limit:   limit,
		window:  window,
	}
	// Periodically clean up expired entries to prevent memory leaks
	go func() {
		ticker := time.NewTicker(window * 2)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for key, entry := range rl.entries {
		if now.After(entry.windowEnd) {
			delete(rl.entries, key)
		}
	}
}

// Allow returns true if the request from `key` should be permitted.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	entry, exists := rl.entries[key]
	if !exists || now.After(entry.windowEnd) {
		rl.entries[key] = &rateLimitEntry{
			count:     1,
			windowEnd: now.Add(rl.window),
		}
		return true
	}

	entry.count++
	return entry.count <= rl.limit
}

// LoginRateLimit returns a middleware that limits login attempts per IP.
// Default: 10 attempts per 5 minutes per IP.
func LoginRateLimit() gin.HandlerFunc {
	limiter := NewRateLimiter(10, 5*time.Minute)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !limiter.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many login attempts. Please try again later.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// APIRateLimit returns a general API rate limiter middleware.
// Default: 100 requests per minute per IP.
func APIRateLimit() gin.HandlerFunc {
	limiter := NewRateLimiter(100, 1*time.Minute)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !limiter.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

