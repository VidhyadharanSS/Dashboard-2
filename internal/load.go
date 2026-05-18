package internal

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"k8s.io/klog/v2"
)

var (
	kiteUsername = os.Getenv("KITE_USERNAME")
	kitePassword = os.Getenv("KITE_PASSWORD")
)

func loadUser() error {
	// If OAuth bootstrap is configured, skip password-based user creation entirely.
	if common.OAuthBootstrapConfigured() {
		klog.Info("OAuth bootstrap is configured — skipping KITE_USERNAME/KITE_PASSWORD user creation")
		return nil
	}

	if kiteUsername != "" && kitePassword != "" {
		uc, err := model.CountUsers()
		if err == nil && uc == 0 {
			klog.Infof("Creating super user %s from environment variables", kiteUsername)
			u := &model.User{
				Username: kiteUsername,
				Password: kitePassword,
			}
			err := model.AddSuperUser(u)
			if err == nil {
				rbac.SyncNow <- struct{}{}
			} else {
				return err
			}
		}
	}

	return nil
}

// loadOAuthBootstrap ensures the OAuth provider from env vars exists in the database.
// This runs idempotently — if the provider already exists, it updates the client credentials.
func loadOAuthBootstrap() error {
	if !common.OAuthBootstrapConfigured() {
		return nil
	}

	name := strings.ToLower(common.OAuthBootstrapName)
	klog.Infof("Bootstrapping OAuth provider %q from environment variables", name)

	// Look up provider by name WITHOUT filtering by enabled status.
	// GetOAuthProviderByName filters by enabled=true, which would cause us
	// to try creating a duplicate if the provider was previously disabled.
	var existing model.OAuthProvider
	findErr := model.DB.Where("name = ?", name).First(&existing).Error
	if findErr == nil {
		// Provider exists — update credentials and re-enable
		updates := map[string]interface{}{
			"client_id":     common.OAuthBootstrapClientID,
			"client_secret": model.SecretString(common.OAuthBootstrapClientSecret),
			"enabled":       true,
		}
		if common.OAuthBootstrapIssuer != "" {
			updates["issuer"] = common.OAuthBootstrapIssuer
		}
		if common.OAuthBootstrapAuthURL != "" {
			updates["auth_url"] = common.OAuthBootstrapAuthURL
		}
		if common.OAuthBootstrapTokenURL != "" {
			updates["token_url"] = common.OAuthBootstrapTokenURL
		}
		if common.OAuthBootstrapUserInfoURL != "" {
			updates["user_info_url"] = common.OAuthBootstrapUserInfoURL
		}
		if common.OAuthBootstrapScopes != "" {
			updates["scopes"] = common.OAuthBootstrapScopes
		}
		if err := model.UpdateOAuthProvider(&existing, updates); err != nil {
			return err
		}
		klog.Infof("Updated existing OAuth provider %q from env", name)

		// Ensure password login stays disabled on every boot when superadmin email is set.
		// Previously this only ran on first creation, meaning password login could be
		// re-enabled at runtime and would survive a restart.
		if common.HasConfiguredSuperAdminEmails() {
			_ = model.SetSetting(model.SettingPasswordLoginDisabled, "true")
			klog.Infof("Password login disabled (OAuth bootstrap with superadmin email)")
		}

		return nil
	}

	// Create new provider
	provider := &model.OAuthProvider{
		Name:         model.LowerCaseString(name),
		ClientID:     common.OAuthBootstrapClientID,
		ClientSecret: model.SecretString(common.OAuthBootstrapClientSecret),
		Issuer:       common.OAuthBootstrapIssuer,
		AuthURL:      common.OAuthBootstrapAuthURL,
		TokenURL:     common.OAuthBootstrapTokenURL,
		UserInfoURL:  common.OAuthBootstrapUserInfoURL,
		Scopes:       common.OAuthBootstrapScopes,
		Enabled:      true,
	}
	if err := model.CreateOAuthProvider(provider); err != nil {
		return err
	}

	klog.Infof("Created OAuth provider %q from env bootstrap", name)

	// If superadmin email is configured, also disable password login automatically
	if common.HasConfiguredSuperAdminEmails() {
		_ = model.SetSetting(model.SettingPasswordLoginDisabled, "true")
		klog.Infof("Password login disabled automatically (OAuth bootstrap with superadmin email)")
	}

	return nil
}

func loadClusters() error {
	cc, err := model.CountClusters()
	if err != nil || cc > 0 {
		return err
	}
	kubeconfigpath := ""
	if home := homedir.HomeDir(); home != "" {
		kubeconfigpath = filepath.Join(home, ".kube", "config")
	}

	if envKubeconfig := os.Getenv("KUBECONFIG"); envKubeconfig != "" {
		kubeconfigpath = envKubeconfig
	}

	config, _ := os.ReadFile(kubeconfigpath)

	if len(config) == 0 {
		return nil
	}
	kubeconfig, err := clientcmd.Load(config)
	if err != nil {
		return err
	}

	klog.Infof("Importing clusters from kubeconfig: %s", kubeconfigpath)
	cluster.ImportClustersFromKubeconfig(kubeconfig)
	return nil
}

// LoadConfigFromEnv loads configuration from environment variables.
func LoadConfigFromEnv() {
	// Bootstrap OAuth provider first (must exist before user creation)
	if err := loadOAuthBootstrap(); err != nil {
		klog.Warningf("Failed to bootstrap OAuth provider from env: %v", err)
	}

	if err := loadUser(); err != nil {
		klog.Warningf("Failed to migrate env to db user: %v", err)
	}

	if err := loadClusters(); err != nil {
		klog.Warningf("Failed to migrate env to db cluster: %v", err)
	}
}

