// Package pool provides the member portal for a shared CLIProxyAPI instance.
package pool

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

// Identity is derived exclusively from a verified Access assertion.
type Identity struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Admin bool   `json:"admin"`
	// Public GitHub profile, cached on the owner row.
	Login  string `json:"login"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type Token struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	CreatedAt  int64  `json:"created_at"`
	ExpiresAt  int64  `json:"expires_at"`
	RevokedAt  int64  `json:"revoked_at"`
	DailyLimit int64  `json:"daily_limit"`
	Owner      string `json:"owner"`
	OwnerID    string `json:"-"`
}

type Price struct {
	ID         int64   `json:"id"`
	Provider   string  `json:"provider"`
	Model      string  `json:"model"`
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
}

type Aggregate struct {
	Requests   int64 `json:"requests"`
	Tokens     int64 `json:"tokens"`
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	Cached     int64 `json:"cached"`
	Failures   int64 `json:"failures"`
	Priced     int64 `json:"priced"`
	CostMicros int64 `json:"cost_micros"`
}

type Leader struct {
	ID     string `json:"id"`
	Login  string `json:"login"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Keys   int64  `json:"keys"`
	Aggregate
}

type Event struct {
	ID         string `json:"id"`
	TokenName  string `json:"token_name"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Timestamp  int64  `json:"timestamp"`
	LatencyMs  int64  `json:"latency_ms"`
	Failed     bool   `json:"failed"`
	Tokens     int64  `json:"tokens"`
	CostMicros *int64 `json:"cost_micros"`
}

type Day struct {
	Date     string `json:"date"`
	Tokens   int64  `json:"tokens"`
	Requests int64  `json:"requests"`
}

// Store uses a single SQLite connection to serialize writes and migrations.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("pool database path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, fmt.Errorf("create pool data directory: %w", err)
	}
	f, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("create pool database: %w", err)
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	if err = os.Chmod(absolute, 0600); err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: absolute}).String() + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open pool database: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	var version int
	if err = db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("read pool schema version: %w", err)
	}
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS owners (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, github_id INTEGER NOT NULL DEFAULT 0,
 login TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '',
 checked_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tokens (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), name TEXT NOT NULL,
 digest TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER NOT NULL DEFAULT 0,
 service_id TEXT NOT NULL DEFAULT '', daily_limit INTEGER NOT NULL DEFAULT 0 CHECK(daily_limit >= 0));
CREATE INDEX IF NOT EXISTS tokens_owner ON tokens(owner_id);
CREATE TABLE IF NOT EXISTS prices (
 id INTEGER PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
 input REAL NOT NULL, output REAL NOT NULL, cache_read REAL NOT NULL, cache_write REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES tokens(id), provider TEXT NOT NULL,
 model TEXT NOT NULL, timestamp INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
 failed INTEGER NOT NULL, tokens INTEGER NOT NULL, input INTEGER NOT NULL,
 output INTEGER NOT NULL, cached INTEGER NOT NULL, breakdown TEXT NOT NULL,
 price_id INTEGER REFERENCES prices(id), cost_micros INTEGER);
CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
CREATE INDEX IF NOT EXISTS events_token_time ON events(token_id,timestamp);
CREATE TABLE IF NOT EXISTS quota_accounts (
 account_id TEXT PRIMARY KEY, provider TEXT NOT NULL, status TEXT NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quota_snapshots (
 id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, provider TEXT NOT NULL, window TEXT NOT NULL,
 period_seconds INTEGER NOT NULL, remaining REAL NOT NULL, reset_at INTEGER NOT NULL, observed_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS quota_snapshot_time ON quota_snapshots(observed_at);`)
	if err == nil && version > 0 && version < 3 {
		_, err = db.Exec(`
ALTER TABLE owners ADD COLUMN github_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN login TEXT NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;`)
	}
	if err == nil {
		_, err = db.Exec(`PRAGMA user_version=3`)
	}
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize pool schema: %w", err)
	}
	return s, nil
}

// Owner returns the cached profile for an identity and when it was last looked up.
func (s *Store) Owner(ctx context.Context, id string) (Identity, int64, error) {
	var o Identity
	var checked int64
	err := s.db.QueryRowContext(ctx, `SELECT id,email,login,name,avatar,checked_at FROM owners WHERE id=?`, id).Scan(&o.ID, &o.Email, &o.Login, &o.Name, &o.Avatar, &checked)
	if errors.Is(err, sql.ErrNoRows) {
		return o, 0, ErrNotFound
	}
	return o, checked, err
}

// SaveOwner records a lookup attempt; an empty profile keeps any previous login.
func (s *Store) SaveOwner(ctx context.Context, owner Identity, p Profile) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO owners(id,email,github_id,login,name,avatar,checked_at) VALUES(?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET email=excluded.email,checked_at=excluded.checked_at,
 github_id=CASE WHEN excluded.login='' THEN github_id ELSE excluded.github_id END,
 login=CASE WHEN excluded.login='' THEN login ELSE excluded.login END,
 name=CASE WHEN excluded.login='' THEN name ELSE excluded.name END,
 avatar=CASE WHEN excluded.login='' THEN avatar ELSE excluded.avatar END`, owner.ID, owner.Email, p.ID, p.Login, p.Name, p.Avatar, s.now().Unix())
	return err
}

func (s *Store) Close() error { return s.db.Close() }
func digest(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (s *Store) CreateToken(ctx context.Context, owner Identity, name string, expiresAt int64) (Token, string, error) {
	name = strings.TrimSpace(name)
	if len(name) == 0 || len(name) > 80 || strings.ContainsAny(name, "\r\n\t") {
		return Token{}, "", errors.New("name must be 1–80 bytes without line breaks")
	}
	now := s.now().Unix()
	if expiresAt != 0 && expiresAt <= now {
		return Token{}, "", errors.New("expiry must be in the future")
	}
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return Token{}, "", err
	}
	secret := "pool_" + hex.EncodeToString(secretBytes)
	t := Token{ID: "pool:" + uuid.NewString(), Name: name, Prefix: secret[:13], OwnerID: owner.ID, CreatedAt: now, ExpiresAt: expiresAt}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Token{}, "", err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `INSERT INTO owners(id,email) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email`, owner.ID, owner.Email); err != nil {
		return Token{}, "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO tokens(id,owner_id,name,digest,prefix,created_at,expires_at) VALUES(?,?,?,?,?,?,?)`, t.ID, t.OwnerID, t.Name, digest(secret), t.Prefix, t.CreatedAt, t.ExpiresAt)
	if err != nil {
		return Token{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return Token{}, "", err
	}
	return t, secret, nil
}

const tokenColumns = `id,owner_id,name,prefix,created_at,expires_at,revoked_at,daily_limit,COALESCE((SELECT login FROM owners WHERE owners.id=tokens.owner_id),'')`

func scanToken(row interface{ Scan(...any) error }) (Token, error) {
	var t Token
	err := row.Scan(&t.ID, &t.OwnerID, &t.Name, &t.Prefix, &t.CreatedAt, &t.ExpiresAt, &t.RevokedAt, &t.DailyLimit, &t.Owner)
	return t, err
}

func (s *Store) Tokens(ctx context.Context, owner Identity) ([]Token, error) {
	return s.listTokens(ctx, ` WHERE owner_id=?`, owner.ID)
}

func (s *Store) AllTokens(ctx context.Context) ([]Token, error) {
	return s.listTokens(ctx, "")
}

func (s *Store) listTokens(ctx context.Context, where string, args ...any) ([]Token, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+tokenColumns+` FROM tokens`+where+` ORDER BY created_at DESC,id`, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Token{}
	for rows.Next() {
		t, errScan := scanToken(rows)
		if errScan != nil {
			return nil, errScan
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) Authenticate(ctx context.Context, secret string) (Token, error) {
	t, err := scanToken(s.db.QueryRowContext(ctx, `SELECT `+tokenColumns+` FROM tokens WHERE digest=? AND revoked_at=0 AND (expires_at=0 OR expires_at>?)`, digest(secret), s.now().Unix()))
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	if err != nil {
		return t, err
	}
	if t.DailyLimit > 0 {
		now := s.now().UTC()
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Unix()
		var used int64
		if err = s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(tokens),0) FROM events WHERE token_id=? AND timestamp>=?`, t.ID, start).Scan(&used); err != nil {
			return t, err
		}
		if used >= t.DailyLimit {
			return t, errors.New("daily token limit reached")
		}
	}
	return t, nil
}

func (s *Store) Revoke(ctx context.Context, owner Identity, id string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE tokens SET revoked_at=CASE WHEN revoked_at=0 THEN ? ELSE revoked_at END WHERE id=? AND (owner_id=? OR ?)`, s.now().Unix(), id, owner.ID, owner.Admin)
	return changed(result, err)
}

func (s *Store) Rename(ctx context.Context, owner Identity, id, name string) error {
	name = strings.TrimSpace(name)
	if len(name) == 0 || len(name) > 80 || strings.ContainsAny(name, "\r\n\t") {
		return errors.New("invalid token name")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE tokens SET name=? WHERE id=? AND owner_id=?`, name, id, owner.ID)
	return changed(result, err)
}

func changed(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) ConfigureToken(ctx context.Context, id string, limit int64) error {
	if limit < 0 {
		return errors.New("invalid token settings")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE tokens SET daily_limit=? WHERE id=?`, limit, id)
	return changed(result, err)
}

func (s *Store) AddPrice(ctx context.Context, p Price) error {
	if strings.TrimSpace(p.Provider) == "" || strings.TrimSpace(p.Model) == "" || len(p.Model) > 200 || len(p.Provider) > 80 {
		return errors.New("provider and model are required")
	}
	for _, v := range []float64{p.Input, p.Output, p.CacheRead, p.CacheWrite} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1e6 {
			return errors.New("rates must be between 0 and 1000000 USD per million tokens")
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO prices(provider,model,input,output,cache_read,cache_write) VALUES(?,?,?,?,?,?)`, p.Provider, p.Model, p.Input, p.Output, p.CacheRead, p.CacheWrite)
	return err
}

func (s *Store) Prices(ctx context.Context) ([]Price, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,provider,model,input,output,cache_read,cache_write FROM prices WHERE id IN (SELECT MAX(id) FROM prices GROUP BY provider,model) ORDER BY provider,model`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Price{}
	for rows.Next() {
		var p Price
		if err = rows.Scan(&p.ID, &p.Provider, &p.Model, &p.Input, &p.Output, &p.CacheRead, &p.CacheWrite); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RecordUsage stores canonical usage only; it never retains prompts or secrets.
func (s *Store) RecordUsage(ctx context.Context, r usage.Record) error {
	if r.AccessProvider != ProviderID || !strings.HasPrefix(r.APIKey, "pool:") {
		return nil
	}
	if r.RequestID == "" {
		return errors.New("usage execution ID is required")
	}
	d := usage.EnsureTokenBreakdownForProvider(r.Detail, r.Provider, r.ExecutorType).TokenBreakdown
	if !d.Valid() {
		return errors.New("invalid canonical token breakdown")
	}
	encoded, err := json.Marshal(d)
	if err != nil {
		return err
	}
	var priceID, cost any
	if d.Quality == usage.TokenAccountingQualityComplete {
		var p Price
		err = s.db.QueryRowContext(ctx, `SELECT id,input,output,cache_read,cache_write FROM prices WHERE provider=? AND model=? ORDER BY id DESC LIMIT 1`, r.Provider, r.Model).Scan(&p.ID, &p.Input, &p.Output, &p.CacheRead, &p.CacheWrite)
		if err == nil {
			value := float64(d.Input.UncachedTokens)*p.Input + float64(d.Input.CacheReadTokens)*p.CacheRead + float64(d.Input.CacheWriteTokens)*p.CacheWrite + float64(d.Output.TotalTokens)*p.Output
			if value < math.MaxInt64 {
				priceID = p.ID
				cost = int64(math.Round(value))
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	at := r.RequestedAt
	if at.IsZero() {
		at = s.now()
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO events(id,token_id,provider,model,timestamp,latency_ms,failed,tokens,input,output,cached,breakdown,price_id,cost_micros) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, r.RequestID, r.APIKey, r.Provider, r.Model, at.Unix(), r.Latency.Milliseconds(), r.Failed, d.TotalTokens, d.Input.TotalTokens, d.Output.TotalTokens, d.Input.CacheReadTokens, string(encoded), priceID, cost)
	return err
}

func (s *Store) HandleUsage(_ context.Context, r usage.Record) {
	// The inbound request may already be canceled when a streaming record arrives.
	if err := s.RecordUsage(context.Background(), r); err != nil {
		log.WithError(err).Error("pool: persist usage event")
	}
}

const aggregateSQL = `COUNT(*) AS requests,COALESCE(SUM(e.tokens),0) AS total_tokens,COALESCE(SUM(e.input),0),COALESCE(SUM(e.output),0),COALESCE(SUM(e.cached),0),COALESCE(SUM(e.failed),0),COUNT(e.cost_micros),COALESCE(SUM(e.cost_micros),0) AS total_cost`

func (s *Store) Summary(ctx context.Context, owner string, since int64) (Aggregate, error) {
	var a Aggregate
	err := s.db.QueryRowContext(ctx, `SELECT `+aggregateSQL+` FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=? AND e.timestamp>=?`, owner, since).Scan(&a.Requests, &a.Tokens, &a.Input, &a.Output, &a.Cached, &a.Failures, &a.Priced, &a.CostMicros)
	return a, err
}

func (s *Store) Leaders(ctx context.Context, since int64, metric string) ([]Leader, error) {
	order := "total_tokens"
	if metric == "cost" {
		order = "total_cost"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT o.id,o.login,CASE WHEN o.login='' THEN MIN(t.name) ELSE o.name END,o.avatar,COUNT(DISTINCT t.id),`+aggregateSQL+` FROM events e JOIN tokens t ON t.id=e.token_id JOIN owners o ON o.id=t.owner_id WHERE e.timestamp>=? GROUP BY o.id ORDER BY `+order+` DESC,o.id LIMIT 100`, since)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Leader{}
	for rows.Next() {
		var l Leader
		err = rows.Scan(&l.ID, &l.Login, &l.Name, &l.Avatar, &l.Keys, &l.Requests, &l.Tokens, &l.Input, &l.Output, &l.Cached, &l.Failures, &l.Priced, &l.CostMicros)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) Events(ctx context.Context, owner string, since int64) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id,t.name,e.provider,e.model,e.timestamp,e.latency_ms,e.failed,e.tokens,e.cost_micros FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=? AND e.timestamp>=? ORDER BY e.timestamp DESC,e.id LIMIT 100`, owner, since)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Event{}
	for rows.Next() {
		var e Event
		err = rows.Scan(&e.ID, &e.TokenName, &e.Provider, &e.Model, &e.Timestamp, &e.LatencyMs, &e.Failed, &e.Tokens, &e.CostMicros)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) Activity(ctx context.Context, owner string, since int64) ([]Day, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT strftime('%Y-%m-%d',e.timestamp,'unixepoch'),SUM(e.tokens),COUNT(*) FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=? AND e.timestamp>=? GROUP BY 1 ORDER BY 1`, owner, since)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Day{}
	for rows.Next() {
		var d Day
		if err = rows.Scan(&d.Date, &d.Tokens, &d.Requests); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
