package pool

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

type Account struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
	Disabled bool   `json:"disabled"`
	Email    string `json:"email"`
	Message  string `json:"message"`
	// CooldownUntil is when Pool retries an account it blocked after an upstream error.
	CooldownUntil int64 `json:"cooldown_until"`
}

// Portal owns routes independently of the privileged management API.
type Portal struct {
	Store    *Store
	Verifier Verifier
	Dev      bool
	Accounts func() []Account
	// SetDisabled takes an account out of routing, or back in, keeping its credentials.
	SetDisabled func(ctx context.Context, id string, disabled bool) error
	// ResetCooldown clears Pool's local retry block on an account; provider quota is unchanged.
	ResetCooldown func(ctx context.Context, id string) error
	Quota         *Collector
	Logins        *AccountLogins
	GitHub        *GitHub
	Setups        *Setups
	now           func() time.Time
}

// withProfile attaches the cached GitHub profile, looking it up at most hourly until found.
func (p *Portal) withProfile(c *gin.Context, identity Identity, assertion string) Identity {
	ctx := c.Request.Context()
	owner, checked, err := p.Store.Owner(ctx, identity.ID)
	if err == nil && (owner.Login != "" || p.GitHub == nil || p.clock().Unix()-checked < 3600) {
		identity.Login, identity.Name, identity.Avatar = owner.Login, owner.Name, owner.Avatar
		return identity
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		log.WithError(err).Error("pool: read owner profile")
		return identity
	}
	var profile Profile
	if p.GitHub != nil {
		if profile, err = p.GitHub.Profile(ctx, assertion); err != nil {
			log.WithError(err).Warn("pool: GitHub profile lookup failed")
		}
	}
	if err = p.Store.SaveOwner(ctx, identity, profile); err != nil {
		log.WithError(err).Error("pool: save owner profile")
	}
	identity.Login, identity.Name, identity.Avatar = profile.Login, profile.Name, profile.Avatar
	if profile.Login == "" {
		identity.Login, identity.Name, identity.Avatar = owner.Login, owner.Name, owner.Avatar
	}
	return identity
}

func (p *Portal) clock() time.Time {
	if p.now != nil {
		return p.now()
	}
	return time.Now()
}

func isLoopbackHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}

// Guard is global: a reload or plugin cannot bypass Pool using a config key.
func (p *Portal) Guard() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		if p.Dev {
			remote, _, err := net.SplitHostPort(c.Request.RemoteAddr)
			if err != nil || !isLoopbackHost(remote) || !isLoopbackHost(c.Request.Host) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "development mode requires loopback"})
				return
			}
		}
		path := c.Request.URL.Path
		if path == "/" {
			c.Redirect(http.StatusTemporaryRedirect, "/pool/")
			c.Abort()
			return
		}
		if path == "/pool" || strings.HasPrefix(path, "/pool/") {
			identity := Identity{ID: "development", Email: "Local development", Admin: true}
			if !p.Dev {
				if p.Verifier == nil {
					c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Access verification is not configured"})
					return
				}
				var err error
				identity, err = p.Verifier.Verify(c.Request.Context(), c.GetHeader("Cf-Access-Jwt-Assertion"))
				if err != nil {
					c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "valid Cloudflare Access authentication is required"})
					return
				}
			}
			if identity.ID == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "a human Access login is required"})
				return
			}
			identity = p.withProfile(c, identity, c.GetHeader("Cf-Access-Jwt-Assertion"))
			if origin := c.GetHeader("Origin"); origin != "" {
				u, err := url.Parse(origin)
				scheme := "https"
				if p.Dev {
					scheme = "http"
				}
				if err != nil || u.Host != c.Request.Host || u.Scheme != scheme {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "cross-origin portal requests are not allowed"})
					return
				}
			}
			if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.GetHeader("X-Pool-Request") != "1" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "missing portal request header"})
				return
			}
			c.Set("pool.identity", identity)
			c.Next()
			return
		}
		// Install scripts are public; the single-use code in the path is the credential.
		if strings.HasPrefix(path, "/setup/") {
			c.Next()
			return
		}
		// Management routes are not made available through the member-facing host.
		if !(strings.HasPrefix(path, "/v1/") || strings.HasPrefix(path, "/v1beta/") || strings.HasPrefix(path, "/openai/") || strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/backend-api/")) {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		t, err := p.Store.Authenticate(c.Request.Context(), bearer(c.Request))
		if errors.Is(err, ErrLimited) {
			// Anthropic-style error body; OpenAI clients also read error.message.
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"type": "error", "error": gin.H{"type": "rate_limit_error", "message": err.Error()}})
			return
		}
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid, expired, or revoked Pool token"})
			return
		}
		c.Set("userApiKey", t.ID)
		c.Set("accessProvider", ProviderID)
		ctx := usage.WithCapturedIdentity(c.Request.Context(), t.ID, ProviderID, false)
		ctx = usage.WithAPIKey(ctx, t.ID)
		ctx = usage.WithAccessProvider(ctx, ProviderID)
		ctx = WithClient(ctx, c.GetHeader("User-Agent"))
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

func (p *Portal) Register(r *gin.Engine) {
	r.GET("/pool", func(c *gin.Context) { c.Redirect(http.StatusTemporaryRedirect, "/pool/") })
	g := r.Group("/pool/api")
	g.GET("/me", func(c *gin.Context) {
		out := gin.H{"identity": member(c), "development": p.Dev}
		// Members see how much of their tier is used as a fraction, not in dollars.
		if l, err := p.Store.Limit(c.Request.Context(), member(c).ID); err == nil {
			limit := gin.H{"tier": l.Tier}
			if l.Day > 0 {
				limit["day"] = float64(l.DayUsed) / float64(l.Day)
			}
			if l.Week > 0 {
				limit["week"] = float64(l.WeekUsed) / float64(l.Week)
			}
			out["limit"] = limit
		}
		c.JSON(http.StatusOK, out)
	})
	g.GET("/quota", func(c *gin.Context) {
		hours := 3
		switch c.DefaultQuery("hours", "3") {
		case "1":
			hours = 1
		case "3":
		case "6":
			hours = 6
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "hours must be 1, 3, or 6"})
			return
		}
		if p.Quota == nil {
			c.JSON(http.StatusOK, gin.H{"pools": []QuotaPool{}, "accounts": []QuotaAccount{}})
			return
		}
		factor := 1.0
		switch c.DefaultQuery("scenario", "same") {
		case "same":
		case "half":
			factor = 0.5
		case "double":
			factor = 2
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "scenario must be same, half, or double"})
			return
		}
		pools, accounts, err := p.Quota.Snapshot(c.Request.Context(), hours, factor)
		if err != nil {
			respond(c, nil, err)
			return
		}
		activity, err := p.Store.AccountActivity(c.Request.Context(), p.clock().Add(-24*time.Hour).Unix())
		if err != nil {
			respond(c, nil, err)
			return
		}
		// Quota rows carry hashed IDs; match them back to auth records.
		info := map[string]Account{}
		if p.Accounts != nil {
			for _, a := range p.Accounts() {
				info[quotaID(a.ID)] = a
			}
		}
		for i := range accounts {
			a := info[accounts[i].ID]
			accounts[i].Email, accounts[i].Disabled, accounts[i].Day = a.Email, a.Disabled, activity[a.ID]
			accounts[i].AuthStatus, accounts[i].Message, accounts[i].CooldownUntil = a.Status, a.Message, a.CooldownUntil
			if member(c).Admin {
				accounts[i].FreeReset = p.Quota.FreeReset(accounts[i].ID)
			}
			delete(info, accounts[i].ID)
		}
		// The collector skips disabled accounts; list them so they can be enabled again.
		for id, a := range info {
			if a.Disabled && (a.Provider == "claude" || a.Provider == "codex") {
				accounts = append(accounts, QuotaAccount{ID: id, Provider: a.Provider, Status: "disabled", Samples: []QuotaSample{},
					Email: a.Email, Disabled: true, AuthStatus: a.Status, Message: a.Message, Day: activity[a.ID]})
			}
		}
		c.JSON(http.StatusOK, gin.H{"pools": pools, "accounts": accounts, "observed_at": p.clock().Unix()})
	})
	g.GET("/tokens", func(c *gin.Context) { v, err := p.Store.Tokens(c.Request.Context(), member(c)); respond(c, v, err) })
	g.POST("/tokens", func(c *gin.Context) {
		var body struct {
			Name      string `json:"name"`
			ExpiresAt int64  `json:"expires_at"`
		}
		if !bind(c, &body) {
			return
		}
		t, secret, err := p.Store.CreateToken(c.Request.Context(), member(c), body.Name, body.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid name or expiry, or token could not be saved"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"token": t, "secret": secret})
	})
	g.DELETE("/tokens/:id", func(c *gin.Context) {
		err := p.Store.Revoke(c.Request.Context(), member(c), c.Param("id"))
		respond(c, gin.H{"revoked": err == nil}, err)
	})
	g.PATCH("/tokens/:id", func(c *gin.Context) {
		var body struct {
			Name string `json:"name"`
		}
		if !bind(c, &body) {
			return
		}
		if len(strings.TrimSpace(body.Name)) == 0 || len(body.Name) > 80 || strings.ContainsAny(body.Name, "\r\n\t") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid token name"})
			return
		}
		err := p.Store.Rename(c.Request.Context(), member(c), c.Param("id"), body.Name)
		respond(c, gin.H{"saved": err == nil}, err)
	})
	// Aggregates are shared with the team, like the leaderboard; individual requests stay private.
	g.GET("/usage", func(c *gin.Context) {
		since, ok := p.since(c)
		if !ok {
			return
		}
		owner := c.DefaultQuery("owner", member(c).ID)
		v, err := p.Store.Usage(c.Request.Context(), owner, since)
		respond(c, v, err)
	})
	g.GET("/requests", func(c *gin.Context) {
		since, ok := p.since(c)
		if !ok {
			return
		}
		v, err := p.Store.Events(c.Request.Context(), member(c).ID, since)
		respond(c, v, err)
	})
	g.GET("/leaderboard", func(c *gin.Context) {
		since, ok := p.since(c)
		if !ok {
			return
		}
		metric := c.DefaultQuery("metric", "tokens")
		if metric != "tokens" && metric != "cost" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "metric must be tokens or cost"})
			return
		}
		v, err := p.Store.Leaders(c.Request.Context(), since, metric)
		respond(c, v, err)
	})
	admin := g.Group("/admin", func(c *gin.Context) {
		if !member(c).Admin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return
		}
		c.Next()
	})
	// disable, enable, or reset (clear Pool's cooldown after an upstream 429).
	admin.POST("/accounts/:id/:action", func(c *gin.Context) {
		if p.SetDisabled == nil || p.ResetCooldown == nil || p.Accounts == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "accounts are not loaded"})
			return
		}
		// The dashboard only sees hashed quota IDs, never auth file names.
		id := ""
		for _, a := range p.Accounts() {
			if quotaID(a.ID) == c.Param("id") {
				id = a.ID
			}
		}
		if id == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		var err error
		switch c.Param("action") {
		case "disable", "enable":
			err = p.SetDisabled(c.Request.Context(), id, c.Param("action") == "disable")
		case "reset":
			err = p.ResetCooldown(c.Request.Context(), id)
		case "free-reset":
			// Spends one of the account's provider-granted resets; admin only, like the other actions.
			if p.Quota == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "quota is not loaded"})
				return
			}
			var body struct {
				Option string `json:"option"`
			}
			if !bind(c, &body) {
				return
			}
			result, errReset := p.Quota.UseFreeReset(c.Request.Context(), id, body.Option)
			if errReset != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": errReset.Error(), "result": result})
				return
			}
			c.JSON(http.StatusOK, gin.H{"saved": true, "result": result})
			return
		default:
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		respond(c, gin.H{"saved": err == nil}, err)
	})
	admin.GET("/members", func(c *gin.Context) {
		v, err := p.Store.Members(c.Request.Context())
		respond(c, v, err)
	})
	admin.PUT("/members/:id/tier", func(c *gin.Context) {
		var body struct {
			Tier string `json:"tier"`
		}
		if !bind(c, &body) {
			return
		}
		if _, ok := Tiers[body.Tier]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tier must be light, standard, or unlimited"})
			return
		}
		err := p.Store.SetTier(c.Request.Context(), c.Param("id"), body.Tier)
		respond(c, gin.H{"saved": err == nil}, err)
	})
	if p.Logins != nil {
		// Anyone signed in can share an account with the pool; admins only set limits.
		p.Logins.register(g)
	}
	if p.Setups != nil {
		p.Setups.register(r, g)
	}
	admin.POST("/quota/refresh", func(c *gin.Context) {
		if p.Quota != nil {
			p.Quota.Refresh()
		}
		c.JSON(http.StatusAccepted, gin.H{"scheduled": true})
	})
}

func member(c *gin.Context) Identity { v, _ := c.Get("pool.identity"); i, _ := v.(Identity); return i }
func bind(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if err := c.ShouldBindJSON(v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return false
	}
	return true
}
func respond(c *gin.Context, v any, err error) {
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err != nil {
		log.WithError(err).Error("pool: portal storage request failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage operation failed"})
		return
	}
	c.JSON(http.StatusOK, v)
}
func (p *Portal) since(c *gin.Context) (int64, bool) {
	days, ok := map[string]int{"24h": 1, "7d": 7, "30d": 30, "90d": 90}[c.DefaultQuery("period", "7d")]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "period must be 24h, 7d, 30d, or 90d"})
		return 0, false
	}
	return p.clock().AddDate(0, 0, -days).Unix(), true
}
