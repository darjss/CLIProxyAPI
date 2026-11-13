package pool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
)

const quotaStaleAfter = 10 * time.Minute

type QuotaSample struct {
	Account    string  `json:"account"`
	Provider   string  `json:"provider"`
	Window     string  `json:"window"`
	Period     int64   `json:"period_seconds"`
	Remaining  float64 `json:"remaining"`
	ResetAt    int64   `json:"reset_at"`
	ObservedAt int64   `json:"observed_at"`
}

type QuotaPoint struct {
	At        int64    `json:"at"`
	Remaining *float64 `json:"remaining"`
}

type QuotaAccount struct {
	ID        string        `json:"id"`
	Provider  string        `json:"provider"`
	Status    string        `json:"status"`
	CheckedAt int64         `json:"checked_at"`
	Samples   []QuotaSample `json:"windows"`
	// Filled by the portal from the auth manager and the last 24 hours of events.
	Email         string          `json:"email"`
	Disabled      bool            `json:"disabled"`
	AuthStatus    string          `json:"auth_status"`
	Message       string          `json:"message"`
	CooldownUntil int64           `json:"cooldown_until"`
	Priority      int             `json:"priority"`
	Day           AccountActivity `json:"day"`
	FreeReset     *FreeReset      `json:"free_reset,omitempty"`
	Plan          *Plan           `json:"plan,omitempty"`
}

type QuotaPool struct {
	ID          string       `json:"id"`
	Provider    string       `json:"provider"`
	Window      string       `json:"window"`
	Period      int64        `json:"period_seconds"`
	Accounts    int          `json:"accounts"`
	Remaining   float64      `json:"remaining"`
	Capacity    float64      `json:"capacity"`
	ObservedAt  int64        `json:"observed_at"`
	Stale       bool         `json:"stale"`
	BurnPerHour *float64     `json:"burn_per_hour"`
	NextReset   int64        `json:"next_reset"`
	History     []QuotaPoint `json:"history"`
	Projected   []QuotaPoint `json:"projected"`
}

// Collector reuses the runtime's credential preparation, refresh, and transport.
type Collector struct {
	store   *Store
	manager *coreauth.Manager
	wake    chan struct{}
	done    chan struct{}
	pending sync.Map
	resets  sync.Map // quota ID -> FreeReset, refreshed with each collection
	plans   sync.Map // quota ID -> Plan
	usage   sync.Map // quota ID -> last good usage response, served to T3 Code
	workers chan struct{}
	wg      sync.WaitGroup
}

func NewCollector(store *Store, manager *coreauth.Manager) *Collector {
	return &Collector{store: store, manager: manager, wake: make(chan struct{}, 1), done: make(chan struct{}), workers: make(chan struct{}, 4)}
}

func (q *Collector) Start(ctx context.Context) {
	go func() {
		defer close(q.done)
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		for {
			q.schedule(ctx)
			select {
			case <-ctx.Done():
				q.wg.Wait()
				return
			case <-ticker.C:
			case <-q.wake:
			}
		}
	}()
}

func (q *Collector) Wait() { <-q.done }
func (q *Collector) Refresh() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}
func quotaID(id string) string { return digest(id)[:16] }

// Usage returns the provider's last good usage response for a quota account ID.
func (q *Collector) Usage(id string) ([]byte, bool) {
	v, ok := q.usage.Load(id)
	if !ok {
		return nil, false
	}
	return v.([]byte), true
}

func (q *Collector) accounts() []*coreauth.Auth {
	result := []*coreauth.Auth{}
	for _, a := range q.manager.List() {
		if !a.Disabled && (a.Provider == "claude" || a.Provider == "codex") && a.AuthKind() != coreauth.AuthKindAPIKey {
			result = append(result, a)
		}
	}
	return result
}

func (q *Collector) schedule(ctx context.Context) {
	for _, a := range q.accounts() {
		if ctx.Err() != nil {
			return
		}
		if _, loaded := q.pending.LoadOrStore(a.ID, true); loaded {
			continue
		}
		select {
		case q.workers <- struct{}{}:
		default:
			q.pending.Delete(a.ID)
			continue
		}
		q.wg.Add(1)
		go func(a *coreauth.Auth) {
			defer q.wg.Done()
			defer q.pending.Delete(a.ID)
			defer func() { <-q.workers }()
			samples, status := q.fetch(ctx, a)
			if ctx.Err() != nil {
				return
			}
			if latest, ok := q.manager.GetByID(a.ID); !ok || latest.Disabled {
				return
			}
			if err := q.store.saveQuota(ctx, quotaID(a.ID), a.Provider, samples, status); err != nil {
				log.WithError(err).Error("pool: save quota snapshot")
			}
		}(a)
	}
}

func (q *Collector) fetch(ctx context.Context, a *coreauth.Auth) ([]QuotaSample, string) {
	// The Claude usage endpoint also reports free reset grants when asked.
	target := claudeUsageURL
	if a.Provider == "codex" {
		target = "https://chatgpt.com/backend-api/wham/usage"
	}
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, "request_error"
		}
		setProviderHeaders(req, a)
		response, err := q.manager.HttpRequest(ctx, a, req)
		if err != nil {
			return nil, "connection_error"
		}
		if response.StatusCode == http.StatusUnauthorized && attempt == 0 {
			_ = response.Body.Close()
			fresh, errRefresh := q.manager.ForceRefreshAuth(ctx, a.ID)
			if errRefresh != nil {
				return nil, "sign_in_required"
			}
			a = fresh
			continue
		}
		if response.StatusCode != http.StatusOK {
			_ = response.Body.Close()
			return nil, fmt.Sprintf("upstream_%d", response.StatusCode)
		}
		payload, errRead := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
		_ = response.Body.Close()
		if errRead != nil || len(payload) > 1<<20 {
			return nil, "invalid_response"
		}
		at := q.store.now().Unix()
		samples := parseQuota(a.Provider, quotaID(a.ID), payload, at)
		if len(samples) == 0 {
			return nil, "unsupported_response"
		}
		q.usage.Store(quotaID(a.ID), payload)
		reset := claudeFreeReset(payload)
		if a.Provider == "codex" {
			reset = q.codexFreeReset(ctx, a)
		}
		if reset != nil {
			q.resets.Store(quotaID(a.ID), *reset)
		} else {
			q.resets.Delete(quotaID(a.ID))
		}
		q.updatePlan(ctx, a)
		return samples, "ok"
	}
	return nil, "sign_in_required"
}

func parseQuota(provider, account string, payload []byte, at int64) []QuotaSample {
	result := []QuotaSample{}
	add := func(window string, period int64, used *float64, reset int64) {
		if used == nil || math.IsNaN(*used) || math.IsInf(*used, 0) || *used < 0 {
			return
		}
		result = append(result, QuotaSample{Account: account, Provider: provider, Window: window, Period: period, Remaining: math.Max(0, 100-*used), ResetAt: reset, ObservedAt: at})
	}
	if provider == "claude" {
		var body map[string]json.RawMessage
		if json.Unmarshal(payload, &body) != nil {
			return result
		}
		for key, period := range map[string]int64{"five_hour": 18000, "seven_day": 604800, "seven_day_opus": 604800, "seven_day_sonnet": 604800, "seven_day_oauth_apps": 604800} {
			var window struct {
				Used  *float64 `json:"utilization"`
				Reset string   `json:"resets_at"`
			}
			if json.Unmarshal(body[key], &window) != nil {
				continue
			}
			reset, _ := time.Parse(time.RFC3339Nano, window.Reset)
			var epoch int64
			if !reset.IsZero() {
				epoch = reset.Unix()
			}
			add(key, period, window.Used, epoch)
		}
	} else {
		var body struct {
			RateLimit struct {
				Primary   *codexQuotaWindow `json:"primary_window"`
				Secondary *codexQuotaWindow `json:"secondary_window"`
			} `json:"rate_limit"`
		}
		if json.Unmarshal(payload, &body) != nil {
			return result
		}
		for key, w := range map[string]*codexQuotaWindow{"primary": body.RateLimit.Primary, "secondary": body.RateLimit.Secondary} {
			if w == nil {
				continue
			}
			reset := w.ResetAt
			if reset == 0 && w.ResetAfter > 0 {
				reset = at + w.ResetAfter
			}
			add(key, w.Period, w.Used, reset)
		}
	}
	return result
}

type codexQuotaWindow struct {
	Used       *float64 `json:"used_percent"`
	Period     int64    `json:"limit_window_seconds"`
	ResetAt    int64    `json:"reset_at"`
	ResetAfter int64    `json:"reset_after_seconds"`
}

func (s *Store) saveQuota(ctx context.Context, account, provider string, samples []QuotaSample, status string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `INSERT INTO quota_accounts(account_id,provider,status,checked_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET provider=excluded.provider,status=excluded.status,checked_at=excluded.checked_at`, account, provider, status, s.now().Unix())
	if err != nil {
		return err
	}
	for _, v := range samples {
		_, err = tx.ExecContext(ctx, `INSERT INTO quota_snapshots(account_id,provider,window,period_seconds,remaining,reset_at,observed_at) VALUES(?,?,?,?,?,?,?)`, account, provider, v.Window, v.Period, v.Remaining, v.ResetAt, v.ObservedAt)
		if err != nil {
			return err
		}
	}
	// Quota history is bounded independently of the usage ledger.
	if _, err = tx.ExecContext(ctx, `DELETE FROM quota_snapshots WHERE observed_at<?`, s.now().AddDate(0, 0, -14).Unix()); err != nil {
		return err
	}
	return tx.Commit()
}

func (q *Collector) Snapshot(ctx context.Context, hours int, factor float64) ([]QuotaPool, []QuotaAccount, error) {
	active := map[string]*QuotaAccount{}
	for _, a := range q.accounts() {
		id := quotaID(a.ID)
		active[id] = &QuotaAccount{ID: id, Provider: a.Provider, Status: "waiting", Samples: []QuotaSample{}}
	}
	rows, err := q.store.db.QueryContext(ctx, `SELECT account_id,status,checked_at FROM quota_accounts`)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, status string
		var checked int64
		if err = rows.Scan(&id, &status, &checked); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		if a := active[id]; a != nil {
			a.Status = status
			a.CheckedAt = checked
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = q.store.db.QueryContext(ctx, `SELECT account_id,provider,window,period_seconds,remaining,reset_at,observed_at FROM quota_snapshots WHERE observed_at>=? ORDER BY observed_at DESC,id DESC LIMIT 100000`, q.store.now().AddDate(0, 0, -14).Unix())
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()
	groups := map[string]map[string][]QuotaSample{}
	for rows.Next() {
		var v QuotaSample
		if err = rows.Scan(&v.Account, &v.Provider, &v.Window, &v.Period, &v.Remaining, &v.ResetAt, &v.ObservedAt); err != nil {
			return nil, nil, err
		}
		if active[v.Account] == nil {
			continue
		}
		id := fmt.Sprintf("%s:%s:%d", v.Provider, v.Window, v.Period)
		if groups[id] == nil {
			groups[id] = map[string][]QuotaSample{}
		}
		groups[id][v.Account] = append(groups[id][v.Account], v)
	}
	if err = rows.Err(); err != nil {
		return nil, nil, err
	}
	pools := []QuotaPool{}
	now := q.store.now().Unix()
	for id, series := range groups {
		p := QuotaPool{ID: id, Accounts: len(series), Capacity: float64(len(series)) * 100, ObservedAt: now, History: []QuotaPoint{}, Projected: []QuotaPoint{}}
		rates := map[string]float64{}
		rateComplete := true
		for account, values := range series {
			latest := values[0]
			p.Provider = latest.Provider
			p.Window = latest.Window
			p.Period = latest.Period
			p.Remaining += latest.Remaining
			active[account].Samples = append(active[account].Samples, latest)
			if latest.ObservedAt < p.ObservedAt {
				p.ObservedAt = latest.ObservedAt
			}
			if now-latest.ObservedAt > int64(quotaStaleAfter/time.Second) || active[account].Status != "ok" || (latest.ResetAt > 0 && latest.ResetAt <= now) {
				p.Stale = true
			}
			if latest.ResetAt > now && (p.NextReset == 0 || latest.ResetAt < p.NextReset) {
				p.NextReset = latest.ResetAt
			}
			var consumed, seconds float64
			for i := 0; i+1 < len(values); i++ {
				newer, older := values[i], values[i+1]
				if older.ObservedAt < now-int64(hours)*3600 {
					break
				}
				dt := newer.ObservedAt - older.ObservedAt
				if dt > 0 && dt <= int64(quotaStaleAfter/time.Second) && newer.ResetAt == older.ResetAt && newer.Remaining <= older.Remaining {
					consumed += older.Remaining - newer.Remaining
					seconds += float64(dt)
				}
			}
			if seconds >= 60 {
				rates[account] = consumed / seconds * 3600
			} else {
				rateComplete = false
			}
		}
		// Only complete observations of the current pool membership are plotted.
		buckets := map[int64]map[string]QuotaSample{}
		for account, values := range series {
			for _, v := range values {
				bucket := v.ObservedAt / 300 * 300
				if buckets[bucket] == nil {
					buckets[bucket] = map[string]QuotaSample{}
				}
				if old, ok := buckets[bucket][account]; !ok || old.ObservedAt < v.ObservedAt {
					buckets[bucket][account] = v
				}
			}
		}
		for at, observations := range buckets {
			var remaining *float64
			if len(observations) == p.Accounts {
				total := 0.0
				for _, v := range observations {
					total += v.Remaining
				}
				remaining = &total
			}
			p.History = append(p.History, QuotaPoint{At: at, Remaining: remaining})
		}
		sort.Slice(p.History, func(i, j int) bool { return p.History[i].At < p.History[j].At })
		if rateComplete && !p.Stale {
			totalRate := 0.0
			for _, rate := range rates {
				totalRate += rate
			}
			p.BurnPerHour = &totalRate
			horizon := now + 72*3600
			for _, values := range series {
				latest := values[0]
				if latest.ResetAt > now && latest.Period > 0 && latest.ResetAt+latest.Period < horizon {
					horizon = latest.ResetAt + latest.Period - 1
				}
			}
			times := []int64{now}
			for at := now + 1800; at <= horizon; at += 1800 {
				times = append(times, at)
			}
			for _, values := range series {
				reset := values[0].ResetAt
				if reset > now && reset < horizon {
					times = append(times, reset-1, reset)
				}
			}
			sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
			for _, at := range times {
				total := 0.0
				for account, values := range series {
					latest := values[0]
					remaining := latest.Remaining - factor*rates[account]*float64(at-now)/3600
					if latest.ResetAt > now && at >= latest.ResetAt {
						remaining = 100 - factor*rates[account]*float64(at-latest.ResetAt)/3600
					}
					total += math.Max(0, remaining)
				}
				v := total
				p.Projected = append(p.Projected, QuotaPoint{At: at, Remaining: &v})
			}
		}
		pools = append(pools, p)
	}
	sort.Slice(pools, func(i, j int) bool { return pools[i].ID < pools[j].ID })
	accounts := []QuotaAccount{}
	for _, a := range active {
		sort.Slice(a.Samples, func(i, j int) bool { return strings.Compare(a.Samples[i].Window, a.Samples[j].Window) < 0 })
		accounts = append(accounts, *a)
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].ID < accounts[j].ID })
	return pools, accounts, nil
}
