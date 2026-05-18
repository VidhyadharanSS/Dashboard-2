package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// helper to invoke the Callback handler with a fully customised gin.Context.
// The handler is exercised in isolation; only the early validation paths
// (which are the source of the intermittent first-login failures) are
// covered here — the happy-path requires a real OAuth provider and DB and
// is exercised by integration tests.
func newCallbackContext(t *testing.T, query string, cookies map[string]string) (*httptest.ResponseRecorder, *gin.Context) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback?"+query, nil)
	for name, val := range cookies {
		req.AddCookie(&http.Cookie{Name: name, Value: val})
	}
	c.Request = req
	return w, c
}

// TestCallback_NoProviderCookie exercises the "first login attempt fails
// with a stale / missing oauth_provider cookie" scenario and ensures we
// redirect to the login page with a recoverable error reason that the UI
// knows how to auto-retry.
func TestCallback_NoProviderCookie(t *testing.T) {
	w, c := newCallbackContext(t, "code=abc&state=xyz", nil)

	h := &AuthHandler{manager: NewOAuthManager()}
	h.Callback(c)

	if w.Code != http.StatusFound {
		t.Fatalf("expected 302 redirect, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if !strings.Contains(loc, "reason=no_provider_in_cookie") {
		t.Errorf("expected reason=no_provider_in_cookie in redirect, got %q", loc)
	}
	if !strings.Contains(loc, "error=session_expired") {
		t.Errorf("expected error=session_expired in redirect, got %q", loc)
	}
}

// TestCallback_StateMismatch ensures a state-cookie/state-param mismatch
// also yields a recoverable session_expired error so the UI can auto-retry.
func TestCallback_StateMismatch(t *testing.T) {
	w, c := newCallbackContext(t, "code=abc&state=fromurl", map[string]string{
		"oauth_provider": "github",
		"oauth_state":    "different",
	})

	h := &AuthHandler{manager: NewOAuthManager()}
	h.Callback(c)

	if w.Code != http.StatusFound {
		t.Fatalf("expected 302 redirect, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if !strings.Contains(loc, "reason=state_mismatch") {
		t.Errorf("expected reason=state_mismatch in redirect, got %q", loc)
	}
	if !strings.Contains(loc, "error=session_expired") {
		t.Errorf("expected error=session_expired in redirect, got %q", loc)
	}
}

// TestCallback_ProviderError ensures we propagate explicit provider-side
// failures (e.g. user denied consent) as a distinct error code instead of
// surfacing a generic state-mismatch.
func TestCallback_ProviderError(t *testing.T) {
	w, c := newCallbackContext(t,
		"error=access_denied&error_description=user+denied",
		map[string]string{
			"oauth_provider": "github",
			"oauth_state":    "abc",
		},
	)

	h := &AuthHandler{manager: NewOAuthManager()}
	h.Callback(c)

	if w.Code != http.StatusFound {
		t.Fatalf("expected 302 redirect, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if !strings.Contains(loc, "reason=provider_error") {
		t.Errorf("expected reason=provider_error in redirect, got %q", loc)
	}
}

// TestCallback_StateMissingFromQuery covers the case where the OAuth
// provider redirects back without a state parameter at all — also
// recoverable, must not surface as a generic "Authentication Error".
func TestCallback_StateMissingFromQuery(t *testing.T) {
	w, c := newCallbackContext(t, "code=abc", map[string]string{
		"oauth_provider": "github",
		"oauth_state":    "something",
	})

	h := &AuthHandler{manager: NewOAuthManager()}
	h.Callback(c)

	if w.Code != http.StatusFound {
		t.Fatalf("expected 302 redirect, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if !strings.Contains(loc, "reason=state_mismatch") {
		t.Errorf("expected reason=state_mismatch in redirect, got %q", loc)
	}
}

