package pool

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/MoeForge/moego/ojson"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
)

// Plan is the subscription behind an account, with its monthly list price in USD.
type Plan struct {
	Name  string `json:"name"`
	Price int    `json:"price,omitempty"`
	// Weight is the plan's share of new sessions relative to the base plan.
	// Claude uses Anthropic's usage multipliers; Codex uses the price ratio.
	Weight int `json:"weight,omitempty"`
	at     time.Time
}

const claudeProfileURL = "https://api.anthropic.com/api/oauth/profile"

// claudePlan follows the management center: only the organization's rate-limit
// tier separates Max 5x from Max 20x; the account flags only say "Max" or "Pro".
func claudePlan(payload []byte) Plan {
	org := ojson.GetBytes(payload, "organization")
	tier := strings.ToLower(org.Get("rate_limit_tier").String())
	account := ojson.GetBytes(payload, "account")
	switch {
	case org.Get("organization_type").String() == "claude_team" && org.Get("subscription_status").String() == "active":
		return Plan{Name: "Team"}
	case strings.HasSuffix(tier, "claude_max_20x"):
		return Plan{Name: "Max 20x", Price: 200, Weight: 20}
	case strings.HasSuffix(tier, "claude_max_5x"):
		return Plan{Name: "Max 5x", Price: 100, Weight: 5}
	case account.Get("has_claude_max").Bool():
		return Plan{Name: "Max", Weight: 5}
	case account.Get("has_claude_pro").Bool():
		return Plan{Name: "Pro", Price: 20}
	case account.Get("has_claude_max").Exists() && account.Get("has_claude_pro").Exists():
		return Plan{Name: "Free"}
	}
	return Plan{}
}

// codexPlan reads the plan_type Codex login stores in the auth file.
func codexPlan(a *coreauth.Auth) Plan {
	plan, _ := a.Metadata["plan_type"].(string)
	switch strings.ToLower(plan) {
	case "pro":
		return Plan{Name: "Pro", Price: 200, Weight: 10}
	case "prolite", "pro_lite", "pro-lite":
		return Plan{Name: "Pro Lite", Price: 100, Weight: 5}
	case "plus":
		return Plan{Name: "Plus", Price: 20}
	case "team":
		return Plan{Name: "Team"}
	case "free":
		return Plan{Name: "Free"}
	}
	return Plan{}
}

// updatePlan reads an account's plan. The Claude profile is fetched at most every 6 hours.
func (q *Collector) updatePlan(ctx context.Context, a *coreauth.Auth) {
	id := quotaID(a.ID)
	if a.Provider == "codex" {
		q.plans.Store(id, codexPlan(a))
		return
	}
	if v, ok := q.plans.Load(id); ok && time.Since(v.(Plan).at) < 6*time.Hour {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, claudeProfileURL, nil)
	if err != nil {
		return
	}
	setProviderHeaders(req, a)
	body, status, err := q.do(ctx, a, req)
	if err != nil || status != http.StatusOK {
		return
	}
	plan := claudePlan(body)
	plan.at = time.Now()
	q.plans.Store(id, plan)
	log.Infof("pool: claude plan account=%s plan=%q", id, plan.Name)
}

// Plan returns the last known plan for a quota account ID.
func (q *Collector) Plan(id string) *Plan {
	if v, ok := q.plans.Load(id); ok && v.(Plan).Name != "" {
		p := v.(Plan)
		return &p
	}
	return nil
}
