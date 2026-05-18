package model

import (
	"errors"

	"gorm.io/gorm"
)

// SystemSetting is a simple key-value store for application-level configuration
// that can be changed at runtime via the admin API (e.g., disable password login).
type SystemSetting struct {
	// Column is named "setting_key" to avoid the SQL reserved word "key".
	Key   string `json:"key" gorm:"column:setting_key;primaryKey;type:varchar(100)"`
	Value string `json:"value" gorm:"column:setting_value;type:text;not null"`
}

// Well-known setting keys
const (
	SettingPasswordLoginDisabled = "password_login_disabled"
)

// GetSetting retrieves a setting value by key. Returns empty string if not found.
func GetSetting(key string) string {
	var s SystemSetting
	if err := DB.Where("setting_key = ?", key).First(&s).Error; err != nil {
		return ""
	}
	return s.Value
}

// SetSetting upserts a setting value.
func SetSetting(key, value string) error {
	var s SystemSetting
	err := DB.Where("setting_key = ?", key).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DB.Create(&SystemSetting{Key: key, Value: value}).Error
	}
	if err != nil {
		return err
	}
	s.Value = value
	return DB.Save(&s).Error
}

// IsPasswordLoginDisabled returns true if password-based authentication has been
// disabled by an admin at runtime, OR if the DISABLE_PASSWORD_LOGIN env var is set.
func IsPasswordLoginDisabled() bool {
	return GetSetting(SettingPasswordLoginDisabled) == "true"
}

