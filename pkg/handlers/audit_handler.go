package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
)

// parseAuditQueryParams extracts and validates common query parameters for audit endpoints.
func parseAuditQueryParams(c *gin.Context) (page, size int, operatorID uint64,
	search, operation, clusterName, resourceType, resourceName, namespace, startDate, endDate string, ok bool) {

	page = 1
	size = 20
	ok = true

	if p := strings.TrimSpace(c.Query("page")); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page parameter"})
			ok = false
			return
		}
	}
	if s := strings.TrimSpace(c.Query("size")); s != "" {
		if parsed, err := strconv.Atoi(s); err == nil && parsed > 0 && parsed <= 200 {
			size = parsed
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid size parameter (1-200)"})
			ok = false
			return
		}
	}

	if op := strings.TrimSpace(c.Query("operatorId")); op != "" {
		parsed, err := strconv.ParseUint(op, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid operatorId parameter"})
			ok = false
			return
		}
		operatorID = parsed
	}

	search = strings.TrimSpace(c.Query("search"))
	operation = strings.TrimSpace(c.Query("operation"))
	clusterName = strings.TrimSpace(c.Query("cluster"))
	resourceType = strings.TrimSpace(c.Query("resourceType"))
	resourceName = strings.TrimSpace(c.Query("resourceName"))
	namespace = strings.TrimSpace(c.Query("namespace"))
	startDate = strings.TrimSpace(c.Query("startDate"))
	endDate = strings.TrimSpace(c.Query("endDate"))

	return
}

// buildAuditQuery builds a filtered GORM query for audit logs.
func buildAuditQuery(db *gorm.DB, operatorID uint64, search, operation, clusterName, resourceType, resourceName, namespace, startDate, endDate string) *gorm.DB {
	query := db.Model(&model.ResourceHistory{})

	if operatorID > 0 {
		query = query.Where("operator_id = ?", operatorID)
	}
	if clusterName != "" {
		query = query.Where("cluster_name = ?", clusterName)
	}
	if resourceType != "" {
		query = query.Where("resource_type = ?", resourceType)
	}
	if resourceName != "" {
		query = query.Where("resource_name = ?", resourceName)
	}
	if namespace != "" {
		query = query.Where("namespace = ?", namespace)
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("resource_name LIKE ? OR namespace LIKE ? OR resource_type LIKE ?", like, like, like)
	}
	if operation != "" {
		query = query.Where("operation_type = ?", operation)
	}
	if startDate != "" {
		if t, err := time.Parse("2006-01-02", startDate); err == nil {
			query = query.Where("created_at >= ?", t)
		}
	}
	if endDate != "" {
		if t, err := time.Parse("2006-01-02", endDate); err == nil {
			query = query.Where("created_at < ?", t.AddDate(0, 0, 1))
		}
	}

	return query
}

// lightColumns is the list of columns to select when YAML blobs are not needed.
const lightColumns = "id, created_at, updated_at, cluster_name, resource_type, resource_name, namespace, operation_type, success, error_message, operator_id"

// ListAuditLogs returns audit logs for admin users (all clusters / all resources).
func ListAuditLogs(c *gin.Context) {
	page, size, operatorID, search, operation, clusterName,
		resourceType, resourceName, namespace, startDate, endDate, ok := parseAuditQueryParams(c)
	if !ok {
		return
	}

	includeDiff := strings.TrimSpace(c.Query("includeDiff")) == "true"

	query := buildAuditQuery(model.DB, operatorID, search, operation, clusterName, resourceType, resourceName, namespace, startDate, endDate)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	history := []model.ResourceHistory{}
	q := query.Preload("Operator").Order("created_at DESC").Offset((page - 1) * size).Limit(size)
	if !includeDiff {
		q = q.Select(lightColumns)
	}
	if err := q.Find(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  history,
		"total": total,
		"page":  page,
		"size":  size,
	})
}

// ListAuditLogsForUser returns audit logs filtered by the current user's RBAC permissions.
// This is the non-admin endpoint accessible from the header drawer.
func ListAuditLogsForUser(c *gin.Context) {
	page, size, _, search, operation, _,
		resourceType, resourceName, namespace, startDate, endDate, ok := parseAuditQueryParams(c)
	if !ok {
		return
	}

	user := c.MustGet("user").(model.User)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// cs.Name is passed as clusterName — buildAuditQuery already adds the WHERE clause
	query := buildAuditQuery(model.DB, 0, search, operation, cs.Name, resourceType, resourceName, namespace, startDate, endDate)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	history := []model.ResourceHistory{}
	if err := query.Select(lightColumns).Preload("Operator").Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Post-filter by RBAC: only show entries for resources the user can at least "get"
	isAdmin := rbac.UserHasRole(user, "admin")
	if !isAdmin {
		filtered := make([]model.ResourceHistory, 0, len(history))
		for _, h := range history {
			ns := h.Namespace
			if ns == "" {
				ns = "_all"
			}
			if rbac.CanAccess(user, h.ResourceType, "get", cs.Name, ns) {
				filtered = append(filtered, h)
			}
		}
		history = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  history,
		"total": total,
		"page":  page,
		"size":  size,
	})
}

// GetAuditStats returns aggregate counts of audit operations for the current cluster.
// Optimized: compute totals from the aggregates instead of extra COUNT queries.
func GetAuditStats(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	type opCount struct {
		OperationType string `json:"operationType"`
		Count         int64  `json:"count"`
	}

	var stats []opCount
	if err := model.DB.Model(&model.ResourceHistory{}).
		Select("operation_type, count(*) as count").
		Where("cluster_name = ?", cs.Name).
		Group("operation_type").
		Find(&stats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	since := time.Now().Add(-24 * time.Hour)
	var recent []opCount
	if err := model.DB.Model(&model.ResourceHistory{}).
		Select("operation_type, count(*) as count").
		Where("cluster_name = ? AND created_at >= ?", cs.Name, since).
		Group("operation_type").
		Find(&recent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Compute totals from aggregates — avoid extra COUNT queries
	var totalAll int64
	for _, s := range stats {
		totalAll += s.Count
	}
	var total24h int64
	for _, r := range recent {
		total24h += r.Count
	}

	c.JSON(http.StatusOK, gin.H{
		"allTime":  stats,
		"last24h":  recent,
		"totalAll": totalAll,
		"total24h": total24h,
	})
}

// GetAuditLogDetailAdmin returns a single audit entry including YAML diffs.
// Admin-only — no cluster context or RBAC filtering required.
func GetAuditLogDetailAdmin(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var entry model.ResourceHistory
	if err := model.DB.Preload("Operator").Where("id = ?", id).First(&entry).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, entry)
}

// GetAuditLogDetail returns a single audit entry including YAML diffs.
// Available to any authenticated user (RBAC-filtered).
func GetAuditLogDetail(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	user := c.MustGet("user").(model.User)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	var entry model.ResourceHistory
	if err := model.DB.Preload("Operator").Where("id = ? AND cluster_name = ?", id, cs.Name).First(&entry).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// RBAC check
	isAdmin := rbac.UserHasRole(user, "admin")
	if !isAdmin {
		ns := entry.Namespace
		if ns == "" {
			ns = "_all"
		}
		if !rbac.CanAccess(user, entry.ResourceType, "get", cs.Name, ns) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
	}

	c.JSON(http.StatusOK, entry)
}

// GetAuditTimeline returns a histogram of audit operations bucketed by day/hour.
// Used for the activity timeline chart in the drawer.
func GetAuditTimeline(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	daysStr := c.DefaultQuery("days", "7")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days <= 0 || days > 90 {
		days = 7
	}

	since := time.Now().AddDate(0, 0, -days)

	type rawBucket struct {
		Day           string `json:"day"`
		OperationType string `json:"operationType"`
		Count         int64  `json:"count"`
	}

	var raw []rawBucket
	// Group by day and operation type
	if err := model.DB.Model(&model.ResourceHistory{}).
		Select("DATE(created_at) as day, operation_type, count(*) as count").
		Where("cluster_name = ? AND created_at >= ?", cs.Name, since).
		Group("day, operation_type").
		Order("day ASC").
		Find(&raw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Build full day range even for days with no activity
	bucketMap := make(map[string]map[string]int64)
	for d := 0; d <= days; d++ {
		day := since.AddDate(0, 0, d).Format("2006-01-02")
		bucketMap[day] = map[string]int64{
			"create": 0, "update": 0, "delete": 0, "patch": 0, "apply": 0,
		}
	}

	for _, r := range raw {
		if _, ok := bucketMap[r.Day]; !ok {
			bucketMap[r.Day] = map[string]int64{
				"create": 0, "update": 0, "delete": 0, "patch": 0, "apply": 0,
			}
		}
		bucketMap[r.Day][strings.ToLower(r.OperationType)] = r.Count
	}

	type timelineBucket struct {
		Timestamp string `json:"timestamp"`
		Create    int64  `json:"create"`
		Update    int64  `json:"update"`
		Delete    int64  `json:"delete"`
		Patch     int64  `json:"patch"`
		Apply     int64  `json:"apply"`
		Total     int64  `json:"total"`
	}

	result := make([]timelineBucket, 0, len(bucketMap))
	for d := 0; d <= days; d++ {
		day := since.AddDate(0, 0, d).Format("2006-01-02")
		ops := bucketMap[day]
		total := ops["create"] + ops["update"] + ops["delete"] + ops["patch"] + ops["apply"]
		result = append(result, timelineBucket{
			Timestamp: fmt.Sprintf("%sT00:00:00Z", day),
			Create:    ops["create"],
			Update:    ops["update"],
			Delete:    ops["delete"],
			Patch:     ops["patch"],
			Apply:     ops["apply"],
			Total:     total,
		})
	}

	c.JSON(http.StatusOK, result)
}

// ExportAuditLogs returns audit logs as CSV for admin users.
func ExportAuditLogs(c *gin.Context) {
	_, _, operatorID, search, operation, clusterName,
		resourceType, resourceName, namespace, startDate, endDate, ok := parseAuditQueryParams(c)
	if !ok {
		return
	}

	query := buildAuditQuery(model.DB, operatorID, search, operation, clusterName, resourceType, resourceName, namespace, startDate, endDate)

	history := []model.ResourceHistory{}
	if err := query.Select(lightColumns).Preload("Operator").Order("created_at DESC").Limit(10000).Find(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "text/csv")
	c.Header("Content-Disposition", "attachment; filename=audit-logs.csv")

	// Write CSV header
	c.Writer.WriteString("Time,Operator,Operation,Resource Type,Resource Name,Namespace,Cluster,Status,Error\n")
	for _, h := range history {
		operator := ""
		if h.Operator != nil {
			operator = h.Operator.Username
		}
		status := "Success"
		if !h.Success {
			status = "Failed"
		}
		errMsg := strings.ReplaceAll(h.ErrorMessage, "\"", "\"\"")
		line := strings.Join([]string{
			`"` + h.CreatedAt.Format("2006-01-02 15:04:05") + `"`,
			`"` + operator + `"`,
			`"` + h.OperationType + `"`,
			`"` + h.ResourceType + `"`,
			`"` + h.ResourceName + `"`,
			`"` + h.Namespace + `"`,
			`"` + h.ClusterName + `"`,
			`"` + status + `"`,
			`"` + errMsg + `"`,
		}, ",")
		c.Writer.WriteString(line + "\n")
	}
}
