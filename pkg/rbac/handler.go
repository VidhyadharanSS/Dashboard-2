package rbac

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

// ListRoles returns all roles with assignments
func ListRoles(c *gin.Context) {
	var roles []model.Role
	if err := model.DB.Preload("Assignments").Find(&roles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list roles: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"roles": roles})
}

// GetRole returns a single role by id
func GetRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var role model.Role
	if err := model.DB.Preload("Assignments").First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"role": role})
}

// CreateRole creates a new role
func CreateRole(c *gin.Context) {
	var role model.Role
	if err := c.ShouldBindJSON(&role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if role.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name is required"})
		return
	}
	if err := model.DB.Create(&role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create role: " + err.Error()})
		return
	}
	// refresh in-memory config
	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusCreated, gin.H{"role": role})
}

// UpdateRole updates an existing role
func UpdateRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var req model.Role
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var role model.Role
	if err := model.DB.First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	// update fields
	role.Name = req.Name
	role.Description = req.Description
	role.Clusters = req.Clusters
	role.Namespaces = req.Namespaces
	role.Resources = req.Resources
	role.Verbs = req.Verbs

	if err := model.DB.Save(&role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role: " + err.Error()})
		return
	}
	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusOK, gin.H{"role": role})
}

// DeleteRole deletes a role and its assignments
func DeleteRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	if err := model.DB.Delete(&model.Role{}, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete role: " + err.Error()})
		return
	}
	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Assignment APIs
type roleAssignmentReq struct {
	SubjectType string `json:"subjectType" binding:"required"`
	Subject     string `json:"subject" binding:"required"`
}

// AssignRole assigns a role to a user or group
func AssignRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var req roleAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// validate subject type
	if req.SubjectType != model.SubjectTypeUser && req.SubjectType != model.SubjectTypeGroup {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subjectType must be 'user' or 'group'"})
		return
	}
	// ensure role exists
	var role model.Role
	if err := model.DB.First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	// check exists
	var existing model.RoleAssignment
	if err := model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?", role.ID, req.SubjectType, req.Subject).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"assignment": existing})
		return
	}

	assignment := model.RoleAssignment{
		RoleID:      role.ID,
		SubjectType: req.SubjectType,
		Subject:     req.Subject,
	}
	if err := model.DB.Create(&assignment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create assignment: " + err.Error()})
		return
	}
	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusCreated, gin.H{"assignment": assignment})
}

// UnassignRole removes an assignment. Accepts query params subjectType and subject.
func UnassignRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	subjectType := c.Query("subjectType")
	subject := c.Query("subject")
	if subjectType == "" || subject == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subjectType and subject query params are required"})
		return
	}
	if err := model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?", uint(dbID), subjectType, subject).Delete(&model.RoleAssignment{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove assignment: " + err.Error()})
		return
	}
	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CheckPermission checks if the current user has access to a specific resource/verb/cluster/namespace.
// Used by the frontend to gate UI features without making real API calls to Kubernetes.
func CheckPermission(c *gin.Context) {
	user := c.MustGet("user").(model.User)

	resource := strings.TrimSpace(c.Query("resource"))
	verb := strings.TrimSpace(c.Query("verb"))
	cluster := strings.TrimSpace(c.Query("cluster"))
	namespace := strings.TrimSpace(c.Query("namespace"))

	if resource == "" || verb == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resource and verb query params are required"})
		return
	}
	if namespace == "" {
		namespace = "_all"
	}

	allowed := CanAccess(user, resource, verb, cluster, namespace)
	c.JSON(http.StatusOK, gin.H{
		"allowed":   allowed,
		"resource":  resource,
		"verb":      verb,
		"cluster":   cluster,
		"namespace": namespace,
	})
}

// GetMyPermissions returns a summary of the current user's roles and accessible resources.
func GetMyPermissions(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	roles := GetUserRoles(user)

	type permissionSummary struct {
		RoleName   string   `json:"roleName"`
		Clusters   []string `json:"clusters"`
		Namespaces []string `json:"namespaces"`
		Resources  []string `json:"resources"`
		Verbs      []string `json:"verbs"`
	}

	summaries := make([]permissionSummary, 0, len(roles))
	for _, r := range roles {
		summaries = append(summaries, permissionSummary{
			RoleName:   r.Name,
			Clusters:   r.Clusters,
			Namespaces: r.Namespaces,
			Resources:  r.Resources,
			Verbs:      r.Verbs,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"username": user.Key(),
		"isAdmin":  UserHasRole(user, "admin"),
		"roles":    summaries,
	})
}

// BulkAssignRole assigns a role to multiple subjects in one request.
func BulkAssignRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}

	var req struct {
		Subjects []roleAssignmentReq `json:"subjects" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Subjects) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subjects array must not be empty"})
		return
	}

	var role model.Role
	if err := model.DB.First(&role, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	var created []model.RoleAssignment
	var skipped []string
	for _, s := range req.Subjects {
		if s.SubjectType != model.SubjectTypeUser && s.SubjectType != model.SubjectTypeGroup {
			skipped = append(skipped, s.Subject+": invalid subjectType")
			continue
		}
		var existing model.RoleAssignment
		if err := model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?",
			role.ID, s.SubjectType, s.Subject).First(&existing).Error; err == nil {
			skipped = append(skipped, s.Subject+": already assigned")
			continue
		}
		a := model.RoleAssignment{
			RoleID:      role.ID,
			SubjectType: s.SubjectType,
			Subject:     s.Subject,
		}
		if err := model.DB.Create(&a).Error; err != nil {
			skipped = append(skipped, s.Subject+": "+err.Error())
			continue
		}
		created = append(created, a)
	}

	select {
	case SyncNow <- struct{}{}:
	default:
	}
	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"skipped": skipped,
	})
}

// ─── Feature 1: Clone Role ──────────────────────────────────────────────────────

// CloneRole creates a deep copy of an existing role (including its assignments)
// under a new name. This is an atomic server-side operation so the frontend
// doesn't have to reconstruct the role manually.
func CloneRole(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		// When true, also clone all role-assignments (user/group mappings)
		CloneAssignments bool `json:"cloneAssignments"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Load the source role
	var source model.Role
	if err := model.DB.Preload("Assignments").First(&source, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "source role not found"})
		return
	}

	// Determine new name
	newName := strings.TrimSpace(req.Name)
	if newName == "" {
		newName = source.Name + "-copy"
	}

	// Ensure the name is unique
	var existing model.Role
	if err := model.DB.Where("name = ?", newName).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "a role with name '" + newName + "' already exists"})
		return
	}

	newDesc := req.Description
	if newDesc == "" {
		newDesc = source.Description
	}

	clone := model.Role{
		Name:        newName,
		Description: newDesc,
		IsSystem:    false, // cloned roles are never system roles
		Clusters:    append(model.SliceString{}, source.Clusters...),
		Namespaces:  append(model.SliceString{}, source.Namespaces...),
		Resources:   append(model.SliceString{}, source.Resources...),
		Verbs:       append(model.SliceString{}, source.Verbs...),
	}

	if err := model.DB.Create(&clone).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create cloned role: " + err.Error()})
		return
	}

	// Optionally clone assignments
	clonedAssignments := 0
	if req.CloneAssignments && len(source.Assignments) > 0 {
		for _, a := range source.Assignments {
			ca := model.RoleAssignment{
				RoleID:      clone.ID,
				SubjectType: a.SubjectType,
				Subject:     a.Subject,
			}
			if err := model.DB.Create(&ca).Error; err == nil {
				clonedAssignments++
			}
		}
	}

	select {
	case SyncNow <- struct{}{}:
	default:
	}

	c.JSON(http.StatusCreated, gin.H{
		"role":               clone,
		"clonedAssignments":  clonedAssignments,
		"sourceRole":         source.Name,
	})
}

// ─── Feature 2: Effective Permissions ────────────────────────────────────────────

// effectivePermission is a flattened view of what a user is allowed to do.
type effectivePermission struct {
	Clusters   []string `json:"clusters"`
	Namespaces []string `json:"namespaces"`
	Resources  []string `json:"resources"`
	Verbs      []string `json:"verbs"`
}

// GetEffectivePermissions returns the merged effective permissions for a specific
// user. All of the user's roles are flattened into a single set of unique values
// for clusters / namespaces / resources / verbs — making it trivial to understand
// exactly what the user can do. Admin-only endpoint.
func GetEffectivePermissions(c *gin.Context) {
	username := strings.TrimSpace(c.Param("username"))
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username parameter is required"})
		return
	}

	// Find the user
	user, err := model.GetUserByUsername(username)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found: " + username})
		return
	}

	roles := GetUserRoles(*user)

	// Merge all roles into a single set
	clusterSet := make(map[string]struct{})
	nsSet := make(map[string]struct{})
	resSet := make(map[string]struct{})
	verbSet := make(map[string]struct{})

	roleNames := make([]string, 0, len(roles))
	for _, r := range roles {
		roleNames = append(roleNames, r.Name)
		for _, v := range r.Clusters {
			clusterSet[v] = struct{}{}
		}
		for _, v := range r.Namespaces {
			nsSet[v] = struct{}{}
		}
		for _, v := range r.Resources {
			resSet[v] = struct{}{}
		}
		for _, v := range r.Verbs {
			verbSet[v] = struct{}{}
		}
	}

	toSorted := func(m map[string]struct{}) []string {
		out := make([]string, 0, len(m))
		for k := range m {
			out = append(out, k)
		}
		sort.Strings(out)
		return out
	}

	isAdmin := false
	for _, rn := range roleNames {
		if rn == "admin" {
			isAdmin = true
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"username":  username,
		"isAdmin":   isAdmin,
		"roleNames": roleNames,
		"effective": effectivePermission{
			Clusters:   toSorted(clusterSet),
			Namespaces: toSorted(nsSet),
			Resources:  toSorted(resSet),
			Verbs:      toSorted(verbSet),
		},
	})
}

// ─── Feature 3: Accessible Namespaces ────────────────────────────────────────────

// ListAccessibleNamespaces returns the list of namespace patterns the current
// user has access to according to their RBAC roles. The frontend can use this
// to populate namespace selectors without trial-and-error API calls.
func ListAccessibleNamespaces(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	roles := GetUserRoles(user)

	nsSet := make(map[string]struct{})
	for _, r := range roles {
		for _, ns := range r.Namespaces {
			nsSet[ns] = struct{}{}
		}
	}

	nsList := make([]string, 0, len(nsSet))
	for ns := range nsSet {
		nsList = append(nsList, ns)
	}
	sort.Strings(nsList)

	hasWildcard := false
	for _, ns := range nsList {
		if ns == "*" {
			hasWildcard = true
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"namespaces":  nsList,
		"hasWildcard": hasWildcard,
	})
}
