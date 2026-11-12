package pool

import (
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
}

// Portal owns routes independently of the privileged management API.
type Portal struct {
	Store    *Store
	Verifier Verifier
	Dev      bool
	Accounts func() []Account
	Quota    *Collector
	Logins   *AccountLogins
	GitHub   *GitHub
	Setups   *Setups
	now      func() time.Time
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
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid, expired, revoked, or limited Pool token"})
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
	g.GET("/me", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"identity": member(c), "development": p.Dev}) })
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
	admin.GET("/accounts", func(c *gin.Context) {
		v := []Account{}
		if p.Accounts != nil {
			v = p.Accounts()
		}
		c.JSON(http.StatusOK, v)
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
	admin.GET("/tokens", func(c *gin.Context) {
		v, err := p.Store.AllTokens(c.Request.Context())
		respond(c, v, err)
	})
	admin.PUT("/tokens/:id/settings", func(c *gin.Context) {
		var v struct {
			DailyLimit int64 `json:"daily_limit"`
		}
		if !bind(c, &v) {
			return
		}
		if v.DailyLimit < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settings"})
			return
		}
		err := p.Store.ConfigureToken(c.Request.Context(), c.Param("id"), v.DailyLimit)
		respond(c, gin.H{"saved": err == nil}, err)
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
