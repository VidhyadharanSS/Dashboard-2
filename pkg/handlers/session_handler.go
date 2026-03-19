package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

func ListUserSessions(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	sessions, err := model.ListUserSessions(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list sessions"})
		return
	}

	// Enrich with session count metadata
	type SessionWithCurrent struct {
		model.UserSession
		IsCurrent bool `json:"isCurrent"`
	}

	// Get current token to mark the active session
	currentToken, _ := c.Cookie("auth_token")
	enriched := make([]SessionWithCurrent, len(sessions))
	for i, s := range sessions {
		enriched[i] = SessionWithCurrent{
			UserSession: s,
			IsCurrent:   s.Token == currentToken,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": enriched,
		"total":    len(sessions),
	})
}

func DeleteUserSession(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session ID"})
		return
	}

	if err := model.DeleteUserSession(user.ID, uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "session removed"})
}

// RevokeAllUserSessions terminates all sessions for the authenticated user except the current one.
func RevokeAllUserSessions(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	currentToken, _ := c.Cookie("auth_token")

	result := model.DB.Where("user_id = ? AND token != ? AND expires_at > ?", user.ID, currentToken, time.Now()).
		Delete(&model.UserSession{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":  "All other sessions have been revoked",
		"revoked":  result.RowsAffected,
	})
}

func ListAllSessions(c *gin.Context) {
	var sessions []model.UserSession
	// Only fetch non-expired sessions to keep the list useful
	if err := model.DB.Preload("User").
		Where("expires_at > ?", time.Now()).
		Order("last_used_at desc").
		Limit(200).
		Find(&sessions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list all sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"sessions": sessions,
		"total":    len(sessions),
	})
}

// AdminDeleteSession lets admin forcefully revoke any session by ID.
func AdminDeleteSession(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session ID"})
		return
	}
	if err := model.DB.Delete(&model.UserSession{}, uint(id)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "session revoked"})
}
