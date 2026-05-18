#!/usr/bin/env bash
# =============================================================================
# verify-oauth-mode.sh — Pure OAuth Mode Codebase Verification Script
# =============================================================================
# Run this on the testbed machine against the kite source directory.
#
# Usage:
#   chmod +x verify-oauth-mode.sh
#   ./verify-oauth-mode.sh /path/to/kite-source
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks FAILED (see output)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

SRC="${1:-.}"

if [ ! -d "$SRC" ]; then
  echo -e "${RED}ERROR: Directory '$SRC' does not exist${NC}"
  echo "Usage: $0 /path/to/kite-source"
  exit 1
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Kite — Pure OAuth Mode Codebase Verification${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "  Source: ${CYAN}$SRC${NC}"
echo ""

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

check_exists() {
  local desc="$1"
  local pattern="$2"
  local file="$3"

  if grep -qE "$pattern" "$SRC/$file" 2>/dev/null; then
    echo -e "  ${GREEN}✓ PASS${NC} — $desc"
    echo -e "         ${CYAN}$(grep -nE "$pattern" "$SRC/$file" | head -3)${NC}"
    ((PASS++))
  else
    echo -e "  ${RED}✗ FAIL${NC} — $desc"
    echo -e "         Expected pattern: ${YELLOW}$pattern${NC}"
    echo -e "         In file: ${YELLOW}$file${NC}"
    ((FAIL++))
  fi
}

check_not_exists() {
  local desc="$1"
  local pattern="$2"
  local file="$3"

  if grep -qE "$pattern" "$SRC/$file" 2>/dev/null; then
    echo -e "  ${RED}✗ FAIL${NC} — $desc"
    echo -e "         Unwanted pattern found: ${YELLOW}$(grep -nE "$pattern" "$SRC/$file" | head -3)${NC}"
    echo -e "         In file: ${YELLOW}$file${NC}"
    ((FAIL++))
  else
    echo -e "  ${GREEN}✓ PASS${NC} — $desc"
    ((PASS++))
  fi
}

check_file_exists() {
  local desc="$1"
  local file="$2"

  if [ -f "$SRC/$file" ]; then
    echo -e "  ${GREEN}✓ PASS${NC} — $desc"
    ((PASS++))
  else
    echo -e "  ${RED}✗ FAIL${NC} — $desc"
    echo -e "         File missing: ${YELLOW}$file${NC}"
    ((FAIL++))
  fi
}

warn_check() {
  local desc="$1"
  local pattern="$2"
  local file="$3"

  if grep -qE "$pattern" "$SRC/$file" 2>/dev/null; then
    echo -e "  ${YELLOW}⚠ WARN${NC} — $desc"
    echo -e "         ${CYAN}$(grep -nE "$pattern" "$SRC/$file" | head -3)${NC}"
    ((WARN++))
  else
    echo -e "  ${GREEN}✓ PASS${NC} — $desc"
    ((PASS++))
  fi
}

section() {
  echo ""
  echo -e "${BOLD}───────────────────────────────────────────────────────────────${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${BOLD}───────────────────────────────────────────────────────────────${NC}"
}

# =============================================================================
# SECTION 1: Required Files Exist
# =============================================================================
section "1. Required Files Exist"

check_file_exists "pkg/common/common.go exists" "pkg/common/common.go"
check_file_exists "internal/load.go exists" "internal/load.go"
check_file_exists "pkg/auth/handler.go exists" "pkg/auth/handler.go"
check_file_exists "pkg/auth/oauth_manager.go exists" "pkg/auth/oauth_manager.go"
check_file_exists "pkg/auth/oauth_provider.go exists" "pkg/auth/oauth_provider.go"
check_file_exists "pkg/model/oauth.go exists" "pkg/model/oauth.go"
check_file_exists "pkg/model/setting.go exists" "pkg/model/setting.go"
check_file_exists "pkg/model/user.go exists" "pkg/model/user.go"
check_file_exists "pkg/model/custom_type.go exists" "pkg/model/custom_type.go"
check_file_exists "pkg/model/rbac.go exists" "pkg/model/rbac.go"
check_file_exists "pkg/handlers/overview_handler.go exists" "pkg/handlers/overview_handler.go"
check_file_exists "pkg/handlers/user_handler.go exists" "pkg/handlers/user_handler.go"
check_file_exists "pkg/rbac/rbac.go exists" "pkg/rbac/rbac.go"
check_file_exists "pkg/rbac/manager.go exists" "pkg/rbac/manager.go"
check_file_exists "main.go exists" "main.go"
check_file_exists "ui/src/pages/initialization.tsx exists" "ui/src/pages/initialization.tsx"
check_file_exists "ui/src/pages/login.tsx exists" "ui/src/pages/login.tsx"
check_file_exists "ui/src/contexts/auth-context.tsx exists" "ui/src/contexts/auth-context.tsx"
check_file_exists "ui/src/components/init-check-route.tsx exists" "ui/src/components/init-check-route.tsx"
check_file_exists "ui/src/lib/api.ts exists" "ui/src/lib/api.ts"
check_file_exists "ui/src/lib/api-client.ts exists" "ui/src/lib/api-client.ts"
check_file_exists "ui/src/routes.tsx exists" "ui/src/routes.tsx"

# =============================================================================
# SECTION 2: pkg/common/common.go — OAuth Bootstrap Env Vars
# =============================================================================
section "2. pkg/common/common.go — OAuth Bootstrap Config"

check_exists \
  "SuperAdminEmail variable declared" \
  'SuperAdminEmail\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapName variable declared" \
  'OAuthBootstrapName\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapClientID variable declared" \
  'OAuthBootstrapClientID\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapClientSecret variable declared" \
  'OAuthBootstrapClientSecret\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapAuthURL variable declared" \
  'OAuthBootstrapAuthURL\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapTokenURL variable declared" \
  'OAuthBootstrapTokenURL\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapUserInfoURL variable declared" \
  'OAuthBootstrapUserInfoURL\s*=\s*""' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapScopes with default value" \
  'OAuthBootstrapScopes\s*=\s*"openid,profile,email"' \
  "pkg/common/common.go"

check_exists \
  "KITE_SUPERADMIN_EMAIL env var read in LoadEnvs" \
  'os\.Getenv\("KITE_SUPERADMIN_EMAIL"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_NAME env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_NAME"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_CLIENT_ID env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_CLIENT_ID"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_AUTH_URL env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_AUTH_URL"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_TOKEN_URL env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_TOKEN_URL"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_USERINFO_URL env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_USERINFO_URL"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_OAUTH_BOOTSTRAP_SCOPES env var read" \
  'os\.Getenv\("KITE_OAUTH_BOOTSTRAP_SCOPES"\)' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapConfigured() function defined" \
  'func OAuthBootstrapConfigured\(\) bool' \
  "pkg/common/common.go"

check_exists \
  "OAuthBootstrapConfigured checks Name+ClientID+ClientSecret" \
  'OAuthBootstrapName != "" && OAuthBootstrapClientID != "" && OAuthBootstrapClientSecret != ""' \
  "pkg/common/common.go"

check_exists \
  "KITE_ENCRYPT_KEY env var read" \
  'os\.Getenv\("KITE_ENCRYPT_KEY"\)' \
  "pkg/common/common.go"

check_exists \
  "KITE_ENCRYPT_KEY fatal when missing (not InsecureDevMode)" \
  'KITE_ENCRYPT_KEY.*is not set' \
  "pkg/common/common.go"

# =============================================================================
# SECTION 3: internal/load.go — OAuth Bootstrap + Password Disable
# =============================================================================
section "3. internal/load.go — OAuth Bootstrap Loading"

check_exists \
  "loadOAuthBootstrap() function defined" \
  'func loadOAuthBootstrap\(\) error' \
  "internal/load.go"

check_exists \
  "loadOAuthBootstrap() called before loadUser() in LoadConfigFromEnv" \
  'loadOAuthBootstrap\(\)' \
  "internal/load.go"

check_exists \
  "loadUser() skips when OAuthBootstrapConfigured()" \
  'common\.OAuthBootstrapConfigured\(\)' \
  "internal/load.go"

check_exists \
  "loadUser() returns nil early when OAuth configured" \
  'OAuth bootstrap is configured.*skipping KITE_USERNAME' \
  "internal/load.go"

check_exists \
  "loadOAuthBootstrap creates provider with model.CreateOAuthProvider" \
  'model\.CreateOAuthProvider\(provider\)' \
  "internal/load.go"

check_exists \
  "loadOAuthBootstrap updates existing provider with model.UpdateOAuthProvider" \
  'model\.UpdateOAuthProvider\(&existing' \
  "internal/load.go"

check_exists \
  "Password login disabled on FIRST CREATION (SetSetting in create branch)" \
  'SetSetting.*SettingPasswordLoginDisabled.*true' \
  "internal/load.go"

# --- THE KEY FIX: Password disable on EVERY boot (update branch too) ---
echo ""
echo -e "  ${BOLD}[KEY FIX] Password login disabled on EVERY boot:${NC}"

# Count occurrences of SetSetting(PasswordLoginDisabled, "true") — must be >= 2
DISABLE_COUNT=$(grep -c 'SetSetting.*SettingPasswordLoginDisabled.*"true"' "$SRC/internal/load.go" 2>/dev/null || echo "0")

if [ "$DISABLE_COUNT" -ge 2 ]; then
  echo -e "  ${GREEN}✓ PASS${NC} — Password login disabled in BOTH create AND update branches"
  echo -e "         Found ${CYAN}${DISABLE_COUNT}${NC} occurrences of SetSetting(PasswordLoginDisabled, \"true\")"
  ((PASS++))
else
  echo -e "  ${RED}✗ FAIL${NC} — Password login only disabled in ${DISABLE_COUNT} branch(es), need >= 2"
  echo -e "         The update-existing-provider branch must ALSO call SetSetting(PasswordLoginDisabled, \"true\")"
  echo -e "         This is the KEY FIX: ensures password login stays disabled across restarts"
  ((FAIL++))
fi

check_exists \
  "Update branch has SuperAdminEmail check before disabling password" \
  'common\.SuperAdminEmail != ""' \
  "internal/load.go"

# =============================================================================
# SECTION 4: pkg/auth/handler.go — OAuth Callback + Superadmin Promotion
# =============================================================================
section "4. pkg/auth/handler.go — Callback & Superadmin Promotion"

check_exists \
  "Callback function defined" \
  'func \(h \*AuthHandler\) Callback\(c \*gin\.Context\)' \
  "pkg/auth/handler.go"

check_exists \
  "Callback checks SuperAdminEmail" \
  'common\.SuperAdminEmail' \
  "pkg/auth/handler.go"

check_exists \
  "Callback uses strings.EqualFold for email comparison (case-insensitive)" \
  'strings\.EqualFold\(user\.Email.*common\.SuperAdminEmail\)' \
  "pkg/auth/handler.go"

check_exists \
  "Callback auto-promotes with AddRoleAssignment(\"admin\")" \
  'model\.AddRoleAssignment\("admin"' \
  "pkg/auth/handler.go"

check_exists \
  "Callback triggers rbac.SyncNow after promotion" \
  'rbac\.SyncNow <- struct' \
  "pkg/auth/handler.go"

check_exists \
  "Callback sets user.Roles directly (avoids race with async sync)" \
  'user\.Roles = \[\]common\.Role' \
  "pkg/auth/handler.go"

check_exists \
  "Callback checks GetUserRoles — blocks users with no role" \
  'rbac\.GetUserRoles\(\*user\)' \
  "pkg/auth/handler.go"

check_exists \
  "Callback redirects with insufficient_permissions when no roles" \
  'insufficient_permissions' \
  "pkg/auth/handler.go"

check_exists \
  "Callback checks user.Enabled" \
  'user\.Enabled' \
  "pkg/auth/handler.go"

check_exists \
  "Callback creates UserSession for OAuth logins" \
  'model\.CreateUserSession\(session\)' \
  "pkg/auth/handler.go"

check_exists \
  "GetProviders function excludes password when disabled" \
  'isPasswordLoginDisabled\(\)' \
  "pkg/auth/handler.go"

check_exists \
  "isPasswordLoginDisabled checks both env var and DB setting" \
  'common\.DisablePasswordLogin || model\.IsPasswordLoginDisabled' \
  "pkg/auth/handler.go"

check_exists \
  "OAuth state validated (CSRF protection)" \
  'stateParam != cookieState' \
  "pkg/auth/handler.go"

check_exists \
  "setCookieSecure function defined (HttpOnly+SameSite)" \
  'func setCookieSecure' \
  "pkg/auth/handler.go"

check_exists \
  "Cookie Secure flag based on Host scheme" \
  'strings\.HasPrefix\(common\.Host.*https://' \
  "pkg/auth/handler.go"

# =============================================================================
# SECTION 5: pkg/auth/oauth_provider.go — Zoho Field Mapping
# =============================================================================
section "5. pkg/auth/oauth_provider.go — User Info Field Mapping"

check_exists \
  "Zoho ZUID field mapping" \
  'userInfo\["ZUID"\]' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Zoho Email (capital E) field mapping" \
  'userInfo\["Email"\]' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Zoho Display_Name field mapping" \
  'userInfo\["Display_Name"\]' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Zoho First_Name/Last_Name fallback" \
  'userInfo\["First_Name"\]' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Username fallback to email when empty" \
  'user\.Username == ""' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Standard 'sub' field mapping" \
  'userInfo\["sub"\]' \
  "pkg/auth/oauth_provider.go"

check_exists \
  "Azure AD 'oid' field mapping" \
  'userInfo\["oid"\]' \
  "pkg/auth/oauth_provider.go"

# =============================================================================
# SECTION 6: pkg/auth/oauth_manager.go — JWT, State, Provider Lookup
# =============================================================================
section "6. pkg/auth/oauth_manager.go — OAuth Manager"

check_exists \
  "GenerateState uses crypto/rand (32 bytes)" \
  'rand\.Read\(b\)' \
  "pkg/auth/oauth_manager.go"

check_exists \
  "GenerateJWT includes RefreshToken in claims" \
  'RefreshToken.*refreshToken' \
  "pkg/auth/oauth_manager.go"

check_exists \
  "GetProvider builds RedirectURL from Host + /api/auth/callback" \
  '/api/auth/callback' \
  "pkg/auth/oauth_manager.go"

check_exists \
  "RefreshJWT extracts refresh_token and calls provider.RefreshToken" \
  'provider\.RefreshToken\(claims\.RefreshToken\)' \
  "pkg/auth/oauth_manager.go"

check_exists \
  "GetAvailableProviders reads from DB (GetEnabledOAuthProviders)" \
  'model\.GetEnabledOAuthProviders' \
  "pkg/auth/oauth_manager.go"

# =============================================================================
# SECTION 7: pkg/model/oauth.go — OAuthProvider Model
# =============================================================================
section "7. pkg/model/oauth.go — OAuthProvider Model"

check_exists \
  "OAuthProvider struct defined" \
  'type OAuthProvider struct' \
  "pkg/model/oauth.go"

check_exists \
  "ClientSecret is SecretString type (encrypted at rest)" \
  'ClientSecret\s+SecretString' \
  "pkg/model/oauth.go"

check_exists \
  "Name is LowerCaseString type (case-insensitive)" \
  'Name\s+LowerCaseString' \
  "pkg/model/oauth.go"

check_exists \
  "Name has uniqueIndex constraint" \
  'uniqueIndex.*not null' \
  "pkg/model/oauth.go"

check_exists \
  "GetOAuthProviderByName filters by enabled=true" \
  'enabled.*true' \
  "pkg/model/oauth.go"

check_exists \
  "CreateOAuthProvider function defined" \
  'func CreateOAuthProvider' \
  "pkg/model/oauth.go"

check_exists \
  "UpdateOAuthProvider function defined" \
  'func UpdateOAuthProvider' \
  "pkg/model/oauth.go"

# =============================================================================
# SECTION 8: pkg/model/setting.go — SystemSetting for Password Disable
# =============================================================================
section "8. pkg/model/setting.go — SystemSetting Model"

check_exists \
  "SystemSetting struct defined" \
  'type SystemSetting struct' \
  "pkg/model/setting.go"

check_exists \
  "SettingPasswordLoginDisabled constant" \
  'SettingPasswordLoginDisabled.*=.*password_login_disabled' \
  "pkg/model/setting.go"

check_exists \
  "GetSetting function defined" \
  'func GetSetting\(key string\) string' \
  "pkg/model/setting.go"

check_exists \
  "SetSetting function defined (upsert)" \
  'func SetSetting\(key.*value' \
  "pkg/model/setting.go"

check_exists \
  "IsPasswordLoginDisabled function defined" \
  'func IsPasswordLoginDisabled\(\) bool' \
  "pkg/model/setting.go"

# =============================================================================
# SECTION 9: pkg/model/user.go — User Model + FindWithSubOrUpsertUser
# =============================================================================
section "9. pkg/model/user.go — User Model"

check_exists \
  "User struct has Sub field" \
  'Sub\s+string' \
  "pkg/model/user.go"

check_exists \
  "User struct has Provider field" \
  'Provider\s+string' \
  "pkg/model/user.go"

check_exists \
  "User struct has OIDCGroups field (SliceString)" \
  'OIDCGroups\s+SliceString' \
  "pkg/model/user.go"

check_exists \
  "User struct has AvatarURL field" \
  'AvatarURL\s+string' \
  "pkg/model/user.go"

check_exists \
  "User struct has Enabled field" \
  'Enabled\s+bool' \
  "pkg/model/user.go"

check_exists \
  "FindWithSubOrUpsertUser function defined" \
  'func FindWithSubOrUpsertUser' \
  "pkg/model/user.go"

check_exists \
  "FindWithSubOrUpsertUser looks up by Sub first" \
  'Where\("sub = ?"' \
  "pkg/model/user.go"

check_exists \
  "FindWithSubOrUpsertUser falls back to Email lookup" \
  'Where\("email = ?"' \
  "pkg/model/user.go"

check_exists \
  "FindWithSubOrUpsertUser preserves existing Username (RBAC)" \
  'existingUser\.Username != ""' \
  "pkg/model/user.go"

check_exists \
  "UserSession struct defined" \
  'type UserSession struct' \
  "pkg/model/user.go"

# =============================================================================
# SECTION 10: pkg/model/custom_type.go — SecretString + LowerCaseString
# =============================================================================
section "10. pkg/model/custom_type.go — Custom Types"

check_file_exists "custom_type.go exists" "pkg/model/custom_type.go"

check_exists \
  "SecretString type defined" \
  'type SecretString string' \
  "pkg/model/custom_type.go"

check_exists \
  "LowerCaseString type defined" \
  'type LowerCaseString string' \
  "pkg/model/custom_type.go"

check_exists \
  "SliceString type defined" \
  'type SliceString' \
  "pkg/model/custom_type.go"

# =============================================================================
# SECTION 11: pkg/model/model.go — AutoMigrate includes new models
# =============================================================================
section "11. pkg/model/model.go — AutoMigrate"

check_exists \
  "AutoMigrate includes OAuthProvider" \
  'OAuthProvider' \
  "pkg/model/model.go"

check_exists \
  "AutoMigrate includes SystemSetting" \
  'SystemSetting' \
  "pkg/model/model.go"

check_exists \
  "AutoMigrate includes UserSession" \
  'UserSession' \
  "pkg/model/model.go"

# =============================================================================
# SECTION 12: pkg/handlers/overview_handler.go — InitCheck
# =============================================================================
section "12. pkg/handlers/overview_handler.go — InitCheck"

check_exists \
  "InitCheck function defined" \
  'func InitCheck' \
  "pkg/handlers/overview_handler.go"

check_exists \
  "InitCheck returns oauthBootstrap field" \
  '"oauthBootstrap".*oauthBootstrap' \
  "pkg/handlers/overview_handler.go"

check_exists \
  "InitCheck checks OAuthBootstrapConfigured()" \
  'common\.OAuthBootstrapConfigured\(\)' \
  "pkg/handlers/overview_handler.go"

check_exists \
  "InitCheck checks SuperAdminEmail" \
  'common\.SuperAdminEmail' \
  "pkg/handlers/overview_handler.go"

# =============================================================================
# SECTION 13: pkg/handlers/user_handler.go — CreateSuperUser blocked
# =============================================================================
section "13. pkg/handlers/user_handler.go — CreateSuperUser Guard"

check_exists \
  "CreateSuperUser checks OAuthBootstrapConfigured()" \
  'common\.OAuthBootstrapConfigured\(\)' \
  "pkg/handlers/user_handler.go"

check_exists \
  "CreateSuperUser returns 403 when OAuth bootstrap active" \
  'StatusForbidden' \
  "pkg/handlers/user_handler.go"

check_exists \
  "CreateSuperUser message mentions OAuth provider" \
  'OAuth bootstrap is configured' \
  "pkg/handlers/user_handler.go"

# =============================================================================
# SECTION 14: pkg/model/rbac.go — Default Roles + AddRoleAssignment
# =============================================================================
section "14. pkg/model/rbac.go — RBAC Model"

check_exists \
  "DefaultAdminRole defined with admin name" \
  'DefaultAdminRole.*=.*Role' \
  "pkg/model/rbac.go"

check_exists \
  "DefaultViewerRole defined" \
  'DefaultViewerRole.*=.*Role' \
  "pkg/model/rbac.go"

check_exists \
  "AddRoleAssignment function defined" \
  'func AddRoleAssignment' \
  "pkg/model/rbac.go"

check_exists \
  "SubjectTypeUser constant" \
  'SubjectTypeUser.*=.*user' \
  "pkg/model/rbac.go"

check_exists \
  "InitDefaultRole function defined" \
  'func InitDefaultRole\(\) error' \
  "pkg/model/rbac.go"

# =============================================================================
# SECTION 15: main.go — Route Registration
# =============================================================================
section "15. main.go — Route Registration"

check_exists \
  "init_check route registered" \
  '/api/v1/init_check.*handlers\.InitCheck' \
  "main.go"

check_exists \
  "Auth providers route registered" \
  '/providers.*authHandler\.GetProviders' \
  "main.go"

check_exists \
  "OAuth login route registered" \
  'authGroup\.GET\("/login"' \
  "main.go"

check_exists \
  "OAuth callback route registered" \
  '/callback.*authHandler\.Callback' \
  "main.go"

check_exists \
  "Password login route registered" \
  '/login/password.*authHandler\.PasswordLogin' \
  "main.go"

check_exists \
  "CreateSuperUser route registered" \
  'create_super_user.*handlers\.CreateSuperUser' \
  "main.go"

check_exists \
  "Cluster import route registered" \
  'clusters/import.*ImportClustersFromKubeconfig' \
  "main.go"

check_exists \
  "Admin API uses RequireAuth + RequireAdmin middleware" \
  'RequireAuth.*RequireAdmin' \
  "main.go"

check_exists \
  "OAuth provider management routes registered" \
  'oauth-providers' \
  "main.go"

check_exists \
  "RBAC routes registered" \
  'roles.*rbac\.ListRoles' \
  "main.go"

check_exists \
  "LoadConfigFromEnv called in main" \
  'internal\.LoadConfigFromEnv' \
  "main.go"

check_exists \
  "InitDB called before LoadConfigFromEnv" \
  'model\.InitDB' \
  "main.go"

check_exists \
  "InitRBAC called" \
  'rbac\.InitRBAC' \
  "main.go"

# =============================================================================
# SECTION 16: Frontend — ui/src/pages/initialization.tsx
# =============================================================================
section "16. ui/src/pages/initialization.tsx — Setup Page"

check_exists \
  "useInitCheck hook used" \
  'useInitCheck' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "oauthBootstrap flag read from initCheck" \
  'oauthBootstrap' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "isOAuthBootstrap derived from initCheck" \
  'isOAuthBootstrap.*initCheck.*oauthBootstrap' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "OAuth login handler (handleOAuthLogin) defined" \
  'handleOAuthLogin' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "Calls login(provider) from auth context" \
  'await login\(provider\)' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "OAuth providers list filters out 'password'" \
  "providers\.filter.*password" \
  "ui/src/pages/initialization.tsx"

check_exists \
  "Sign in with button rendered for OAuth providers" \
  'Sign in with' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "Secure OAuth Setup info box shown" \
  'Secure OAuth Setup' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "Step 1 adapts title for OAuth (Sign in as Admin)" \
  'Sign in as Admin' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "Step 2 cluster import form exists" \
  'handleImportClusters' \
  "ui/src/pages/initialization.tsx"

check_exists \
  "URL error params (error/reason) read from searchParams" \
  "searchParams\.get.*error" \
  "ui/src/pages/initialization.tsx"

# =============================================================================
# SECTION 17: Frontend — ui/src/pages/login.tsx
# =============================================================================
section "17. ui/src/pages/login.tsx — Login Page"

check_exists \
  "Login page reads providers from auth context" \
  'providers.*useAuth' \
  "ui/src/pages/login.tsx"

check_exists \
  "OAuth buttons rendered for non-password providers" \
  "providers\.filter.*password" \
  "ui/src/pages/login.tsx"

check_exists \
  "Password form only shown when providers includes 'password'" \
  "providers\.includes.*password" \
  "ui/src/pages/login.tsx"

check_exists \
  "Error messages for insufficient_permissions" \
  'insufficient_permissions' \
  "ui/src/pages/login.tsx"

check_exists \
  "Error messages for token_exchange_failed" \
  'token_exchange_failed' \
  "ui/src/pages/login.tsx"

check_exists \
  "Error messages for user_disabled" \
  'user_disabled' \
  "ui/src/pages/login.tsx"

check_exists \
  "loginWithPassword function used" \
  'loginWithPassword' \
  "ui/src/pages/login.tsx"

# =============================================================================
# SECTION 18: Frontend — ui/src/contexts/auth-context.tsx
# =============================================================================
section "18. ui/src/contexts/auth-context.tsx — Auth Context"

check_exists \
  "loadProviders fetches /api/auth/providers" \
  '/api/auth/providers' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "login function calls /api/auth/login?provider=" \
  '/api/auth/login\?provider=' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "login redirects to auth_url (window.location.href)" \
  'window\.location\.href.*data\.auth_url' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "loginWithPassword calls /api/auth/login/password" \
  '/api/auth/login/password' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "checkAuth calls /api/auth/user" \
  '/api/auth/user' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "Token auto-refresh every 30 minutes" \
  '30 \* 60 \* 1000' \
  "ui/src/contexts/auth-context.tsx"

check_exists \
  "refreshToken calls /api/auth/refresh" \
  '/api/auth/refresh' \
  "ui/src/contexts/auth-context.tsx"

# =============================================================================
# SECTION 19: Frontend — ui/src/components/init-check-route.tsx
# =============================================================================
section "19. ui/src/components/init-check-route.tsx — InitCheckRoute"

check_exists \
  "Redirects to /setup when not initialized" \
  'Navigate to="/setup"' \
  "ui/src/components/init-check-route.tsx"

check_exists \
  "Uses useInitCheck hook" \
  'useInitCheck' \
  "ui/src/components/init-check-route.tsx"

# =============================================================================
# SECTION 20: Frontend — ui/src/lib/api.ts — InitCheck Types
# =============================================================================
section "20. ui/src/lib/api.ts — InitCheck API"

check_exists \
  "InitCheckResponse interface defined" \
  'interface InitCheckResponse' \
  "ui/src/lib/api.ts"

check_exists \
  "InitCheckResponse has oauthBootstrap field" \
  'oauthBootstrap.*boolean' \
  "ui/src/lib/api.ts"

check_exists \
  "fetchInitCheck calls /init_check" \
  '/init_check' \
  "ui/src/lib/api.ts"

check_exists \
  "useInitCheck hook defined" \
  'useInitCheck' \
  "ui/src/lib/api.ts"

# =============================================================================
# SECTION 21: Frontend — ui/src/routes.tsx — Route Definitions
# =============================================================================
section "21. ui/src/routes.tsx — Routes"

check_exists \
  "/setup route maps to InitializationPage" \
  "path.*setup.*InitializationPage" \
  "ui/src/routes.tsx"

check_exists \
  "/login route wrapped in InitCheckRoute" \
  'InitCheckRoute.*LoginPage' \
  "ui/src/routes.tsx"

check_exists \
  "/ route wrapped in InitCheckRoute + ProtectedRoute" \
  'InitCheckRoute.*ProtectedRoute' \
  "ui/src/routes.tsx"

# =============================================================================
# SECTION 22: Security — No Plaintext Secrets in Code
# =============================================================================
section "22. Security Checks"

warn_check \
  "No hardcoded OAuth client secrets in source files" \
  'KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET.*=.*[a-zA-Z0-9]{20}' \
  "pkg/common/common.go"

# Check that sensitive env vars are not hardcoded with real values
echo ""
echo -e "  ${BOLD}Checking for accidental credential leaks in Go source:${NC}"

LEAK_FOUND=0
for f in $(find "$SRC/pkg" "$SRC/internal" -name "*.go" 2>/dev/null); do
  if grep -qE '(client_secret|ClientSecret)\s*[:=]\s*"[a-zA-Z0-9_-]{20,}"' "$f" 2>/dev/null; then
    RELATIVE="${f#$SRC/}"
    echo -e "  ${RED}✗ WARN${NC} — Potential hardcoded secret in: ${YELLOW}${RELATIVE}${NC}"
    echo -e "         ${CYAN}$(grep -nE '(client_secret|ClientSecret)\s*[:=]\s*"[a-zA-Z0-9_-]{20,}"' "$f" | head -2)${NC}"
    LEAK_FOUND=1
  fi
done

if [ $LEAK_FOUND -eq 0 ]; then
  echo -e "  ${GREEN}✓ PASS${NC} — No hardcoded secrets found in Go source"
  ((PASS++))
else
  ((WARN++))
fi

# =============================================================================
# SECTION 23: Callback URL Path Consistency
# =============================================================================
section "23. Callback URL Consistency"

# The callback URL used in oauth_manager.go must match the route in main.go
check_exists \
  "Callback URL path in oauth_manager.go matches route in main.go (/api/auth/callback)" \
  '/api/auth/callback' \
  "pkg/auth/oauth_manager.go"

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}PASSED${NC}: $PASS"
echo -e "  ${RED}FAILED${NC}: $FAIL"
echo -e "  ${YELLOW}WARNED${NC}: $WARN"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}${BOLD}❌ VERIFICATION FAILED — $FAIL check(s) need fixing${NC}"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo -e "    1. Review the FAIL items above"
  echo -e "    2. Ensure your local codebase matches the OAuth changes"
  echo -e "    3. Re-run this script after fixing"
  echo ""
  exit 1
else
  echo -e "  ${GREEN}${BOLD}✅ ALL CHECKS PASSED — Codebase is ready for pure OAuth mode${NC}"
  echo ""
  echo -e "  ${BOLD}Deployment checklist:${NC}"
  echo -e "    1. Build the new Docker image (e.g. kite:v3.5)"
  echo -e "    2. Update kite-manifest.yaml with OAuth env vars"
  echo -e "    3. Register callback URL in Zoho API Console:"
  echo -e "       ${CYAN}https://dashboard.kites.localzoho.com/api/auth/callback${NC}"
  echo -e "    4. Deploy and verify first admin can sign in via OAuth"
  echo -e "    5. First admin pre-assigns admin role to other 3 admins"
  echo ""
  exit 0
fi

