package handlers

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"k8s.io/klog/v2"
)

// StreamLogFile streams a log file to the client using Server-Sent Events (SSE)
func StreamLogFile(c *gin.Context) {
	filename := c.Param("filename")
	if filename != "application.log" && filename != "access.log" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid log file"})
		return
	}

	logPath := filepath.Join(common.LogDir, filename)
	file, err := os.Open(logPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to open log file: %v", err)})
		return
	}
	defer file.Close()

	// Initial tail: seek to the end and read last 100 lines (simplified)
	info, err := file.Stat()
	if err == nil {
		if info.Size() > 10000 {
			file.Seek(-10000, io.SeekEnd)
		}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	clientGone := c.Request.Context().Done()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	reader := bufio.NewReader(file)

	// Skip partial first line if we seeked
	if info.Size() > 10000 {
		_, _ = reader.ReadString('\n')
	}

	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					if err == io.EOF {
						break
					}
					klog.Errorf("Error reading log file: %v", err)
					return
				}
				if line != "" {
					fmt.Fprintf(c.Writer, "data: %s\n\n", line)
					c.Writer.Flush()
				}
			}
		}
	}
}
