package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

// SessionWithCurrent wraps a session with a flag indicating if it's the caller's current session.
type SessionWithCurrent struct {
	model.UserSession
	IsCurrent bool        `json:"isCurrent"`
	UserInfo  *SafeUser   `json:"user"`
}

// SafeUser contains only the fields safe to expose in session listings.
type SafeUser struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name,omitempty"`
	Email    string `json:"email,omitempty"`
	Provider string `json:"provider,omitempty"`
}

func ListUserSessions(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	sessions, err := model.ListUserSessions(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list sessions"})
		return
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
		"sessions":    enriched,
		"total":       len(sessions),
		"currentUser": user.Username,
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

	// Enrich with isCurrent flag and safe user info
	currentToken, _ := c.Cookie("auth_token")
	enriched := make([]SessionWithCurrent, len(sessions))
	for i, s := range sessions {
		sc := SessionWithCurrent{
			UserSession: s,
			IsCurrent:   s.Token == currentToken,
		}
		if s.User.ID != 0 {
			sc.UserInfo = &SafeUser{
				ID:       s.User.ID,
				Username: s.User.Username,
				Name:     s.User.Name,
				Email:    s.User.Email,
				Provider: s.User.Provider,
			}
		}
		// Clear the embedded User to avoid leaking sensitive fields
		sc.UserSession.User = model.User{}
		enriched[i] = sc
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": enriched,
		"total":    len(enriched),
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
