package handlers

import (
	"fmt"
	"net/http"
	"net/mail"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

type createPasswordUser struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password"`
	Name     string `json:"name"`
	Email    string `json:"email"`
}

func CreateSuperUser(c *gin.Context) {
	var userreq createPasswordUser
	if err := c.ShouldBindJSON(&userreq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
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
		Username: userreq.Username,
		Password: userreq.Password,
		Name:     userreq.Name,
		Email:    userreq.Email,
		Provider: "password",
	}

	if err := model.AddSuperUser(user); err != nil {
		c.JSON(500, gin.H{"error": "failed to create super user"})
		return
	}
	rbac.SyncNow <- struct{}{}
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
	// check only admin or users count is zero
	user := &model.User{
		Username: userreq.Username,
		Password: userreq.Password,
		Name:     userreq.Name,
		Email:    userreq.Email,
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

	if err := model.DeleteUserByID(id); err != nil {
		c.JSON(500, gin.H{"error": "failed to delete user"})
		return
	}
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
	if err := model.ResetPasswordByID(id, req.Password); err != nil {
		c.JSON(500, gin.H{"error": "failed to reset password"})
		return
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
