package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"k8s.io/klog/v2"
)

const (
	JWTExpirationSeconds = 24 * 60 * 60 // 24 hours

	NodeTerminalPodName = "kite-node-terminal-agent"

	KubectlAnnotation = "kubectl.kubernetes.io/last-applied-configuration"

	// db connection max idle time
	DBMaxIdleTime  = 10 * time.Minute
	DBMaxOpenConns = 100
	DBMaxIdleConns = 10
)

var (
	Port            = "8081"
	JwtSecret       = "kite-default-jwt-secret-key-change-in-production"
	EnableAnalytics = false
	Host            = ""
	Base            = ""

	NodeTerminalImage = "busybox:latest"
	DBType            = "sqlite"
	DBDSN             = "dev.db"

	KiteEncryptKey = "kite-default-encryption-key-change-in-production"

	AnonymousUserEnabled = false

	CookieExpirationSeconds = JWTExpirationSeconds // Match JWT lifetime

	DisableGZIP           = true
	DisableVersionCheck   = false
	DisablePasswordLogin  = false

	APIKeyProvider = "api_key"

	LogDir           = "logs"
	LogFormat        = "text" // "text" or "json"
	LogMaxSizeMB     = 10
	LogLevel         = "info"
	LogEnableAccess  = true
	LogEnableAudit   = true

	// --- OAuth Bootstrap Configuration ---
	// When set, the application bootstraps the first superadmin via OAuth instead
	// of the traditional username/password initialization flow.
	// KITE_SUPERADMIN_EMAILS / KITE_SUPERADMIN_EMAIL: comma-separated superadmin emails
	// auto-promoted on OAuth login.
	SuperAdminEmails = []string{}

	// KITE_OAUTH_BOOTSTRAP_*: Pre-configure a Zoho (or other) OAuth provider at startup
	// so that OAuth login is available before any admin has logged in.
	OAuthBootstrapName         = ""
	OAuthBootstrapClientID     = ""
	OAuthBootstrapClientSecret = ""
	OAuthBootstrapIssuer       = ""
	OAuthBootstrapAuthURL      = ""
	OAuthBootstrapTokenURL     = ""
	OAuthBootstrapUserInfoURL  = ""
	OAuthBootstrapScopes       = "openid,profile,email"

	// InsecureDevMode allows running without KITE_ENCRYPT_KEY for local development.
	// In production, the app refuses to start without a proper encryption key.
	InsecureDevMode = false
)

func LoadEnvs() {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		JwtSecret = secret
	}

	if port := os.Getenv("PORT"); port != "" {
		Port = port
	}

	if analytics := os.Getenv("ENABLE_ANALYTICS"); analytics == "true" {
		EnableAnalytics = true
	}

	if nodeTerminalImage := os.Getenv("NODE_TERMINAL_IMAGE"); nodeTerminalImage != "" {
		NodeTerminalImage = nodeTerminalImage
	}

	if dbDSN := os.Getenv("DB_DSN"); dbDSN != "" {
		DBDSN = dbDSN
	}

	if dbType := os.Getenv("DB_TYPE"); dbType != "" {
		if dbType != "sqlite" && dbType != "mysql" && dbType != "postgres" {
			klog.Fatalf("Invalid DB_TYPE: %s, must be one of sqlite, mysql, postgres", dbType)
		}
		DBType = dbType
	}

	if key := os.Getenv("KITE_ENCRYPT_KEY"); key != "" {
		KiteEncryptKey = key
	}
	// NOTE: If KITE_ENCRYPT_KEY is empty, the fatal check at the bottom of
	// LoadEnvs() will terminate the process unless KITE_INSECURE_DEV=true.

	if v := os.Getenv("ANONYMOUS_USER_ENABLED"); v == "true" {
		AnonymousUserEnabled = true
		klog.Warningf("Anonymous user is enabled, this is not secure for production!")
	}
	if v := os.Getenv("HOST"); v != "" {
		Host = v
	}
	if v := os.Getenv("DISABLE_GZIP"); v != "" {
		DisableGZIP = v == "true"
	}

	if v := os.Getenv("DISABLE_VERSION_CHECK"); v == "true" {
		DisableVersionCheck = true
	}

	if v := os.Getenv("DISABLE_PASSWORD_LOGIN"); v == "true" {
		DisablePasswordLogin = true
		klog.Info("Password login is disabled via environment variable")
	}

	if v := os.Getenv("KITE_BASE"); v != "" {
		if v[0] != '/' {
			v = "/" + v
		}
		Base = strings.TrimRight(v, "/")
		klog.Infof("Using base path: %s", Base)
	}

	if v := os.Getenv("LOG_DIR"); v != "" {
		LogDir = v
	}
	if v := os.Getenv("LOG_FORMAT"); v == "json" {
		LogFormat = "json"
	}
	if v := os.Getenv("LOG_MAX_SIZE_MB"); v != "" {
		if val, err := strconv.Atoi(v); err == nil {
			LogMaxSizeMB = val
		}
	}
	// For simplicity, just handling major ones
	if v := os.Getenv("LOG_ENABLE_ACCESS"); v == "false" {
		LogEnableAccess = false
	}
	if v := os.Getenv("LOG_ENABLE_AUDIT"); v == "false" {
		LogEnableAudit = false
	}

	// --- OAuth Bootstrap ---
	if v := firstNonEmptyEnv("KITE_SUPERADMIN_EMAILS", "KITE_SUPERADMIN_EMAIL"); v != "" {
		SuperAdminEmails = parseEmailList(v)
		if len(SuperAdminEmails) > 0 {
			klog.Infof("Superadmin emails configured: %s", strings.Join(SuperAdminEmails, ", "))
		}
	}

	OAuthBootstrapName = os.Getenv("KITE_OAUTH_BOOTSTRAP_NAME")
	OAuthBootstrapClientID = os.Getenv("KITE_OAUTH_BOOTSTRAP_CLIENT_ID")
	OAuthBootstrapClientSecret = os.Getenv("KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET")
	if encryptedSecret := os.Getenv("KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET_ENCRYPTED"); encryptedSecret != "" {
		decryptedSecret, err := decryptEnvSecret(encryptedSecret)
		if err != nil {
			klog.Fatalf("Invalid KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET_ENCRYPTED: %v", err)
		}
		OAuthBootstrapClientSecret = decryptedSecret
	}
	OAuthBootstrapIssuer = os.Getenv("KITE_OAUTH_BOOTSTRAP_ISSUER")
	OAuthBootstrapAuthURL = os.Getenv("KITE_OAUTH_BOOTSTRAP_AUTH_URL")
	OAuthBootstrapTokenURL = os.Getenv("KITE_OAUTH_BOOTSTRAP_TOKEN_URL")
	OAuthBootstrapUserInfoURL = os.Getenv("KITE_OAUTH_BOOTSTRAP_USERINFO_URL")
	if v := os.Getenv("KITE_OAUTH_BOOTSTRAP_SCOPES"); v != "" {
		OAuthBootstrapScopes = v
	}

	// --- Encryption Key Enforcement ---
	if v := os.Getenv("KITE_INSECURE_DEV"); v == "true" {
		InsecureDevMode = true
		klog.Warningf("KITE_INSECURE_DEV=true: Running with default encryption key. DO NOT USE IN PRODUCTION!")
	}

	if os.Getenv("KITE_ENCRYPT_KEY") == "" && !InsecureDevMode {
		klog.Fatalf("FATAL: KITE_ENCRYPT_KEY is not set. " +
			"This key is required to encrypt kubeconfig, OAuth secrets, and API keys at rest. " +
			"Generate a strong random key (e.g. `openssl rand -base64 32`) and set it as KITE_ENCRYPT_KEY. " +
			"To bypass this check for local development only, set KITE_INSECURE_DEV=true.")
	}
}

// OAuthBootstrapConfigured returns true when the environment provides enough
// information to bootstrap an OAuth provider at startup.
func OAuthBootstrapConfigured() bool {
	return OAuthBootstrapName != "" && OAuthBootstrapClientID != "" && OAuthBootstrapClientSecret != ""
}

func HasConfiguredSuperAdminEmails() bool {
	return len(SuperAdminEmails) > 0
}

func IsConfiguredSuperAdminEmail(email string) bool {
	normalized := strings.TrimSpace(strings.ToLower(email))
	if normalized == "" {
		return false
	}
	for _, candidate := range SuperAdminEmails {
		if candidate == normalized {
			return true
		}
	}
	return false
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func parseEmailList(value string) []string {
	parts := strings.Split(value, ",")
	emails := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		email := strings.TrimSpace(strings.ToLower(part))
		if email == "" {
			continue
		}
		if _, ok := seen[email]; ok {
			continue
		}
		seen[email] = struct{}{}
		emails = append(emails, email)
	}
	return emails
}

func decryptEnvSecret(encrypted string) (string, error) {
	keyHash := sha256.Sum256([]byte(KiteEncryptKey))
	ciphertext, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, encryptedBytes := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encryptedBytes, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

