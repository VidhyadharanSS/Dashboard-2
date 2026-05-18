package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

// wsUpgrader is a shared WebSocket upgrader for all handlers.
//
// Auth is always enforced via JWT cookie on every WS request, so CheckOrigin
// is defense-in-depth only.  The origin check compares against:
//   1. The configured HOST env var (if set),
//   2. The HTTP Host header of the request itself (covers proxies, port-forwards),
//   3. Common localhost variants (127.0.0.1, ::1, localhost).
//
// This avoids false rejections when the app is behind a reverse proxy, accessed
// via IP address, or served through `kubectl port-forward` / SSH tunnels.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // Non-browser clients (curl, etc.)
		}

		// Development mode — no HOST configured, allow all
		if common.Host == "" {
			return true
		}

		// Extract just the host[:port] from the Origin header.
		// Origin is like "http://10.69.105.237:8080" — strip the scheme.
		originHost := strings.TrimPrefix(origin, "https://")
		originHost = strings.TrimPrefix(originHost, "http://")

		// 1. Match against the request's own Host header (most reliable behind proxies)
		if r.Host != "" && originHost == r.Host {
			return true
		}

		// 2. Match against configured HOST env var
		configuredHost := strings.TrimPrefix(common.Host, "https://")
		configuredHost = strings.TrimPrefix(configuredHost, "http://")
		if originHost == configuredHost {
			return true
		}

		// 3. Allow localhost variants (dev, port-forward, tunnels)
		originHostOnly := originHost
		if idx := strings.LastIndex(originHostOnly, ":"); idx != -1 {
			originHostOnly = originHostOnly[:idx]
		}
		switch originHostOnly {
		case "localhost", "127.0.0.1", "::1", "0.0.0.0":
			return true
		}

		return false
	},
	// Use reasonable buffer sizes for terminal traffic
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
}

type TerminalHandler struct {
}

func NewTerminalHandler() *TerminalHandler {
	return &TerminalHandler{}
}

// HandleTerminalWebSocket handles WebSocket connections for terminal sessions
func (h *TerminalHandler) HandleTerminalWebSocket(c *gin.Context) {
	// Get cluster info from context
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// Get path parameters
	namespace := c.Param("namespace")
	podName := c.Param("podName")
	container := c.Query("container")

	if namespace == "" || podName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and podName are required"})
		return
	}

	user := c.MustGet("user").(model.User)

	// Upgrade HTTP → WebSocket using gorilla/websocket
	ws, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		klog.Errorf("WebSocket upgrade failed: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	session := kube.NewTerminalSession(cs.K8sClient, ws, namespace, podName, container)
	defer session.Close()

	if !rbac.CanAccess(user, "pods", "exec", cs.Name, namespace) {
		session.SendErrorMessage(
			rbac.NoAccess(user.Key(), string(common.VerbExec), "pods", namespace, cs.Name),
		)
		return
	}

	// The TerminalSession handles its own keepalive:
	//   - checkHeartbeat() sends RFC 6455 Ping frames AND application-level
	//     {"type":"ping"} data frames every 20s
	//   - Read() handles client pings/pongs and updates lastHeartbeat
	// No separate WebSocketKeepalive is needed here.

	if err := session.Start(ctx, "exec"); err != nil {
		klog.Errorf("Terminal session error: %v", err)
	}
}
