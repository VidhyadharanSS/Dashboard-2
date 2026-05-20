package utils

import "strings"

// GuessSearchResources parses prefixed search queries like "pod nginx" or "svc frontend"
// and returns the resource type filter + cleaned query string.
func GuessSearchResources(query string) (string, string) {
	guessSearchResources := "all"
	query = strings.TrimSpace(query)
	q := strings.Split(query, " ")
	if len(q) < 2 {
		return guessSearchResources, query
	}

	prefix := strings.ToLower(q[0])
	switch prefix {
	case "po", "pod", "pods":
		guessSearchResources = "pods"
	case "svc", "service", "services":
		guessSearchResources = "services"
	case "pv", "persistentvolume", "persistentvolumes":
		guessSearchResources = "persistentvolumes"
	case "pvc", "persistentvolumeclaim", "persistentvolumeclaims":
		guessSearchResources = "persistentvolumeclaims"
	case "cm", "configmap", "configmaps":
		guessSearchResources = "configmaps"
	case "secret", "secrets":
		guessSearchResources = "secrets"
	case "dep", "deploy", "deployment", "deployments":
		guessSearchResources = "deployments"
	case "ds", "daemonset", "daemonsets":
		guessSearchResources = "daemonsets"
	case "sts", "statefulset", "statefulsets":
		guessSearchResources = "statefulsets"
	case "job", "jobs":
		guessSearchResources = "jobs"
	case "cj", "cronjob", "cronjobs":
		guessSearchResources = "cronjobs"
	case "ing", "ingress", "ingresses":
		guessSearchResources = "ingresses"
	case "node", "nodes", "no":
		guessSearchResources = "nodes"
	case "ns", "namespace", "namespaces":
		guessSearchResources = "namespaces"
	case "hpa", "horizontalpodautoscaler", "horizontalpodautoscalers":
		guessSearchResources = "horizontalpodautoscalers"
	case "sa", "serviceaccount", "serviceaccounts":
		guessSearchResources = "serviceaccounts"
	case "sc", "storageclass", "storageclasses":
		guessSearchResources = "storageclasses"
	case "rb", "rolebinding", "rolebindings":
		guessSearchResources = "rolebindings"
	case "cr", "clusterrole", "clusterroles":
		guessSearchResources = "clusterroles"
	case "rs", "replicaset", "replicasets":
		guessSearchResources = "replicasets"
	default:
		return "all", query
	}
	return guessSearchResources, strings.Join(q[1:], " ")
}

// FuzzyMatch checks if a name matches a query using case-insensitive substring matching
// and simple character-by-character fuzzy matching for typo tolerance.
func FuzzyMatch(name, query string) (bool, int) {
	nameLower := strings.ToLower(name)
	queryLower := strings.ToLower(query)

	// Exact match
	if nameLower == queryLower {
		return true, 1000
	}

	// Prefix match
	if strings.HasPrefix(nameLower, queryLower) {
		return true, 500
	}

	// Contains match
	if strings.Contains(nameLower, queryLower) {
		return true, 200
	}

	// Fuzzy: check if all query chars appear in order within the name
	qi := 0
	for ni := 0; ni < len(nameLower) && qi < len(queryLower); ni++ {
		if nameLower[ni] == queryLower[qi] {
			qi++
		}
	}
	if qi == len(queryLower) {
		// All characters matched in order — score based on how tight the match is
		score := 50 + (len(queryLower) * 10)
		return true, score
	}

	return false, 0
}
