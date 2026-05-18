package handlers

import (
	"encoding/csv"
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
	"k8s.io/klog/v2"
)

// maxPageSize is the upper limit for paginated list endpoints (not the CSV export).
const maxPageSize = 500

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
		if parsed, err := strconv.Atoi(s); err == nil && parsed > 0 && parsed <= maxPageSize {
			size = parsed
		} else if parsed, err := strconv.Atoi(s); err == nil && parsed > maxPageSize {
			size = maxPageSize
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid size parameter (1-%d)", maxPageSize)})
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
		query = query.Where("resource_type LIKE ?", "%"+resourceType+"%")
	}
	if resourceName != "" {
		query = query.Where("resource_name LIKE ?", "%"+resourceName+"%")
	}
	if namespace != "" {
		query = query.Where("namespace = ?", namespace)
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("resource_name LIKE ? OR namespace LIKE ? OR resource_type LIKE ? OR error_message LIKE ?", like, like, like, like)
	}
	if operation != "" {
		ops := strings.Split(operation, ",")
		cleanOps := make([]string, 0, len(ops))
		for _, op := range ops {
			if o := strings.TrimSpace(op); o != "" {
				cleanOps = append(cleanOps, o)
			}
		}
		if len(cleanOps) == 1 {
			query = query.Where("operation_type = ?", cleanOps[0])
		} else if len(cleanOps) > 1 {
			query = query.Where("operation_type IN ?", cleanOps)
		}
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

const lightColumns = "id, created_at, updated_at, cluster_name, resource_type, resource_name, namespace, operation_type, success, error_message, source_ip, operator_id"

// ListAuditLogs returns audit logs for admin users.
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
		klog.Errorf("Audit: Failed to count logs: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve audit log count"})
		return
	}

	history := []model.ResourceHistory{}
	q := query.Preload("Operator").Order("created_at DESC").Offset((page - 1) * size).Limit(size)
	if !includeDiff {
		q = q.Select(lightColumns)
	}
	if err := q.Find(&history).Error; err != nil {
		klog.Errorf("Audit: Failed to fetch logs: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit records"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  history,
		"total": total,
		"page":  page,
		"size":  size,
	})
}

// ListAuditLogsForUser returns audit logs filtered by current user's RBAC.
func ListAuditLogsForUser(c *gin.Context) {
	page, size, _, search, operation, _,
		resourceType, resourceName, namespace, startDate, endDate, ok := parseAuditQueryParams(c)
	if !ok {
		return
	}

	user := c.MustGet("user").(model.User)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	query := buildAuditQuery(model.DB, 0, search, operation, cs.Name, resourceType, resourceName, namespace, startDate, endDate)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		klog.Errorf("Audit: User log count failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count audit logs"})
		return
	}

	history := []model.ResourceHistory{}
	if err := query.Select(lightColumns).Preload("Operator").Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&history).Error; err != nil {
		klog.Errorf("Audit: User log fetch failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
		return
	}

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

// GetAuditStats returns aggregate counts of audit operations.
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
		klog.Errorf("Audit Stats: All-time failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch aggregate stats"})
		return
	}

	since := time.Now().Add(-24 * time.Hour)
	var recent []opCount
	if err := model.DB.Model(&model.ResourceHistory{}).
		Select("operation_type, count(*) as count").
		Where("cluster_name = ? AND created_at >= ?", cs.Name, since).
		Group("operation_type").
		Find(&recent).Error; err != nil {
		klog.Errorf("Audit Stats: Last 24h failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch recent stats"})
		return
	}

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

// GetAuditLogDetailAdmin returns a single audit entry with diffs.
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
			c.JSON(http.StatusNotFound, gin.H{"error": "Audit entry not found"})
			return
		}
		klog.Errorf("Audit: Admin detail fetch failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error retrieving audit detail"})
		return
	}

	c.JSON(http.StatusOK, entry)
}

// GetAuditLogDetail returns a single audit entry with diffs (RBAC-filtered).
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
			c.JSON(http.StatusNotFound, gin.H{"error": "Audit entry not found"})
			return
		}
		klog.Errorf("Audit: Detail fetch failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	isAdmin := rbac.UserHasRole(user, "admin")
	if !isAdmin {
		ns := entry.Namespace
		if ns == "" {
			ns = "_all"
		}
		if !rbac.CanAccess(user, entry.ResourceType, "get", cs.Name, ns) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied for this audit record"})
			return
		}
	}

	c.JSON(http.StatusOK, entry)
}

// GetAuditTimeline returns a histogram of audit operations.
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
	if err := model.DB.Model(&model.ResourceHistory{}).
		Select("DATE(created_at) as day, operation_type, count(*) as count").
		Where("cluster_name = ? AND created_at >= ?", cs.Name, since).
		Group("day, operation_type").
		Order("day ASC").
		Find(&raw).Error; err != nil {
		klog.Errorf("Audit Timeline: DB query failed for cluster %s: %v", cs.Name, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate activity timeline"})
		return
	}

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

// ExportAuditLogs streams all matching audit logs as a CSV file.
func ExportAuditLogs(c *gin.Context) {
	var (
		operatorID                                                uint64
		search, operation, clusterName                            string
		resourceType, resourceName, namespace, startDate, endDate string
	)

	if op := strings.TrimSpace(c.Query("operatorId")); op != "" {
		parsed, err := strconv.ParseUint(op, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid operatorId parameter"})
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

	baseQuery := buildAuditQuery(model.DB, operatorID, search, operation, clusterName, resourceType, resourceName, namespace, startDate, endDate)

	c.Header("Content-Type", "text/csv; charset=utf-8")
	filename := fmt.Sprintf("audit-logs-%s.csv", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Header("X-Content-Type-Options", "nosniff")

	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"Time", "Operator", "Operation", "Resource Type", "Resource Name", "Namespace", "Cluster", "Status", "Error"})

	const batchSize = 1000
	offset := 0
	for {
		var batch []model.ResourceHistory
		if err := baseQuery.Select(lightColumns).Preload("Operator").
			Order("created_at DESC").Offset(offset).Limit(batchSize).
			Find(&batch).Error; err != nil {
			klog.Errorf("Audit Export: Failed at offset %d: %v", offset, err)
			return
		}
		if len(batch) == 0 {
			break
		}
		for _, h := range batch {
			operator := ""
			if h.Operator != nil {
				operator = h.Operator.Username
			}
			status := "Success"
			if !h.Success {
				status = "Failed"
			}
			_ = w.Write([]string{
				h.CreatedAt.Format("2006-01-02 15:04:05"),
				operator,
				h.OperationType,
				h.ResourceType,
				h.ResourceName,
				h.Namespace,
				h.ClusterName,
				status,
				h.ErrorMessage,
			})
		}
		w.Flush()
		if len(batch) < batchSize {
			break
		}
		offset += batchSize
	}
}

// GetAuditResourceActivity returns history for a specific resource.
func GetAuditResourceActivity(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	resType := strings.TrimSpace(c.Param("resourceType"))
	ns := strings.TrimSpace(c.Param("namespace"))
	name := strings.TrimSpace(c.Param("name"))

	if resType == "" || name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resourceType and name are required"})
		return
	}

	isAdmin := rbac.UserHasRole(user, "admin")
	nsCheck := ns
	if nsCheck == "" {
		nsCheck = "_all"
	}
	if !isAdmin && !rbac.CanAccess(user, resType, "get", cs.Name, nsCheck) {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), "get", resType, nsCheck, cs.Name)})
		return
	}

	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > maxPageSize {
		limit = 20
	}

	query := model.DB.Model(&model.ResourceHistory{}).
		Where("cluster_name = ? AND resource_type = ? AND resource_name = ?", cs.Name, resType, name)
	if ns != "" && ns != "_all" {
		query = query.Where("namespace = ?", ns)
	}

	var entries []model.ResourceHistory
	if err := query.Select(lightColumns).Preload("Operator").
		Order("created_at DESC").Limit(limit).Find(&entries).Error; err != nil {
		klog.Errorf("Audit Activity: Fetch failed for %s/%s: %v", resType, name, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch resource history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// PurgeOldAuditLogs deletes audit logs older than retention period.
func PurgeOldAuditLogs(c *gin.Context) {
	daysStr := c.DefaultQuery("retentionDays", "90")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days < 7 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "retentionDays must be an integer >= 7"})
		return
	}

	cutoff := time.Now().AddDate(0, 0, -days)

	var count int64
	if err := model.DB.Model(&model.ResourceHistory{}).Where("created_at < ?", cutoff).Count(&count).Error; err != nil {
		klog.Errorf("Audit Purge: Count failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assess entries for purge"})
		return
	}

	if count == 0 {
		c.JSON(http.StatusOK, gin.H{
			"deleted":       0,
			"retentionDays": days,
			"cutoffDate":    cutoff.Format("2006-01-02"),
			"message":       "No audit logs older than the retention period",
		})
		return
	}

	totalDeleted := int64(0)
	for {
		tx := model.DB.Where("created_at < ?", cutoff).Limit(1000).Delete(&model.ResourceHistory{})
		if tx.Error != nil {
			klog.Errorf("Audit Purge: Batch delete failed after %d rows: %v", totalDeleted, tx.Error)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   fmt.Sprintf("Database error during purge: %v", tx.Error),
				"deleted": totalDeleted,
			})
			return
		}
		
		affected := tx.RowsAffected
		totalDeleted += affected
		
		if affected < 1000 {
			break
		}
		// Small sleep to allow other DB operations to breathe
		time.Sleep(50 * time.Millisecond)
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted":       totalDeleted,
		"retentionDays": days,
		"cutoffDate":    cutoff.Format("2006-01-02"),
		"message":       fmt.Sprintf("Successfully purged %d audit log entries", totalDeleted),
	})
}

// GetAuditRetentionInfo returns metadata about audit log storage.
func GetAuditRetentionInfo(c *gin.Context) {
	var totalEntries int64
	if err := model.DB.Model(&model.ResourceHistory{}).Count(&totalEntries).Error; err != nil {
		klog.Errorf("Audit Retention: Count failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count database entries"})
		return
	}

	type ageBracket struct {
		Label string `json:"label"`
		Count int64  `json:"count"`
	}

	brackets := []struct {
		label string
		days  int
	}{
		{"Last 7 days", 7},
		{"Last 30 days", 30},
		{"Last 90 days", 90},
		{"Older than 90 days", -1},
	}

	result := make([]ageBracket, 0, len(brackets))
	for _, b := range brackets {
		var cnt int64
		if b.days > 0 {
			since := time.Now().AddDate(0, 0, -b.days)
			model.DB.Model(&model.ResourceHistory{}).Where("created_at >= ?", since).Count(&cnt)
		} else {
			since := time.Now().AddDate(0, 0, -90)
			model.DB.Model(&model.ResourceHistory{}).Where("created_at < ?", since).Count(&cnt)
		}
		result = append(result, ageBracket{Label: b.label, Count: cnt})
	}

	var oldest model.ResourceHistory
	oldestDate := ""
	if err := model.DB.Model(&model.ResourceHistory{}).Order("created_at ASC").First(&oldest).Error; err == nil {
		oldestDate = oldest.CreatedAt.Format("2006-01-02")
	}

	c.JSON(http.StatusOK, gin.H{
		"totalEntries": totalEntries,
		"oldestEntry":  oldestDate,
		"ageBrackets":  result,
	})
}

// GetAuditFilterOptions returns distinct resource types and namespaces for filter dropdowns.
func GetAuditFilterOptions(c *gin.Context) {
	types, err := model.GetDistinctResourceTypes()
	if err != nil {
		klog.Errorf("Audit Filters: Failed to fetch resource types: %v", err)
		types = []string{}
	}

	namespaces, err := model.GetDistinctNamespaces()
	if err != nil {
		klog.Errorf("Audit Filters: Failed to fetch namespaces: %v", err)
		namespaces = []string{}
	}

	c.JSON(http.StatusOK, gin.H{
		"resourceTypes": types,
		"namespaces":    namespaces,
	})
}

// GetAuditSummary returns operator activity summary.
func GetAuditSummary(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	daysStr := c.DefaultQuery("days", "7")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days <= 0 || days > 90 {
		days = 7
	}

	since := time.Now().AddDate(0, 0, -days)

	type operatorActivity struct {
		OperatorID     uint   `json:"operatorId"`
		OperatorName   string `json:"operatorName"`
		TotalChanges   int64  `json:"totalChanges"`
		Successes      int64  `json:"successes"`
		Failures       int64  `json:"failures"`
		LastActivityAt string `json:"lastActivityAt"`
	}

	type rawRow struct {
		OperatorID   uint   `gorm:"column:operator_id"`
		Username     string `gorm:"column:username"`
		TotalChanges int64  `gorm:"column:total_changes"`
		Successes    int64  `gorm:"column:successes"`
		Failures     int64  `gorm:"column:failures"`
		LastActivity string `gorm:"column:last_activity"`
	}

	var rows []rawRow
	if err := model.DB.Raw(`
		SELECT rh.operator_id,
		       u.username,
		       COUNT(*) AS total_changes,
		       SUM(CASE WHEN rh.success = 1 THEN 1 ELSE 0 END) AS successes,
		       SUM(CASE WHEN rh.success = 0 THEN 1 ELSE 0 END) AS failures,
		       MAX(rh.created_at) AS last_activity
		FROM resource_histories rh
		LEFT JOIN users u ON u.id = rh.operator_id
		WHERE rh.cluster_name = ? AND rh.created_at >= ?
		GROUP BY rh.operator_id, u.username
		ORDER BY total_changes DESC
		LIMIT 20
	`, cs.Name, since).Scan(&rows).Error; err != nil {
		klog.Errorf("Audit Summary: RAW query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate activity summary"})
		return
	}

	result := make([]operatorActivity, 0, len(rows))
	for _, r := range rows {
		result = append(result, operatorActivity{
			OperatorID:     r.OperatorID,
			OperatorName:   r.Username,
			TotalChanges:   r.TotalChanges,
			Successes:      r.Successes,
			Failures:       r.Failures,
			LastActivityAt: r.LastActivity,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data": result,
		"days": days,
	})
}
