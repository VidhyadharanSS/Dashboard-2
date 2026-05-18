package auth

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"k8s.io/klog/v2"
)

type AuthHandler struct {
	manager *OAuthManager
}

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{
		manager: NewOAuthManager(),
	}
}

func (h *AuthHandler) GetProviders(c *gin.Context) {
	providers := h.manager.GetAvailableProviders()
	// Only include the password provider when it has not been disabled
	// via the DISABLE_PASSWORD_LOGIN env var or runtime admin setting.
	if !isPasswordLoginDisabled() {
		providers = append(providers, "password")
	}
	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

// isPasswordLoginDisabled returns true when password login is turned off by
// either the environment variable or a runtime database setting.
func isPasswordLoginDisabled() bool {
	return common.DisablePasswordLogin || model.IsPasswordLoginDisabled()
}

func (h *AuthHandler) Login(c *gin.Context) {
	provider := c.Query("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"message": "Provider parameter is required",
		})
		return
	}

	oauthProvider, err := h.manager.GetProvider(c, provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"message": err.Error(),
		})
		return
	}

	// Defensive: clear any stale oauth cookies from previously-aborted flows
	// before issuing fresh ones. This avoids a race where the browser holds on
	// to a state cookie from an earlier (interrupted) login attempt that was
	// set with a different Secure/Path attribute and would otherwise shadow
	// the new one — a known cause of intermittent first-attempt failures
	// where a hard refresh + retry "magically" works.
	setCookieSecure(c, "oauth_state", "", -1)
	setCookieSecure(c, "oauth_provider", "", -1)

	state := h.manager.GenerateState()

	klog.V(1).Infof("OAuth Login - Provider: %s, State: %s", provider, state)

	// Store state and provider in cookies with SameSite=Lax and Secure when appropriate.
	// Use a generous max age (15 minutes) so that slow auth provider flows
	// (MFA, consent screens, etc.) don't expire the state cookie before the
	// callback arrives.
	setCookieSecure(c, "oauth_state", state, 900)
	setCookieSecure(c, "oauth_provider", provider, 900)

	authURL := oauthProvider.GetAuthURL(state)
	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
		"provider": provider,
	})
}

func (h *AuthHandler) PasswordLogin(c *gin.Context) {
	if isPasswordLoginDisabled() {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Password login is disabled. Please use an OAuth provider.",
		})
		return
	}

	var req common.PasswordLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	// Normalize username to prevent leading/trailing whitespace bypass
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username is required"})
		return
	}

	user, err := model.GetUserByIdentifier(req.Username)
	if err != nil {
		// Use a generic message to not reveal whether the user exists
		logger.Security(req.Username, "LOGIN_FAILED_UNKNOWN_USER",
			fmt.Sprintf("ip=%s ua=%s", c.ClientIP(), c.Request.UserAgent()))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	if !model.CheckPassword(user.Password, req.Password) {
		logger.Security(user.Key(), "LOGIN_FAILED_BAD_PASSWORD",
			fmt.Sprintf("ip=%s ua=%s", c.ClientIP(), c.Request.UserAgent()))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	if !user.Enabled {
		logger.Security(user.Key(), "LOGIN_FAILED_DISABLED",
			fmt.Sprintf("ip=%s ua=%s", c.ClientIP(), c.Request.UserAgent()))
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is disabled. Contact your administrator."})
		return
	}

	if err := model.LoginUser(user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed login"})
		return
	}

	jwtToken, err := h.manager.GenerateJWT(user, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate JWT"})
		return
	}

	setCookieSecure(c, "auth_token", jwtToken, common.CookieExpirationSeconds)

	// Create a session record so it shows up in session management
	session := &model.UserSession{
		UserID:     user.ID,
		Token:      jwtToken,
		IP:         c.ClientIP(),
		UserAgent:  c.Request.UserAgent(),
		LastUsedAt: time.Now(),
		ExpiresAt:  time.Now().Add(time.Duration(common.CookieExpirationSeconds) * time.Second),
	}
	_ = model.CreateUserSession(session)

	logger.Audit(user.Key(), "Login", "User", "", "", "User logged in with password")

	c.Status(http.StatusNoContent)
}

// getLoginRedirectPath returns the appropriate login/setup path based on
// whether the application has been fully initialized.
func getLoginRedirectPath() string {
	uc, _ := model.CountUsers()
	cc, _ := model.CountClusters()
	if uc == 0 || cc == 0 {
		return "/setup"
	}
	return "/login"
}

func (h *AuthHandler) Callback(c *gin.Context) {
	base := common.Base
	code := c.Query("code")
	loginPath := getLoginRedirectPath()

	// Detect whether the OAuth provider itself returned an error
	// (e.g. user denied consent). Surface it instead of failing on
	// the cookie checks below.
	if providerErr := c.Query("error"); providerErr != "" {
		providerErrDesc := c.Query("error_description")
		klog.Warningf("OAuth Callback - provider returned error: %s (%s)", providerErr, providerErrDesc)
		setCookieSecure(c, "oauth_state", "", -1)
		setCookieSecure(c, "oauth_provider", "", -1)
		c.Redirect(http.StatusFound, base+loginPath+"?error=provider_error&reason=provider_error")
		return
	}

	provider, err := c.Cookie("oauth_provider")
	if err != nil || provider == "" {
		klog.Errorf("OAuth Callback - No provider found in cookie (likely stale session, blocked cookies, or browser back-button): %v. ip=%s ua=%s", err, c.ClientIP(), c.Request.UserAgent())
		// Clean any partial state and redirect with a recoverable error so
		// the UI can prompt the user to retry.
		setCookieSecure(c, "oauth_state", "", -1)
		setCookieSecure(c, "oauth_provider", "", -1)
		c.Redirect(http.StatusFound, base+loginPath+"?error=session_expired&reason=no_provider_in_cookie")
		return
	}

	stateParam := c.Query("state")
	cookieState, stateErr := c.Cookie("oauth_state")

	klog.V(1).Infof("OAuth Callback - Using provider: %s\n", provider)

	// Validate state to protect against CSRF and authorization code injection
	if stateErr != nil || stateParam == "" || cookieState == "" || stateParam != cookieState {
		klog.Warningf("OAuth Callback - state mismatch or missing (cookieStatePresent=%t, stateParamPresent=%t, err=%v, ip=%s)",
			cookieState != "", stateParam != "", stateErr, c.ClientIP())
		// Clear oauth cookies
		setCookieSecure(c, "oauth_state", "", -1)
		setCookieSecure(c, "oauth_provider", "", -1)
		c.Redirect(http.StatusFound, base+loginPath+"?error=session_expired&reason=state_mismatch")
		return
	}

	// Clear oauth cookies now that state is validated
	setCookieSecure(c, "oauth_state", "", -1)
	setCookieSecure(c, "oauth_provider", "", -1)

	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Authorization code not provided",
		})
		return
	}

	// Get the OAuth provider
	oauthProvider, err := h.manager.GetProvider(c, provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Provider not found: " + provider,
		})
		return
	}

	klog.V(1).Infof("OAuth Callback - Exchanging code for token with provider: %s", provider)
	// Exchange code for token
	tokenResp, err := oauthProvider.ExchangeCodeForToken(code)
	if err != nil {
		c.Redirect(http.StatusFound, base+loginPath+"?error=token_exchange_failed&reason=token_exchange_failed&provider="+provider)
		return
	}

	klog.V(1).Infof("OAuth Callback - Getting user info with provider: %s", provider)
	// Get user info
	user, err := oauthProvider.GetUserInfo(tokenResp.AccessToken)
	if err != nil {
		c.Redirect(http.StatusFound, base+loginPath+"?error=user_info_failed&reason=user_info_failed&provider="+provider)
		return
	}

	if user.Sub == "" {
		c.Redirect(http.StatusFound, base+loginPath+"?error=user_info_failed&reason=user_info_failed&provider="+provider)
		return
	}

	if err := model.FindWithSubOrUpsertUser(user); err != nil {
		c.Redirect(http.StatusFound, base+loginPath+"?error=user_upsert_failed&reason=user_upsert_failed&provider="+provider)
		return
	}
	klog.V(1).Infof("OAuth Callback - User details: Username=%s, Name=%s, Sub=%s, Email=%s, OIDCGroups=%v",
		user.Username, user.Name, user.Sub, user.Email, user.OIDCGroups)

	// --- Superadmin auto-promotion ---
	// If a configured superadmin email list is present and this user's email matches,
	// ensure they have the admin role. This supports the OAuth-first bootstrap
	// flow where the first admin is configured via environment variable.
	if common.IsConfiguredSuperAdminEmail(user.Email) {
		if !rbac.UserHasRole(*user, "admin") {
			klog.Infof("OAuth Callback - Auto-promoting superadmin: %s (%s)", user.Email, user.Key())
			if err := model.AddRoleAssignment("admin", model.SubjectTypeUser, user.Username); err != nil {
				klog.Errorf("Failed to auto-assign admin role to %s: %v", user.Email, err)
			} else {
				// Trigger async RBAC reload for future requests
				rbac.SyncNow <- struct{}{}
				// Set the admin role directly on the user struct so the
				// GetUserRoles check below sees it immediately, avoiding
				// a race with the async RBAC sync goroutine.
				user.Roles = []common.Role{{
					Name:       model.DefaultAdminRole.Name,
					Clusters:   model.DefaultAdminRole.Clusters,
					Resources:  model.DefaultAdminRole.Resources,
					Namespaces: model.DefaultAdminRole.Namespaces,
					Verbs:      model.DefaultAdminRole.Verbs,
				}}
				logger.Audit(user.Key(), "AutoPromoteSuperAdmin", "User", "", "",
					fmt.Sprintf("Auto-promoted %s to admin via configured superadmin email list", user.Email),
					logger.AuditOpts{Severity: logger.AuditCritical, SourceIP: c.ClientIP()})
			}
		}
	}

	role := rbac.GetUserRoles(*user)
	if len(role) == 0 {
		klog.Warningf("OAuth Callback - Access denied for user: %s (provider: %s), Username: %s, Name: %s, Sub: %s, OIDCGroups: %v",
			user.Key(), provider, user.Username, user.Name, user.Sub, user.OIDCGroups)
		c.Redirect(http.StatusFound, base+loginPath+"?error=insufficient_permissions&reason=insufficient_permissions&user="+user.Key()+"&provider="+provider)
		return
	}
	if !user.Enabled {
		c.Redirect(http.StatusFound, base+loginPath+"?error=user_disabled&reason=user_disabled")
		return
	}

	// Generate JWT with refresh token support
	jwtToken, err := h.manager.GenerateJWT(user, tokenResp.RefreshToken)
	if err != nil {
		c.Redirect(http.StatusFound, base+loginPath+"?error=jwt_generation_failed&reason=jwt_generation_failed&user="+user.Key()+"&provider="+provider)
		return
	}

	// Set JWT as HTTP-only cookie with secure/samesite settings
	setCookieSecure(c, "auth_token", jwtToken, common.CookieExpirationSeconds)

	// Create a session record for OAuth logins too
	session := &model.UserSession{
		UserID:     user.ID,
		Token:      jwtToken,
		IP:         c.ClientIP(),
		UserAgent:  c.Request.UserAgent(),
		LastUsedAt: time.Now(),
		ExpiresAt:  time.Now().Add(time.Duration(common.CookieExpirationSeconds) * time.Second),
	}
	_ = model.CreateUserSession(session)

	logger.Audit(user.Key(), "Login", "User", "", "", fmt.Sprintf("OAuth login via %s", provider),
		logger.AuditOpts{SourceIP: c.ClientIP()})

	c.Redirect(http.StatusFound, base+"/")
}

func (h *AuthHandler) Logout(c *gin.Context) {
	setCookieSecure(c, "auth_token", "", -1)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Logged out successfully",
	})
}

func (h *AuthHandler) GetUser(c *gin.Context) {
	user, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Not authenticated",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": user,
	})
}

func (h *AuthHandler) RequireAPIKeyAuth(c *gin.Context, token string) {
	keyPart := strings.SplitN(token, "-", 2)
	if len(keyPart) < 2 {
		h.rejectAPIKey(c, "")
		return
	}
	id := keyPart[0]
	key := keyPart[1]
	dbID, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		h.rejectAPIKey(c, "")
		return
	}
	apikey, err := model.GetUserByID(dbID)
	if err != nil {
		h.rejectAPIKey(c, "")
		return
	}
	// Use constant-time comparison to prevent timing attacks on API keys
	if !utils.SecureCompare(key, string(apikey.APIKey)) {
		h.rejectAPIKey(c, apikey.Key())
		return
	}
	if !apikey.Enabled {
		h.rejectAPIKey(c, apikey.Key())
		return
	}
	_ = model.LoginUser(apikey)
	now := time.Now()
	apikey.LastUsedAt = &now
	_ = model.DB.Model(apikey).Update("last_used_at", now)
	apikey.Roles = rbac.GetUserRoles(*apikey)
	c.Set("user", *apikey)
}

// rejectAPIKey sends a uniform unauthorized response for API key failures.
// Uses a generic message to avoid leaking which part of the key was wrong.
func (h *AuthHandler) rejectAPIKey(c *gin.Context, username string) {
	if username != "" {
		logger.Security(username, "API_KEY_REJECTED",
			fmt.Sprintf("ip=%s ua=%s", c.ClientIP(), c.Request.UserAgent()))
	}
	c.JSON(http.StatusUnauthorized, gin.H{
		"error": "Invalid API key",
	})
	c.Abort()
}

// resolveUserFromJWT validates a JWT token string, refreshing it if needed,
// and returns the corresponding database User. Returns (nil, false) on any failure.
func (h *AuthHandler) resolveUserFromJWT(c *gin.Context, tokenString string) (*model.User, bool) {
	claims, err := h.manager.ValidateJWT(tokenString)
	if err != nil {
		// Token may be expired — try to refresh.
		refreshedToken, refreshErr := h.manager.RefreshJWT(c, tokenString)
		if refreshErr != nil {
			return nil, false
		}
		setCookieSecure(c, "auth_token", refreshedToken, common.CookieExpirationSeconds)
		claims, err = h.manager.ValidateJWT(refreshedToken)
		if err != nil {
			return nil, false
		}
	}
	user, err := model.GetUserByID(uint64(claims.UserID))
	if err != nil || !user.Enabled {
		return nil, false
	}
	return user, true
}

func (h *AuthHandler) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// --- API Key authentication (highest priority) ---
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			if after, ok := strings.CutPrefix(authHeader, "kite"); ok {
				h.RequireAPIKeyAuth(c, after)
				return
			}
		}

		// --- JWT authentication (cookie-based) ---
		// Always attempt JWT auth first, even when anonymous mode is enabled.
		// This ensures that logged-in users are correctly identified in audit
		// logs and RBAC, rather than being silently downgraded to "anonymous".
		tokenString, _ := c.Cookie("auth_token")
		if tokenString != "" {
			if user, ok := h.resolveUserFromJWT(c, tokenString); ok {
				user.Roles = rbac.GetUserRoles(*user)
				now := time.Now()
				user.LastUsedAt = &now
				_ = model.DB.Model(user).Update("last_used_at", now)
				_ = model.UpdateUserSessionActivity(tokenString, c.ClientIP())
				c.Set("user", *user)
				c.Next()
				return
			}
			// JWT was present but invalid/expired — if anonymous mode is NOT
			// enabled we must reject; if it IS enabled we fall through below.
			if !common.AnonymousUserEnabled {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid or expired token",
				})
				setCookieSecure(c, "auth_token", "", -1)
				c.Abort()
				return
			}
			// Clear the stale cookie so the browser doesn't keep sending it.
			setCookieSecure(c, "auth_token", "", -1)
		}

		// --- Anonymous fallback ---
		if common.AnonymousUserEnabled {
			u := model.GetAnonymousUser()
			if u == nil {
				c.Set("user", model.AnonymousUser)
			} else {
				u.Roles = model.AnonymousUser.Roles
				c.Set("user", *u)
			}
			c.Next()
			return
		}

		// No token, no anonymous — reject.
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid or expired token",
		})
		c.Abort()
	}
}

func (h *AuthHandler) RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, exists := c.Get("user")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Not authenticated",
			})
			c.Abort()
			return
		}

		u := user.(model.User)
		if !rbac.UserHasRole(u, model.DefaultAdminRole.Name) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Admin role required",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	// Get token from cookie
	tokenString, err := c.Cookie("auth_token")
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No token found",
		})
		return
	}

	// Refresh the token
	newToken, err := h.manager.RefreshJWT(c, tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Failed to refresh token",
		})
		return
	}

	// Update the cookie with the new token
	setCookieSecure(c, "auth_token", newToken, common.CookieExpirationSeconds)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Token refreshed successfully",
	})
}

// --- Authentication Settings API ---

// AuthSettings is the response/request shape for auth configuration.
type AuthSettings struct {
	PasswordLoginDisabled bool `json:"passwordLoginDisabled"`
	// EnvLocked is true when the setting was forced by an environment variable
	// and cannot be changed at runtime.
	PasswordLoginEnvLocked bool `json:"passwordLoginEnvLocked"`
}

// GetAuthSettings returns the current authentication configuration.
func (h *AuthHandler) GetAuthSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"settings": AuthSettings{
			PasswordLoginDisabled:  isPasswordLoginDisabled(),
			PasswordLoginEnvLocked: common.DisablePasswordLogin,
		},
	})
}

// UpdateAuthSettings allows admins to toggle password login at runtime.
func (h *AuthHandler) UpdateAuthSettings(c *gin.Context) {
	var req AuthSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	// Refuse to override if the env var has locked it
	if common.DisablePasswordLogin {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Password login is disabled by the DISABLE_PASSWORD_LOGIN environment variable and cannot be changed at runtime.",
		})
		return
	}

	val := "false"
	if req.PasswordLoginDisabled {
		val = "true"
	}
	if err := model.SetSetting(model.SettingPasswordLoginDisabled, val); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save setting"})
		return
	}

	user, _ := c.Get("user")
	u := user.(model.User)
	action := "Enabled"
	if req.PasswordLoginDisabled {
		action = "Disabled"
	}
	logger.Audit(u.Key(), "Update", "AuthSettings", "", "password_login",
		fmt.Sprintf("%s password login", action))

	c.JSON(http.StatusOK, gin.H{
		"settings": AuthSettings{
			PasswordLoginDisabled:  isPasswordLoginDisabled(),
			PasswordLoginEnvLocked: common.DisablePasswordLogin,
		},
		"message": fmt.Sprintf("Password login %s successfully", strings.ToLower(action)),
	})
}

// OAuth Provider Management APIs

func (h *AuthHandler) ListOAuthProviders(c *gin.Context) {
	providers, err := model.GetAllOAuthProviders()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to retrieve OAuth providers",
		})
		return
	}

	// Don't expose client secrets in the response
	for i := range providers {
		providers[i].ClientSecret = "***"
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

func (h *AuthHandler) CreateOAuthProvider(c *gin.Context) {
	var provider model.OAuthProvider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request payload: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if provider.Name == "" || provider.ClientID == "" || string(provider.ClientSecret) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Name, ClientID, and ClientSecret are required",
		})
		return
	}

	if err := model.CreateOAuthProvider(&provider); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create OAuth provider: " + err.Error(),
		})
		return
	}

	// Note: Providers are now loaded dynamically from database, no reload needed

	// Don't expose client secret in response
	provider.ClientSecret = "***"
	c.JSON(http.StatusCreated, gin.H{
		"provider": provider,
	})
}

func (h *AuthHandler) UpdateOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	var provider model.OAuthProvider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request payload: " + err.Error(),
		})
		return
	}

	// Parse ID and set it
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}
	provider.ID = uint(dbID)

	// Validate required fields
	if provider.Name == "" || provider.ClientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Name and ClientID are required",
		})
		return
	}

	updates := map[string]interface{}{
		"name":          provider.Name,
		"client_id":     provider.ClientID,
		"auth_url":      provider.AuthURL,
		"token_url":     provider.TokenURL,
		"user_info_url": provider.UserInfoURL,
		"scopes":        provider.Scopes,
		"issuer":        provider.Issuer,
		"enabled":       provider.Enabled,
	}
	if provider.ClientSecret != "" {
		updates["client_secret"] = provider.ClientSecret
	}

	if err := model.UpdateOAuthProvider(&provider, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update OAuth provider: " + err.Error(),
		})
		return
	}
	// Don't expose client secret in response
	provider.ClientSecret = "***"
	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
	})
}

func (h *AuthHandler) DeleteOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}

	if err := model.DeleteOAuthProvider(uint(dbID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete OAuth provider: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "OAuth provider deleted successfully",
	})
}

func (h *AuthHandler) GetOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}

	var provider model.OAuthProvider
	if err := model.DB.First(&provider, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "OAuth provider not found",
		})
		return
	}

	provider.ClientSecret = "***"
	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
	})
}

// setCookieSecure sets a cookie with SameSite=Lax and HttpOnly=true. It marks Secure=true
// when the request is over TLS or X-Forwarded-Proto indicates https, or when
// common.Host appears to be an https scheme.
func setCookieSecure(c *gin.Context, name, value string, maxAge int) {
	// Determine if secure should be set
	secure := strings.HasPrefix(common.Host, "https://") || (c.Request != nil && (c.Request.TLS != nil || strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")))

	// Set SameSite to Lax for OAuth flows while still providing CSRF protection
	c.SetSameSite(http.SameSiteLaxMode)
	// Cookie maxAge should match the JWT expiration — not exceed it.
	// Previously this was maxAge + 1h which allowed sending expired JWTs.
	c.SetCookie(name, value, maxAge, "/", "", secure, true)
}

