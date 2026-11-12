package pool

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/MoeForge/moego/ojson"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
)

// FreeReset is a provider-granted usage reset an account can spend: Anthropic's
// "cedar_ember" reset grants or OpenAI's Codex rate-limit reset credits.
// The contracts follow router-for-me/Cli-Proxy-API-Management-Center.
type FreeReset struct {
	Left int `json:"left"`
	// Usable reports whether spending one now would clear a limit.
	Usable  bool   `json:"usable"`
	Expires int64  `json:"expires,omitempty"`
	Note    string `json:"note,omitempty"`
	grant   string
}

const (
	claudeUsageURL       = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1"
	codexResetCreditsURL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
)

var resetGrantID = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)
var organizationUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// setProviderHeaders makes requests look like the provider's own CLI, as quota collection does.
func setProviderHeaders(req *http.Request, a *coreauth.Auth) {
	req.Header.Set("Accept", "application/json")
	if a.Provider == "claude" {
		req.Header.Set("anthropic-beta", "oauth-2025-04-20")
		req.Header.Set("User-Agent", "claude-cli/2.1.280 (external, cli)")
		return
	}
	req.Header.Set("User-Agent", "codex-tui/0.149.1")
	if id, ok := a.Metadata["account_id"].(string); ok && id != "" {
		req.Header.Set("ChatGPT-Account-Id", id)
	}
}

// claudeFreeReset reads the cedar_ember block that the usage endpoint returns with the windows.
func claudeFreeReset(payload []byte) *FreeReset {
	block := ojson.GetBytes(payload, "cedar_ember")
	if !block.Exists() {
		return nil
	}
	r := &FreeReset{}
	if !block.Get("eligible").Bool() {
		r.Note = "Not offered for this account"
		return r
	}
	atLimit := block.Get("at_limit").Bool()
	next := block.Get("next_grant_id").String()
	block.Get("grants").ForEach(func(_, g ojson.Result) bool {
		id := g.Get("id").String()
		left := int(g.Get("resets_left").Int())
		if !resetGrantID.MatchString(id) || left <= 0 {
			return true
		}
		r.Left += left
		usable := g.Get("usable_now").Bool() && !g.Get("paused").Bool() && (atLimit || g.Get("use_requires_limit").Exists() && !g.Get("use_requires_limit").Bool())
		if usable && (r.grant == "" || id == next) {
			r.grant, r.Usable = id, true
		}
		if ends, err := time.Parse(time.RFC3339, g.Get("ends_at").String()); err == nil && (r.Expires == 0 || ends.Unix() < r.Expires) {
			r.Expires = ends.Unix()
		}
		return true
	})
	if r.Left > 0 && !r.Usable {
		r.Note = "Usable once a limit is reached"
	}
	return r
}

// codexFreeReset reads the account's available Codex rate-limit reset credits.
func (q *Collector) codexFreeReset(ctx context.Context, a *coreauth.Auth) *FreeReset {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexResetCreditsURL, nil)
	if err != nil {
		return nil
	}
	setProviderHeaders(req, a)
	req.Header.Set("OpenAI-Beta", "codex-1")
	req.Header.Set("Originator", "Codex Desktop")
	body, status, err := q.do(ctx, a, req)
	if err != nil || status != http.StatusOK {
		return nil
	}
	r := &FreeReset{}
	ojson.GetBytes(body, "credits").ForEach(func(_, c ojson.Result) bool {
		if c.Get("reset_type").String() != "codex_rate_limits" || c.Get("status").String() != "available" {
			return true
		}
		r.Left++
		if expires, errParse := time.Parse(time.RFC3339, c.Get("expires_at").String()); errParse == nil && (r.Expires == 0 || expires.Unix() < r.Expires) {
			r.Expires = expires.Unix()
		}
		return true
	})
	// Prefer the server's counts; they can be null, which means "count the credits".
	for _, key := range []string{"applicable_available_count", "available_count"} {
		if n := ojson.GetBytes(body, key); n.Type == ojson.Number {
			r.Left = int(n.Int())
			break
		}
	}
	r.Usable = r.Left > 0
	return r
}

func (q *Collector) do(ctx context.Context, a *coreauth.Auth, req *http.Request) ([]byte, int, error) {
	response, err := q.manager.HttpRequest(ctx, a, req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return body, response.StatusCode, err
}

// FreeReset returns the last known free reset for a quota account ID.
func (q *Collector) FreeReset(id string) *FreeReset {
	if v, ok := q.resets.Load(id); ok {
		r := v.(FreeReset)
		return &r
	}
	return nil
}

// UseFreeReset spends one provider reset on an account, then clears Pool's cooldown
// for it and re-reads quota. It returns the provider's answer.
func (q *Collector) UseFreeReset(ctx context.Context, authID string) (string, error) {
	a, ok := q.manager.GetByID(authID)
	if !ok {
		return "", ErrNotFound
	}
	r := q.FreeReset(quotaID(authID))
	if r == nil || !r.Usable {
		return "", errors.New("no usable free reset for this account right now")
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := ojson.NewDoc([]byte(`{}`))
	var target string
	if a.Provider == "claude" {
		org, _ := a.Metadata["organization_uuid"].(string)
		if !organizationUUID.MatchString(org) || r.grant == "" {
			return "", errors.New("this Claude account has no organization or grant to reset")
		}
		target = "https://api.anthropic.com/api/organizations/" + org + "/reset_rate_limits"
		_ = payload.Set("program", "cedar_ember")
		_ = payload.Set("grant_id", r.grant)
		_ = payload.Set("request_id", hex.EncodeToString(nonce))
	} else {
		target = codexResetCreditsURL + "/consume"
		_ = payload.Set("redeem_request_id", hex.EncodeToString(nonce))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(payload.Bytes()))
	if err != nil {
		return "", err
	}
	setProviderHeaders(req, a)
	req.Header.Set("Content-Type", "application/json")
	body, status, err := q.do(ctx, a, req)
	if err != nil {
		// The provider may have spent the reset even though the answer was lost.
		return "", fmt.Errorf("no answer from the provider; check the account before trying again: %w", err)
	}
	result := ojson.GetBytes(body, "result").String()
	if a.Provider == "codex" {
		result = ojson.GetBytes(body, "code").String()
	}
	log.WithFields(log.Fields{"account": quotaID(authID), "status": status, "result": result}).Info("pool: free reset")
	if status < 200 || status >= 300 || (result != "reset" && result != "already_redeemed") {
		if result == "" {
			result = fmt.Sprintf("HTTP %d", status)
		}
		return result, fmt.Errorf("the provider did not reset this account: %s", result)
	}
	if _, _, err = q.manager.ResetQuota(ctx, authID); err != nil {
		log.WithError(err).Warn("pool: clear cooldown after free reset")
	}
	q.resets.Delete(quotaID(authID))
	q.Refresh()
	return result, nil
}
