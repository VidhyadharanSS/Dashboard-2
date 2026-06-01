package rbac

import (
	"fmt"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

var (
	RBACConfig *common.RolesConfig
	once       sync.Once
	rwlock     sync.RWMutex
)

func InitRBAC() {
	once.Do(func() {
		if err := model.InitDefaultRole(); err != nil {
			panic(fmt.Sprintf("failed to init default roles: %v", err))
		}
		go SyncRolesConfig()
	})
}

// loadRolesFromDB populates RBACConfig from DB rows.
// All assignments for the same role are merged into a single RoleMapping so that
// GetUserRoles correctly handles roles with many subjects.
func loadRolesFromDB() error {
	cfg := &common.RolesConfig{
		Roles:       []common.Role{},
		RoleMapping: []common.RoleMapping{},
	}

	var roles []model.Role
	if err := model.DB.Preload("Assignments").Find(&roles).Error; err != nil {
		return err
	}

	for _, r := range roles {
		cr := common.Role{
			Name:        r.Name,
			Description: r.Description,
			Clusters:    r.Clusters,
			Namespaces:  r.Namespaces,
			Resources:   r.Resources,
			Verbs:       r.Verbs,
		}
		cfg.Roles = append(cfg.Roles, cr)

		// Merge all assignments for this role into one RoleMapping entry.
		// Previously one entry was created per assignment which caused each
		// entry to only carry a single user/group — only the last one would
		// match during iteration.
		if len(r.Assignments) == 0 {
			continue
		}
		rm := common.RoleMapping{
			Name:       cr.Name,
			Users:      make([]string, 0),
			OIDCGroups: make([]string, 0),
		}
		for _, a := range r.Assignments {
			if a.SubjectType == model.SubjectTypeUser {
				rm.Users = append(rm.Users, a.Subject)
			} else {
				rm.OIDCGroups = append(rm.OIDCGroups, a.Subject)
			}
		}
		cfg.RoleMapping = append(cfg.RoleMapping, rm)
	}
	rwlock.Lock()
	RBACConfig = cfg
	rwlock.Unlock()
	return nil
}

var (
	SyncNow = make(chan struct{}, 1)
)

func SyncRolesConfig() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	SyncNow <- struct{}{}
	for {
		select {
		case <-ticker.C:
			if err := loadRolesFromDB(); err != nil {
				klog.Errorf("failed to sync rbac from db: %v", err)
			}
		case <-SyncNow:
			if err := loadRolesFromDB(); err != nil {
				klog.Errorf("failed to sync rbac from db: %v", err)
			}
		}
	}
}

// SubjectsForRole returns all DB-side subjects (usernames/emails) currently
// assigned to the role with the given name, plus the OIDC groups mapped to
// that role. Returns nil if the role does not exist in the in-memory
// snapshot.
//
// This is the unified read path used by code that needs to answer
// "which users are in role X right now?" — it matches exactly what
// GetUserRoles() returns when iterating users.
func SubjectsForRole(name string) (users []string, oidcGroups []string, ok bool) {
	rwlock.RLock()
	defer rwlock.RUnlock()
	if RBACConfig == nil {
		return nil, nil, false
	}
	for _, rm := range RBACConfig.RoleMapping {
		if rm.Name == name {
			u := make([]string, len(rm.Users))
			copy(u, rm.Users)
			g := make([]string, len(rm.OIDCGroups))
			copy(g, rm.OIDCGroups)
			return u, g, true
		}
	}
	return nil, nil, false
}
