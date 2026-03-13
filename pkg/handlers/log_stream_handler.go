package handlers

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"k8s.io/klog/v2"
)

// tailSizeBytes is the amount of the log file to seek back from the end
// for the initial "tail" — effectively the last ~200 lines at ~80 chars/line.
const tailSizeBytes = 16384 // 16 KiB

// StreamLogFile streams a log file to the client using Server-Sent Events (SSE).
//
// The initial response contains the last ~200 lines of the file (tail), then
// new lines are pushed as they appear every 250ms.  A heartbeat comment is sent
// every 15 seconds so that:
//   - HTTP proxies (nginx, corporate HTTPS proxy) don't close the idle connection.
//   - The browser EventSource API knows the connection is still alive.
func StreamLogFile(c *gin.Context) {
	filename := c.Param("filename")
	if filename != "application.log" && filename != "access.log" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid log file"})
		return
	}

	logPath := filepath.Join(common.LogDir, filename)
	file, err := os.Open(logPath)
	if err != nil {
		// Return 404 rather than 500 so the frontend can show a useful message
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("log file %q not found — it will appear once the application writes its first log entry", filename)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to open log file: %v", err)})
		return
	}
	defer file.Close()

	// ── Tail: seek back tailSizeBytes from the end so we send recent history ──
	didSeek := false
	if info, statErr := file.Stat(); statErr == nil && info.Size() > tailSizeBytes {
		if _, seekErr := file.Seek(-tailSizeBytes, io.SeekEnd); seekErr == nil {
			didSeek = true
		}
	}

	// SSE headers — must be set before first Write
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // Disable nginx proxy buffering
	c.Header("Transfer-Encoding", "chunked")

	clientGone := c.Request.Context().Done()

	// Poll for new lines every 250ms; heartbeat every 15s
	pollTicker := time.NewTicker(250 * time.Millisecond)
	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer pollTicker.Stop()
	defer heartbeatTicker.Stop()

	reader := bufio.NewReaderSize(file, 64*1024)

	// If we seeked, discard the partial first line (which may be cut mid-way)
	if didSeek {
		_, _ = reader.ReadString('\n')
	}

	for {
		select {
		case <-clientGone:
			return

		case <-heartbeatTicker.C:
			// SSE comment — ignored by EventSource API but keeps the TCP connection alive
			// through proxies that otherwise time out idle connections.
			fmt.Fprintf(c.Writer, ": heartbeat\n\n")
			c.Writer.Flush()

		case <-pollTicker.C:
			// Drain all new lines that have been written since last poll
			flushed := false
			for {
				line, readErr := reader.ReadString('\n')
				if line != "" {
					// Strip trailing newline from the line before embedding in SSE data field
					trimmed := strings.TrimRight(line, "\r\n")
					if trimmed != "" {
						fmt.Fprintf(c.Writer, "data: %s\n\n", trimmed)
						flushed = true
					}
				}
				if readErr != nil {
					if readErr == io.EOF {
						// No more data right now — wait for next poll tick
						break
					}
					klog.Errorf("Error reading log file %s: %v", filename, readErr)
					return
				}
			}
			if flushed {
				c.Writer.Flush()
			}
		}
	}
}
