package model

import (
	"time"
)

type ResourceHistory struct {
	ID          uint      `json:"id" gorm:"primarykey"`
	CreatedAt   time.Time `json:"createdAt" gorm:"index:idx_resource_histories_lookup_with_time,priority:5,sort:desc"`
	UpdatedAt   time.Time `json:"updatedAt"`
	ClusterName string    `json:"clusterName" gorm:"type:varchar(100);not null;index:idx_resource_histories_lookup_with_time,priority:1"`

	ResourceType string `json:"resourceType" gorm:"type:varchar(50);not null;index:idx_resource_histories_lookup_with_time,priority:2"`
	ResourceName string `json:"resourceName" gorm:"type:varchar(255);not null;index:idx_resource_histories_lookup_with_time,priority:3"`
	Namespace    string `json:"namespace" gorm:"type:varchar(100);index:idx_resource_histories_lookup_with_time,priority:4"`

	OperationType string `json:"operationType" gorm:"type:varchar(50);not null;index:idx_resource_histories_op_type;index:idx_resource_histories_cluster_op,priority:2"`

	ResourceYAML string `json:"resourceYaml" gorm:"type:text"`
	PreviousYAML string `json:"previousYaml" gorm:"type:text"`

	Success      bool   `json:"success" gorm:"type:boolean"`
	ErrorMessage string `json:"errorMessage" gorm:"type:text"`

	SourceIP string `json:"sourceIP,omitempty" gorm:"type:varchar(45)"` // IPv4/IPv6 address

	OperatorID uint  `json:"operatorId" gorm:"not null;index"`
	Operator   *User `json:"operator" gorm:"foreignKey:OperatorID;constraint:OnDelete:CASCADE"`
}

func (ResourceHistory) TableName() string {
	return "resource_histories"
}

// GetDistinctResourceTypes returns all unique resource types in the history table.
func GetDistinctResourceTypes() ([]string, error) {
	var types []string
	err := DB.Model(&ResourceHistory{}).Distinct("resource_type").Pluck("resource_type", &types).Error
	return types, err
}

// GetDistinctNamespaces returns all unique namespaces in the history table.
func GetDistinctNamespaces() ([]string, error) {
	var namespaces []string
	err := DB.Model(&ResourceHistory{}).Where("namespace != ''").Distinct("namespace").Pluck("namespace", &namespaces).Error
	return namespaces, err
}

