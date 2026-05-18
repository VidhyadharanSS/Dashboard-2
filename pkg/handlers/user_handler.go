package handlers

import (
	"fmt"
	"net/http"
	"net/mail"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"k8s.io/klog/v2"
)

type createPasswordUser struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password"`
	Name     string `json:"name"`
	Email    string `json:"email"`
}

func CreateSuperUser(c *gin.Context) {
	// When OAuth bootstrap is configured, block password-based superuser creation.
	// The first admin will be created automatically on first OAuth login.
	if common.OAuthBootstrapConfigured() && common.HasConfiguredSuperAdminEmails() {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "OAuth bootstrap is configured. Please sign in with your OAuth provider to create the admin account.",
		})
		return
	}

	var userreq createPasswordUser
	if err := c.ShouldBindJSON(&userreq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// Validate username
	if strings.TrimSpace(userreq.Username) == "" {
		c.JSON(400, gin.H{"error": "Username is required"})
		return
	}

	// Validate password strength
	if pwErr := utils.ValidatePasswordStrength(userreq.Password); pwErr != "" {
		c.JSON(400, gin.H{"error": pwErr})
		return
	}

	uc, err := model.CountUsers()
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to count users"})
		return
	}

	if uc > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "super user already exists"})
		return
	}
	user := &model.User{
		Username: strings.TrimSpace(userreq.Username),
		Password: userreq.Password,
		Name:     strings.TrimSpace(userreq.Name),
		Email:    strings.TrimSpace(userreq.Email),
		Provider: "password",
	}

	if err := model.AddSuperUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to create super user"})
		return
	}
	rbac.SyncNow <- struct{}{}
	logger.Audit(user.Username, "CreateSuperUser", "users", "", "", "Super user account created",
		logger.AuditOpts{Severity: logger.AuditCritical, SourceIP: c.ClientIP()})
	c.JSON(201, user)
}

func CreatePasswordUser(c *gin.Context) {
	var userreq createPasswordUser
	if err := c.ShouldBindJSON(&userreq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if userreq.Password == "" && userreq.Email == "" {
		c.JSON(400, gin.H{"error": "password is required when no email is provided"})
		return
	}
	// Validate password strength when provided
	if userreq.Password != "" {
		if pwErr := utils.ValidatePasswordStrength(userreq.Password); pwErr != "" {
			c.JSON(400, gin.H{"error": pwErr})
			return
		}
	}
	user := &model.User{
		Username: strings.TrimSpace(userreq.Username),
		Password: userreq.Password,
		Name:     strings.TrimSpace(userreq.Name),
		Email:    strings.TrimSpace(userreq.Email),
		Provider: "password",
	}

	_, err := model.GetUserByUsername(user.Username)
	if err == nil {
		c.JSON(400, gin.H{"error": "user already exists"})
		return
	}

	if user.Email != "" {
		_, err := model.GetUserByIdentifier(user.Email)
		if err == nil {
			c.JSON(400, gin.H{"error": "email already exists"})
			return
		}
		if _, err := mail.ParseAddress(user.Email); err != nil {
			c.JSON(400, gin.H{"error": "invalid email format"})
			return
		}
	}

	if err := model.AddUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to create user"})
		return
	}
	c.JSON(201, user)
}

func BatchCreateUsers(c *gin.Context) {
	var req struct {
		Users []createPasswordUser `json:"users" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	var createdUsers []*model.User
	var errors []string

	for _, userreq := range req.Users {
		user := &model.User{
			Username: userreq.Username,
			Password: userreq.Password,
			Name:     userreq.Name,
			Email:    userreq.Email,
			Provider: "password",
		}

		if user.Username == "" {
			errors = append(errors, fmt.Sprintf("username is required for %s", user.Email))
			continue
		}

		// Basic validation
		if user.Email != "" {
			if _, err := mail.ParseAddress(user.Email); err != nil {
				errors = append(errors, fmt.Sprintf("invalid email format for %s", user.Username))
				continue
			}
		}

		if err := model.AddUser(user); err != nil {
			errors = append(errors, fmt.Sprintf("failed to create user %s: %v", user.Username, err))
			continue
		}
		createdUsers = append(createdUsers, user)
	}

	c.JSON(http.StatusOK, gin.H{
		"created": createdUsers,
		"errors":  errors,
	})
}

func ListUsers(c *gin.Context) {
	page := 1
	size := 20
	search := strings.TrimSpace(c.Query("search"))
	role := strings.TrimSpace(c.Query("role"))
	sortBy := strings.TrimSpace(c.Query("sortBy"))
	sortOrder := strings.ToLower(strings.TrimSpace(c.Query("sortOrder")))
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	if p := c.Query("page"); p != "" {
		_, _ = fmt.Sscanf(p, "%d", &page)
		if page <= 0 {
			page = 1
		}
	}
	if s := c.Query("size"); s != "" {
		_, _ = fmt.Sscanf(s, "%d", &size)
		if size <= 0 {
			size = 20
		}
	}
	offset := (page - 1) * size

	users, total, err := model.ListUsers(
		size,
		offset,
		search,
		sortBy,
		sortOrder,
		role,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to list users"})
		return
	}
	for i := range users {
		users[i].Roles = rbac.GetUserRoles(users[i])
	}
	c.JSON(200, gin.H{"users": users, "total": total, "page": page, "size": size})
}

func UpdateUser(c *gin.Context) {
	var id uint64
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url,omitempty"`
		Email     string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	user, err := model.GetUserByID(id)
	if err != nil {
		c.JSON(404, gin.H{"error": "user not found"})
		return
	}
	if req.Name != "" {
		user.Name = req.Name
	}
	if req.AvatarURL != "" {
		user.AvatarURL = req.AvatarURL
	}
	if req.Email != "" {
		// check if email is unique if changed
		if user.Email != req.Email {
			existing, err := model.GetUserByIdentifier(req.Email)
			if err == nil && existing.ID != user.ID {
				c.JSON(400, gin.H{"error": "email already exists"})
				return
			}
			user.Email = req.Email
		}
		if _, err := mail.ParseAddress(req.Email); err != nil {
			c.JSON(400, gin.H{"error": "invalid email format"})
			return
		}
	}

	if err := model.UpdateUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to update user"})
		return
	}
	c.JSON(200, user)
}

func DeleteUser(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	// Look up target user before deletion for audit log
	target, _ := model.GetUserByID(uint64(id))
	targetName := fmt.Sprintf("user#%d", id)
	if target != nil {
		targetName = target.Key()
	}

	if err := model.DeleteUserByID(id); err != nil {
		c.JSON(500, gin.H{"error": "failed to delete user"})
		return
	}

	admin := c.MustGet("user").(model.User)
	logger.Audit(admin.Key(), "DeleteUser", "users", "", "",
		fmt.Sprintf("Deleted user %s", targetName),
		logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP()})

	c.JSON(200, gin.H{"success": true})
}

func BatchDeleteUsers(c *gin.Context) {
	var req struct {
		IDs []uint `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	var deleted []uint
	var errors []string

	for _, id := range req.IDs {
		if err := model.DeleteUserByID(id); err != nil {
			errors = append(errors, fmt.Sprintf("failed to delete user %d: %v", id, err))
			continue
		}
		deleted = append(deleted, id)
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted": deleted,
		"errors":  errors,
	})
}

func ResetPassword(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	// Validate password strength
	if pwErr := utils.ValidatePasswordStrength(req.Password); pwErr != "" {
		c.JSON(400, gin.H{"error": pwErr})
		return
	}
	if err := model.ResetPasswordByID(id, req.Password); err != nil {
		c.JSON(500, gin.H{"error": "failed to reset password"})
		return
	}
	// Audit log password reset
	admin := c.MustGet("user").(model.User)
	target, _ := model.GetUserByID(uint64(id))
	targetName := fmt.Sprintf("user#%d", id)
	if target != nil {
		targetName = target.Key()
	}
	logger.Audit(admin.Key(), "ResetPassword", "users", "", "",
		fmt.Sprintf("Password reset for user %s", targetName),
		logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP()})

	// Invalidate all sessions for the user whose password was reset
	if target != nil {
		model.DB.Where("user_id = ?", target.ID).Delete(&model.UserSession{})
	}

	c.JSON(200, gin.H{"success": true})
}

func SetUserEnabled(c *gin.Context) {
	var id uint
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := model.SetUserEnabled(id, req.Enabled); err != nil {
		c.JSON(500, gin.H{"error": "failed to set enabled"})
		return
	}
	// Audit log and invalidate sessions on disable
	admin := c.MustGet("user").(model.User)
	target, _ := model.GetUserByID(uint64(id))
	targetName := fmt.Sprintf("user#%d", id)
	if target != nil {
		targetName = target.Key()
	}
	action := "EnableUser"
	if !req.Enabled {
		action = "DisableUser"
		// Invalidate all sessions when a user is disabled
		model.DB.Where("user_id = ?", id).Delete(&model.UserSession{})
	}
	logger.Audit(admin.Key(), action, "users", "", "",
		fmt.Sprintf("User %s %s", targetName, strings.ToLower(action)),
		logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP()})

	c.JSON(200, gin.H{"success": true})
}

func GetFavorites(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	c.JSON(200, gin.H{"favorites": user.Favorites})
}

func UpdateFavorites(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	var req struct {
		Favorites string `json:"favorites" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user.Favorites = req.Favorites
	if err := model.UpdateUser(&user); err != nil {
		klog.Errorf("failed to update favorites for user %s: %v", user.Username, err)
		c.JSON(500, gin.H{"error": "failed to update favorites"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func UpdateSidebarPreference(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	var req struct {
		SidebarPreference string `json:"sidebar_preference" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user.SidebarPreference = req.SidebarPreference
	if err := model.UpdateUser(&user); err != nil {
		klog.Errorf("failed to update sidebar preference for user %s: %v", user.Username, err)
		c.JSON(500, gin.H{"error": "failed to update sidebar preference"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

