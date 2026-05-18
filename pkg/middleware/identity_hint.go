package middleware

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/zxh326/kite/pkg/common"
)

// identityHintClaims is a minimal claims struct — we only need the user identity
// for logging, not the full claims.
type identityHintClaims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// IdentityHint is a lightweight middleware that attempts to extract user identity
// from the JWT cookie WITHOUT enforcing authentication. It runs on ALL routes
// (including unauthenticated ones like /api/auth/providers, /api/v1/init_check,
// /api/auth/refresh) so that the access log can attribute requests to real users
// instead of logging "anonymous" for every unauthenticated endpoint.
//
// If the cookie is missing, expired, or invalid, the request proceeds normally
// — this middleware never rejects requests.
//
// The identity is stored under a separate context key ("identity_hint") so it
// does NOT interfere with the real "user" key that RequireAuth() sets.
func IdentityHint() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString, err := c.Cookie("auth_token")
		if err != nil || tokenString == "" {
			c.Next()
			return
		}

		// Parse the JWT without validating claims (we accept expired tokens
		// because we just want to know WHO made the request for logging).
		var claims identityHintClaims
		_, err = jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(common.JwtSecret), nil
		}, jwt.WithoutClaimsValidation())

		if err == nil && claims.Username != "" {
			c.Set("identity_hint", claims.Username)
		}

		c.Next()
	}
}

