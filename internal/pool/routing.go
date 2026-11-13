package pool

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/MoeForge/moego/ojson"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
)

// Routing tiers. The selector gives new sessions only to the highest tier that
// has an available account; sessions already bound keep their account in any tier.
const (
	tierLow     = 1 // a window is nearly used up; backup only
	tierUnknown = 2 // no fresh quota reading yet
	tierBest    = 10
)

// Router spends the quota that resets soonest first: weekly quota left at the
// reset is lost. Plan weights split new sessions inside a tier.
type Router struct {
	Quota   *Collector
	Manager *coreauth.Manager
}

func (r *Router) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		r.rank(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *Router) rank(ctx context.Context) {
	_, accounts, err := r.Quota.Snapshot(ctx, 1, 1)
	if err != nil {
		log.WithError(err).Warn("pool: rank accounts")
		return
	}
	byID := map[string]QuotaAccount{}
	for _, a := range accounts {
		byID[a.ID] = a
	}
	now := time.Now().Unix()
	for _, a := range r.Manager.List() {
		if a.Disabled || (a.Provider != "claude" && a.Provider != "codex") {
			continue
		}
		id := quotaID(a.ID)
		priority, weight := strconv.Itoa(tier(byID[id], now)), "1"
		if p := r.Quota.Plan(id); p != nil && p.Weight > 0 {
			weight = strconv.Itoa(p.Weight)
		}
		if a.Attributes["priority"] == priority && a.Attributes["weight"] == weight {
			continue
		}
		// Metadata keeps the values across file reloads; attributes are what the selector reads.
		_, _, errModify := r.Manager.Modify(ctx, a.ID, a.RegistrationEpoch, func(next *coreauth.Auth) error {
			if next.Attributes == nil {
				next.Attributes = map[string]string{}
			}
			if next.Metadata == nil {
				next.Metadata = map[string]any{}
			}
			next.Attributes["priority"], next.Metadata["priority"] = priority, priority
			next.Attributes["weight"], next.Metadata["weight"] = weight, weight
			return nil
		})
		if errModify != nil {
			log.WithError(errModify).WithField("account", id).Warn("pool: set routing tier")
			continue
		}
		log.Infof("pool: routing tier account=%s priority=%s weight=%s", id, priority, weight)
	}
}

// tier ranks an account by when its weekly quota resets: today is tierBest,
// seven days out is tierBest-7. Accounts close to any limit drop to tierLow.
func tier(a QuotaAccount, now int64) int {
	// One failed check (the usage endpoint 429s after restarts) keeps the last
	// reading; only readings older than 15 minutes count as unknown.
	weekly, reset := 101.0, int64(0)
	for _, s := range a.Samples {
		switch {
		case now-s.ObservedAt > 15*60:
			return tierUnknown
		case s.Period >= 6*86400:
			weekly = min(weekly, s.Remaining)
			if s.ResetAt > now && (reset == 0 || s.ResetAt < reset) {
				reset = s.ResetAt
			}
		case s.Remaining < 10:
			// The 5-hour window is nearly used; new sessions would hit its limit.
			return tierLow
		}
	}
	if weekly > 100 || reset == 0 {
		return tierUnknown
	}
	if weekly < 3 {
		return tierLow
	}
	days := min((reset-now)/86400, 7)
	return tierBest - int(days)
}

// SaveSessions writes live session bindings so the next process keeps every
// session on its account, and with it the provider's prompt cache.
func SaveSessions(path string, m *coreauth.Manager) error {
	doc := ojson.NewDoc([]byte(`{}`))
	if err := doc.Set("sessions", m.ExportSessionBindings()); err != nil {
		return err
	}
	return os.WriteFile(path, doc.Bytes(), 0o600)
}

// LoadSessions restores bindings saved by the previous process, then removes the file.
func LoadSessions(path string, m *coreauth.Manager) (int, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	defer func() { _ = os.Remove(path) }()
	var bindings []coreauth.SessionBinding
	ojson.GetBytes(data, "sessions").ForEach(func(_, v ojson.Result) bool {
		b := coreauth.SessionBinding{AuthID: v.Get("auth_id").String(), SessionID: v.Get("session_id").String(), Provider: v.Get("provider").String()}
		b.ExpiresAt, _ = time.Parse(time.RFC3339Nano, v.Get("expires_at").String())
		v.Get("aliases").ForEach(func(_, alias ojson.Result) bool {
			b.Aliases = append(b.Aliases, alias.String())
			return true
		})
		bindings = append(bindings, b)
		return true
	})
	return m.ImportSessionBindings(bindings), nil
}
