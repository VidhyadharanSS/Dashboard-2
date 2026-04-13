package common

type Verb string

const (
	VerbGet    Verb = "get"
	VerbList   Verb = "list"
	VerbCreate Verb = "create"
	VerbUpdate Verb = "update"
	VerbDelete Verb = "delete"
	VerbPatch  Verb = "patch"
	VerbApply  Verb = "apply"
	VerbLog    Verb = "log"
	VerbExec   Verb = "exec"
	VerbWatch  Verb = "watch"
)

// AllVerbs returns the list of known verbs for UI rendering and validation.
func AllVerbs() []string {
	return []string{
		string(VerbGet), string(VerbList), string(VerbCreate),
		string(VerbUpdate), string(VerbDelete), string(VerbPatch),
		string(VerbApply), string(VerbLog), string(VerbExec), string(VerbWatch),
	}
}

type Role struct {
	Name        string   `yaml:"name" json:"name"`
	Description string   `yaml:"description" json:"-"`
	Clusters    []string `yaml:"clusters" json:"clusters"`
	Resources   []string `yaml:"resources" json:"resources"`
	Namespaces  []string `yaml:"namespaces" json:"namespaces"`
	Verbs       []string `yaml:"verbs" json:"verbs"`
}

type RoleMapping struct {
	Name       string   `yaml:"name" json:"name"`
	Users      []string `yaml:"users,omitempty" json:"users,omitempty"`
	OIDCGroups []string `yaml:"oidcGroups,omitempty" json:"oidcGroups,omitempty"`
}

type RolesConfig struct {
	Roles       []Role        `yaml:"roles"`
	RoleMapping []RoleMapping `yaml:"roleMapping"`
}
