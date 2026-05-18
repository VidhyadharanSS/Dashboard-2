package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"unicode"

	"github.com/zxh326/kite/pkg/common"
	"golang.org/x/crypto/bcrypt"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func CheckPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// SecureCompare performs a constant-time string comparison to prevent timing attacks.
// Returns true if the two strings are equal.
func SecureCompare(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

// ValidatePasswordStrength ensures a password meets minimum security requirements.
// Returns an error message if the password is too weak, or empty string if acceptable.
func ValidatePasswordStrength(password string) string {
	if len(password) < 8 {
		return "Password must be at least 8 characters long"
	}
	if len(password) > 128 {
		return "Password must be at most 128 characters long"
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit {
		return "Password must contain at least one uppercase letter, one lowercase letter, and one digit"
	}
	return ""
}

func EncryptString(input string) string {
	keyHash := sha256.Sum256([]byte(common.KiteEncryptKey))
	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return fmt.Sprintf("encryption_error: %v", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Sprintf("encryption_error: %v", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fmt.Sprintf("encryption_error: %v", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(input), nil)
	return base64.StdEncoding.EncodeToString(ciphertext)
}

func DecryptString(encrypted string) (string, error) {
	keyHash := sha256.Sum256([]byte(common.KiteEncryptKey))
	ciphertext, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}
	return string(plaintext), nil
}

