package pool

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// T3 Code reads subscription limits from a CLIProxyAPI hub with two management
// calls: auth-files lists accounts, and api-call fetches a provider usage URL with
// an account's token. Pool answers both for members, read-only, from the collector's
// last reading, so T3 never sees an account token and providers see no extra polls.
// T3 joins its management paths to the source URL, so the source URL is <base>/v1/t3.
const (
	t3ClaudeUsage  = "https://api.anthropic.com/api/oauth/usage"
	t3CodexUsage   = "https://chatgpt.com/backend-api/wham/usage"
	t3CodexCredits = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
)

func (p *Portal) registerT3(r *gin.Engine) {
	g := r.Group("/v1/t3/v0/management", func(c *gin.Context) {
		ctx := c.Request.Context()
		t, err := p.Store.TokenBySecret(ctx, bearer(c.Request))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid Pool token"})
			return
		}
		if err = p.Store.MarkT3(ctx, t.OwnerID); err != nil {
			log.WithError(err).Warn("pool: record T3 Code usage read")
		}
		c.Next()
	})
	g.GET("/auth-files", func(c *gin.Context) {
		files := []gin.H{}
		if p.Accounts != nil {
			for _, a := range p.Accounts() {
				if a.Disabled || (a.Provider != "claude" && a.Provider != "codex") {
					continue
				}
				id := quotaID(a.ID)
				files = append(files, gin.H{"id": id, "auth_index": id, "provider": a.Provider, "email": a.Email})
			}
		}
		c.JSON(http.StatusOK, gin.H{"files": files})
	})
	g.POST("/api-call", func(c *gin.Context) {
		var body struct {
			Index  string `json:"auth_index"`
			Method string `json:"method"`
			URL    string `json:"url"`
		}
		if !bind(c, &body) {
			return
		}
		// T3 reads a non-2xx status_code as "could not read this account".
		reply := func(status int, payload string) {
			c.JSON(http.StatusOK, gin.H{"status_code": status, "body": payload})
		}
		target, _, _ := strings.Cut(body.URL, "?")
		switch {
		case body.Method != http.MethodGet:
			reply(http.StatusForbidden, "")
		case target == t3CodexCredits:
			// Reset credits are spent on Pool's Accounts page, where admins pick which one.
			reply(http.StatusOK, `{"credits":[]}`)
		case target == t3ClaudeUsage || target == t3CodexUsage:
			if p.Quota == nil {
				reply(http.StatusServiceUnavailable, "")
				return
			}
			payload, ok := p.Quota.Usage(body.Index)
			if !ok {
				reply(http.StatusServiceUnavailable, "")
				return
			}
			reply(http.StatusOK, string(payload))
		default:
			reply(http.StatusForbidden, "")
		}
	})
}
