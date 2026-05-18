package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"reflect"
	"testing"
)

func TestLoadEnvsParsesConfiguredSuperAdminEmails(t *testing.T) {
	originalEmails := SuperAdminEmails
	defer func() {
		SuperAdminEmails = originalEmails
	}()

	t.Setenv("KITE_INSECURE_DEV", "true")
	t.Setenv("KITE_SUPERADMIN_EMAILS", " prabhusarathy.g@zohocorp.com,akash.varen@zohocorp.com, prabhusarathy.g@zohocorp.com ,SIVASAILESH.VB@zohocorp.com ")
	t.Setenv("KITE_SUPERADMIN_EMAIL", "")

	LoadEnvs()

	want := []string{
		"prabhusarathy.g@zohocorp.com",
		"akash.varen@zohocorp.com",
		"sivasailesh.vb@zohocorp.com",
	}
	if !reflect.DeepEqual(SuperAdminEmails, want) {
		t.Fatalf("SuperAdminEmails = %v, want %v", SuperAdminEmails, want)
	}

	if !IsConfiguredSuperAdminEmail("Akash.Varen@zohocorp.com") {
		t.Fatalf("expected IsConfiguredSuperAdminEmail to match normalized email")
	}
}

func TestLoadEnvsDecryptsBootstrapClientSecret(t *testing.T) {
	originalKey := KiteEncryptKey
	originalClientSecret := OAuthBootstrapClientSecret
	defer func() {
		KiteEncryptKey = originalKey
		OAuthBootstrapClientSecret = originalClientSecret
	}()

	t.Setenv("KITE_ENCRYPT_KEY", "unit-test-encryption-key")
	t.Setenv("KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET_ENCRYPTED", encryptForTest(t, "plain-client-secret", "unit-test-encryption-key"))
	t.Setenv("KITE_OAUTH_BOOTSTRAP_CLIENT_SECRET", "")

	LoadEnvs()

	if OAuthBootstrapClientSecret != "plain-client-secret" {
		t.Fatalf("OAuthBootstrapClientSecret = %q, want %q", OAuthBootstrapClientSecret, "plain-client-secret")
	}
}

func encryptForTest(t *testing.T, plaintext, key string) string {
	t.Helper()

	keyHash := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		t.Fatalf("aes.NewCipher() error = %v", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM() error = %v", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("ReadFull() error = %v", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext)
}