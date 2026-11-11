package pool

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
)

const ProviderID = "pool"

type Verifier interface {
	Verify(context.Context, string) (Identity, error)
}

// AccessVerifier accepts only application assertions signed by the configured team.
type AccessVerifier struct {
	issuer, audience string
	admins           map[string]bool
	client           *http.Client
	mu               sync.Mutex
	keys             map[string]*rsa.PublicKey
	fetched          time.Time
	attempted        time.Time
	now              func() time.Time
}

func NewAccessVerifier(team, audience string, admins []string) (*AccessVerifier, error) {
	team = strings.TrimSuffix(strings.TrimPrefix(team, "https://"), "/")
	if !strings.HasSuffix(team, ".cloudflareaccess.com") || strings.ContainsAny(team, "/:?#@ ") || audience == "" {
		return nil, errors.New("Access team must be a cloudflareaccess.com hostname and audience is required")
	}
	v := &AccessVerifier{issuer: "https://" + team, audience: audience, admins: map[string]bool{}, client: &http.Client{Timeout: 10 * time.Second}, keys: map[string]*rsa.PublicKey{}, now: time.Now}
	for _, email := range admins {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
			v.admins[email] = true
		}
	}
	return v, nil
}

type accessClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Type  string `json:"type"`
}

func (v *AccessVerifier) Verify(ctx context.Context, raw string) (Identity, error) {
	if len(raw) == 0 || len(raw) > 16384 {
		return Identity{}, errors.New("missing or invalid Access assertion")
	}
	claims := &accessClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) { kid, _ := token.Header["kid"].(string); return v.key(ctx, kid) }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired(), jwt.WithTimeFunc(v.now))
	if err != nil {
		return Identity{}, errors.New("invalid Access assertion")
	}
	if claims.Type != "app" {
		return Identity{}, errors.New("Access application assertion required")
	}
	if claims.Subject == "" || claims.Email == "" {
		return Identity{}, errors.New("Access user identity required")
	}
	return Identity{ID: digest(v.issuer + "\x00" + claims.Subject), Email: claims.Email, Admin: v.admins[strings.ToLower(claims.Email)]}, nil
}

func (v *AccessVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if kid == "" || len(kid) > 256 {
		return nil, errors.New("missing signing key ID")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if key := v.keys[kid]; key != nil && v.now().Sub(v.fetched) < time.Hour {
		return key, nil
	}
	// Limit unknown-key refreshes as well as normal refreshes to avoid request-driven floods.
	if !v.attempted.IsZero() && v.now().Sub(v.attempted) < time.Minute {
		return nil, errors.New("unknown Access signing key")
	}
	v.attempted = v.now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.issuer+"/cdn-cgi/access/certs", nil)
	if err != nil {
		return nil, err
	}
	response, err := v.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Access signing keys: HTTP %d", response.StatusCode)
	}
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&jwks); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, j := range jwks.Keys {
		if j.Kty != "RSA" || (j.Alg != "" && j.Alg != "RS256") {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(j.N)
		e, errE := base64.RawURLEncoding.DecodeString(j.E)
		if errN != nil || errE != nil || len(n) < 256 || len(e) == 0 || len(e) > 4 {
			continue
		}
		exp := new(big.Int).SetBytes(e).Int64()
		if exp < 3 || exp > 1<<31-1 {
			continue
		}
		keys[j.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exp)}
	}
	if len(keys) == 0 {
		return nil, errors.New("no valid Access signing keys")
	}
	v.keys = keys
	v.fetched = v.now()
	if key := keys[kid]; key != nil {
		return key, nil
	}
	return nil, errors.New("unknown Access signing key")
}

// TokenProvider feeds an opaque token ID into the existing proxy usage pipeline.
type TokenProvider struct{ Store *Store }

func (p *TokenProvider) Identifier() string { return ProviderID }
func (p *TokenProvider) Authenticate(ctx context.Context, r *http.Request) (*sdkaccess.Result, *sdkaccess.AuthError) {
	secret := bearer(r)
	if secret == "" {
		return nil, sdkaccess.NewNoCredentialsError()
	}
	t, err := p.Store.Authenticate(ctx, secret)
	if err != nil {
		return nil, sdkaccess.NewInvalidCredentialError()
	}
	return &sdkaccess.Result{Provider: ProviderID, Principal: t.ID}, nil
}

func bearer(r *http.Request) string {
	if parts := strings.Fields(r.Header.Get("Authorization")); len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return parts[1]
	}
	if value := r.Header.Get("X-Api-Key"); value != "" {
		return value
	}
	return r.Header.Get("X-Goog-Api-Key")
}
