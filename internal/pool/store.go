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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Prefix    string `json:"prefix"`
	CreatedAt int64  `json:"created_at"`
	ExpiresAt int64  `json:"expires_at"`
	RevokedAt int64  `json:"revoked_at"`
	Owner     string `json:"owner"`
	OwnerID   string `json:"-"`
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
	Clients []ClientUsage `json:"clients"`
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
	Client     string `json:"client"`
}

type ClientUsage struct {
	Client     string `json:"client"`
	Requests   int64  `json:"requests"`
	Tokens     int64  `json:"tokens"`
	CostMicros int64  `json:"cost_micros"`
}

type DayUsage struct {
	Date       string `json:"date"`
	Client     string `json:"client"`
	Tokens     int64  `json:"tokens"`
	CostMicros int64  `json:"cost_micros"`
}

// Usage splits input into uncached, cache-read, and cache-write tokens; they add up to input.
type Usage struct {
	Requests   int64 `json:"requests"`
	Tokens     int64 `json:"tokens"`
	Uncached   int64 `json:"uncached"`
	CacheRead  int64 `json:"cache_read"`
	CacheWrite int64 `json:"cache_write"`
	Output     int64 `json:"output"`
	Priced     int64 `json:"priced"`
	CostMicros int64 `json:"cost_micros"`
	Cost       struct {
		Uncached   int64 `json:"uncached"`
		CacheRead  int64 `json:"cache_read"`
		CacheWrite int64 `json:"cache_write"`
		Output     int64 `json:"output"`
	} `json:"cost"`
	// SavingsMicros is what cache reads would have cost at the uncached input rate.
	SavingsMicros int64         `json:"savings_micros"`
	Clients       []ClientUsage `json:"clients"`
	Models        []ModelUsage  `json:"models"`
	Days          []DayUsage    `json:"days"`
}

type ModelUsage struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Requests   int64  `json:"requests"`
	Tokens     int64  `json:"tokens"`
	Input      int64  `json:"input"`
	Cached     int64  `json:"cached"`
	CostMicros int64  `json:"cost_micros"`
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
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS owners (id TEXT PRIMARY KEY, email TEXT NOT NULL);
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
	// Columns added after the first release. Check each column rather than user_version,
	// because an older binary rewrites the version on rollback.
	for _, c := range [][3]string{
		{"owners", "github_id", "INTEGER NOT NULL DEFAULT 0"},
		{"owners", "login", "TEXT NOT NULL DEFAULT ''"},
		{"owners", "name", "TEXT NOT NULL DEFAULT ''"},
		{"owners", "avatar", "TEXT NOT NULL DEFAULT ''"},
		{"owners", "checked_at", "INTEGER NOT NULL DEFAULT 0"},
		{"events", "client", "TEXT NOT NULL DEFAULT ''"},
		{"events", "account", "TEXT NOT NULL DEFAULT ''"},
		{"owners", "tier", "TEXT NOT NULL DEFAULT 'standard'"},
		{"owners", "t3_at", "INTEGER NOT NULL DEFAULT 0"},
	} {
		var exists int
		if err == nil {
			err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`, c[0], c[1]).Scan(&exists)
		}
		if err == nil && exists == 0 {
			_, err = db.Exec(`ALTER TABLE ` + c[0] + ` ADD COLUMN ` + c[1] + ` ` + c[2])
			// New members start on Standard; people already using the pool keep no cap until an admin picks one.
			if err == nil && c[1] == "tier" {
				_, err = db.Exec(`UPDATE owners SET tier='unlimited'`)
			}
		}
	}
	if err == nil {
		_, err = db.Exec(`PRAGMA user_version=5`)
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

const tokenColumns = `id,owner_id,name,prefix,created_at,expires_at,revoked_at,COALESCE((SELECT login FROM owners WHERE owners.id=tokens.owner_id),'')`

func scanToken(row interface{ Scan(...any) error }) (Token, error) {
	var t Token
	err := row.Scan(&t.ID, &t.OwnerID, &t.Name, &t.Prefix, &t.CreatedAt, &t.ExpiresAt, &t.RevokedAt, &t.Owner)
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

// TokenBySecret returns a live token without checking its owner's limits.
func (s *Store) TokenBySecret(ctx context.Context, secret string) (Token, error) {
	t, err := scanToken(s.db.QueryRowContext(ctx, `SELECT `+tokenColumns+` FROM tokens WHERE digest=? AND revoked_at=0 AND (expires_at=0 OR expires_at>?)`, digest(secret), s.now().Unix()))
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

// MarkT3 records that the owner's T3 Code read Pool usage, at most once an hour.
func (s *Store) MarkT3(ctx context.Context, ownerID string) error {
	now := s.now().Unix()
	_, err := s.db.ExecContext(ctx, `UPDATE owners SET t3_at=? WHERE id=? AND t3_at<?`, now, ownerID, now-3600)
	return err
}

// UsesT3 reports whether the owner's T3 Code has ever read Pool usage.
func (s *Store) UsesT3(ctx context.Context, ownerID string) (bool, error) {
	var at int64
	err := s.db.QueryRowContext(ctx, `SELECT t3_at FROM owners WHERE id=?`, ownerID).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return at > 0, err
}

func (s *Store) Authenticate(ctx context.Context, secret string) (Token, error) {
	t, err := s.TokenBySecret(ctx, secret)
	if err != nil {
		return t, err
	}
	l, err := s.Limit(ctx, t.OwnerID)
	if err != nil {
		return t, err
	}
	if l.Day > 0 && l.DayUsed >= l.Day {
		return t, limitError("Today's Pool limit is used up. It resets at 00:00 UTC.")
	}
	if l.Week > 0 && l.WeekUsed >= l.Week {
		return t, limitError("This week's Pool limit is used up. It frees up as last week's usage rolls off.")
	}
	return t, nil
}

var ErrLimited = errors.New("limit reached")

// limitError is shown to clients as is, so it reads as a sentence.
type limitError string

func (e limitError) Error() string        { return string(e) }
func (e limitError) Is(target error) bool { return target == ErrLimited }

// Tiers cap a person's API-equivalent cost in micro-USD per UTC day and rolling 7 days. Zero is no cap.
var Tiers = map[string]struct{ Day, Week int64 }{
	"light":     {20_000_000, 100_000_000},
	"standard":  {50_000_000, 200_000_000},
	"unlimited": {},
}

type Limit struct {
	Tier     string `json:"tier"`
	Day      int64  `json:"-"`
	Week     int64  `json:"-"`
	DayUsed  int64  `json:"-"`
	WeekUsed int64  `json:"-"`
}

// Limit reports a person's tier and priced usage today (UTC) and over the last 7 days.
func (s *Store) Limit(ctx context.Context, owner string) (Limit, error) {
	now := s.now().UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Unix()
	var l Limit
	err := s.db.QueryRowContext(ctx, `SELECT o.tier,
 COALESCE((SELECT SUM(e.cost_micros) FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=o.id AND e.timestamp>=?),0),
 COALESCE((SELECT SUM(e.cost_micros) FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=o.id AND e.timestamp>=?),0)
 FROM owners o WHERE o.id=?`, day, now.AddDate(0, 0, -7).Unix(), owner).Scan(&l.Tier, &l.DayUsed, &l.WeekUsed)
	if err != nil {
		return l, err
	}
	caps := Tiers[l.Tier]
	l.Day, l.Week = caps.Day, caps.Week
	return l, nil
}

func (s *Store) SetTier(ctx context.Context, owner, tier string) error {
	if _, ok := Tiers[tier]; !ok {
		return errors.New("unknown tier")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE owners SET tier=? WHERE id=?`, tier, owner)
	return changed(result, err)
}

type Member struct {
	ID     string `json:"id"`
	Login  string `json:"login"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Tier   string `json:"tier"`
	Tokens int64  `json:"tokens"`
}

// Members lists everyone who has signed in or owns a token, for admins to set tiers.
func (s *Store) Members(ctx context.Context) ([]Member, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT o.id,o.login,CASE WHEN o.login='' THEN COALESCE((SELECT MIN(name) FROM tokens WHERE owner_id=o.id),'') ELSE o.name END,o.avatar,o.tier,
 (SELECT COUNT(*) FROM tokens WHERE owner_id=o.id AND revoked_at=0) FROM owners o ORDER BY o.login='',o.login,o.id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err = rows.Scan(&m.ID, &m.Login, &m.Name, &m.Avatar, &m.Tier, &m.Tokens); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type AccountActivity struct {
	Requests   int64 `json:"requests"`
	CostMicros int64 `json:"cost_micros"`
	LastUsed   int64 `json:"last_used"`
}

// AccountActivity totals requests per upstream account since a time.
func (s *Store) AccountActivity(ctx context.Context, since int64) (map[string]AccountActivity, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT account,COUNT(*),COALESCE(SUM(cost_micros),0),MAX(timestamp) FROM events WHERE account!='' AND timestamp>=? GROUP BY account`, since)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]AccountActivity{}
	for rows.Next() {
		var id string
		var a AccountActivity
		if err = rows.Scan(&id, &a.Requests, &a.CostMicros, &a.LastUsed); err != nil {
			return nil, err
		}
		out[id] = a
	}
	return out, rows.Err()
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
	client, _ := ctx.Value(clientKey{}).(string)
	_, err = s.db.ExecContext(ctx, `INSERT INTO events(id,token_id,provider,model,timestamp,latency_ms,failed,tokens,input,output,cached,breakdown,price_id,cost_micros,client,account) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, r.RequestID, r.APIKey, r.Provider, r.Model, at.Unix(), r.Latency.Milliseconds(), r.Failed, d.TotalTokens, d.Input.TotalTokens, d.Output.TotalTokens, d.Input.CacheReadTokens, string(encoded), priceID, cost, client, r.AuthID)
	return err
}

type clientKey struct{}

// WithClient tags a request with the coding tool named by its User-Agent.
func WithClient(ctx context.Context, userAgent string) context.Context {
	client := "other"
	switch ua := strings.ToLower(userAgent); {
	case strings.HasPrefix(ua, "claude-cli/"):
		client = "claude-code"
	case strings.HasPrefix(ua, "codex"):
		client = "codex"
	}
	return context.WithValue(ctx, clientKey{}, client)
}

func (s *Store) HandleUsage(ctx context.Context, r usage.Record) {
	// The inbound request may already be canceled when a streaming record arrives.
	if err := s.RecordUsage(context.WithoutCancel(ctx), r); err != nil {
		log.WithError(err).Error("pool: persist usage event")
	}
}

const aggregateSQL = `COUNT(*) AS requests,COALESCE(SUM(e.tokens),0) AS total_tokens,COALESCE(SUM(e.input),0),COALESCE(SUM(e.output),0),COALESCE(SUM(e.cached),0),COALESCE(SUM(e.failed),0),COUNT(e.cost_micros),COALESCE(SUM(e.cost_micros),0) AS total_cost`

const clientSQL = `COALESCE(NULLIF(e.client,''),'other')`

func breakdownSQL(path string) string {
	return `COALESCE(json_extract(e.breakdown,'$.` + path + `'),0)`
}

// Usage totals one person's events by token type, coding tool, and UTC day.
// Cost by type multiplies each event's tokens by the rate saved with it.
func (s *Store) Usage(ctx context.Context, owner string, since int64) (Usage, error) {
	u := Usage{Clients: []ClientUsage{}, Models: []ModelUsage{}, Days: []DayUsage{}}
	from := ` FROM events e JOIN tokens t ON t.id=e.token_id LEFT JOIN prices p ON p.id=e.price_id WHERE t.owner_id=? AND e.timestamp>=?`
	uncached, read, write := breakdownSQL("input.uncached_tokens"), breakdownSQL("input.cache_read_tokens"), breakdownSQL("input.cache_write_tokens")
	cost := func(expr string) string { return `CAST(ROUND(COALESCE(SUM(` + expr + `),0)) AS INTEGER)` }
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(e.tokens),0),COALESCE(SUM(`+uncached+`),0),COALESCE(SUM(`+read+`),0),COALESCE(SUM(`+write+`),0),COALESCE(SUM(e.output),0),COUNT(e.cost_micros),COALESCE(SUM(e.cost_micros),0),`+
		cost(uncached+`*p.input`)+`,`+cost(read+`*p.cache_read`)+`,`+cost(write+`*p.cache_write`)+`,`+cost(`e.output*p.output`)+`,`+cost(read+`*(p.input-p.cache_read)`)+from, owner, since).
		Scan(&u.Requests, &u.Tokens, &u.Uncached, &u.CacheRead, &u.CacheWrite, &u.Output, &u.Priced, &u.CostMicros, &u.Cost.Uncached, &u.Cost.CacheRead, &u.Cost.CacheWrite, &u.Cost.Output, &u.SavingsMicros)
	if err != nil {
		return u, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+clientSQL+`,COUNT(*),COALESCE(SUM(e.tokens),0),COALESCE(SUM(e.cost_micros),0)`+from+` GROUP BY 1 ORDER BY 3 DESC`, owner, since)
	if err != nil {
		return u, err
	}
	for rows.Next() {
		var c ClientUsage
		if err = rows.Scan(&c.Client, &c.Requests, &c.Tokens, &c.CostMicros); err != nil {
			_ = rows.Close()
			return u, err
		}
		u.Clients = append(u.Clients, c)
	}
	_ = rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT e.provider,e.model,COUNT(*),COALESCE(SUM(e.tokens),0),COALESCE(SUM(e.input),0),COALESCE(SUM(e.cached),0),COALESCE(SUM(e.cost_micros),0)`+from+` GROUP BY 1,2 ORDER BY 7 DESC,4 DESC`, owner, since)
	if err != nil {
		return u, err
	}
	for rows.Next() {
		var m ModelUsage
		if err = rows.Scan(&m.Provider, &m.Model, &m.Requests, &m.Tokens, &m.Input, &m.Cached, &m.CostMicros); err != nil {
			_ = rows.Close()
			return u, err
		}
		u.Models = append(u.Models, m)
	}
	_ = rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT strftime('%Y-%m-%d',e.timestamp,'unixepoch'),`+clientSQL+`,COALESCE(SUM(e.tokens),0),COALESCE(SUM(e.cost_micros),0)`+from+` GROUP BY 1,2 ORDER BY 1`, owner, since)
	if err != nil {
		return u, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var d DayUsage
		if err = rows.Scan(&d.Date, &d.Client, &d.Tokens, &d.CostMicros); err != nil {
			return u, err
		}
		u.Days = append(u.Days, d)
	}
	return u, rows.Err()
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
		l.Clients = []ClientUsage{}
		out = append(out, l)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	_ = rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT t.owner_id,`+clientSQL+`,COUNT(*),COALESCE(SUM(e.tokens),0),COALESCE(SUM(e.cost_micros),0) FROM events e JOIN tokens t ON t.id=e.token_id WHERE e.timestamp>=? GROUP BY 1,2 ORDER BY 4 DESC`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var owner string
		var c ClientUsage
		if err = rows.Scan(&owner, &c.Client, &c.Requests, &c.Tokens, &c.CostMicros); err != nil {
			return nil, err
		}
		for i := range out {
			if out[i].ID == owner {
				out[i].Clients = append(out[i].Clients, c)
			}
		}
	}
	return out, rows.Err()
}

func (s *Store) Events(ctx context.Context, owner string, since int64) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id,t.name,e.provider,e.model,e.timestamp,e.latency_ms,e.failed,e.tokens,e.cost_micros,`+clientSQL+` FROM events e JOIN tokens t ON t.id=e.token_id WHERE t.owner_id=? AND e.timestamp>=? ORDER BY e.timestamp DESC,e.id LIMIT 100`, owner, since)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Event{}
	for rows.Next() {
		var e Event
		err = rows.Scan(&e.ID, &e.TokenName, &e.Provider, &e.Model, &e.Timestamp, &e.LatencyMs, &e.Failed, &e.Tokens, &e.CostMicros, &e.Client)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// FirstEvent returns a token's first successful request, else its first failed
// one, or nil before it makes any.
func (s *Store) FirstEvent(ctx context.Context, tokenID string) (*Event, error) {
	var e Event
	err := s.db.QueryRowContext(ctx, `SELECT e.id,t.name,e.provider,e.model,e.timestamp,e.latency_ms,e.failed,e.tokens,e.cost_micros FROM events e JOIN tokens t ON t.id=e.token_id WHERE e.token_id=? ORDER BY e.failed,e.timestamp,e.id LIMIT 1`, tokenID).Scan(&e.ID, &e.TokenName, &e.Provider, &e.Model, &e.Timestamp, &e.LatencyMs, &e.Failed, &e.Tokens, &e.CostMicros)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}
