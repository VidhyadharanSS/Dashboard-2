package handlers

import (
	"context"
	"net/http"

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
// CheckOrigin always returns true because authentication is handled by
// middleware (JWT / session token) rather than browser Origin headers.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
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