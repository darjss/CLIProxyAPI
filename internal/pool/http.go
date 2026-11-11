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
	now      func() time.Time
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
		var identity Identity
		if p.Dev {
			remote, _, err := net.SplitHostPort(c.Request.RemoteAddr)
			if err != nil || !isLoopbackHost(remote) || !isLoopbackHost(c.Request.Host) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "development mode requires loopback"})
				return
			}
			identity = Identity{ID: "development", Email: "Local development", Admin: true}
		} else {
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
		path := c.Request.URL.Path
		portalPath := path == "/" || path == "/pool" || strings.HasPrefix(path, "/pool/")
		if portalPath {
			if identity.ID == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "a human Access login is required"})
				return
			}
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
			if path == "/" {
				c.Redirect(http.StatusTemporaryRedirect, "/pool/")
				c.Abort()
				return
			}
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
		if !p.Dev && !(identity.ID != "" && identity.ID == t.OwnerID || identity.ServiceID != "" && identity.ServiceID == t.ServiceID) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access identity does not match this Pool token"})
			return
		}
		c.Set("userApiKey", t.ID)
		c.Set("accessProvider", ProviderID)
		ctx := usage.WithCapturedIdentity(c.Request.Context(), t.ID, ProviderID, false)
		ctx = usage.WithAPIKey(ctx, t.ID)
		ctx = usage.WithAccessProvider(ctx, ProviderID)
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
	g.GET("/overview", func(c *gin.Context) {
		since, ok := p.since(c)
		if !ok {
			return
		}
		a, err := p.Store.Summary(c.Request.Context(), member(c).ID, since)
		if err != nil {
			respond(c, nil, err)
			return
		}
		counts := map[string]int{"claude": 0, "codex": 0}
		if p.Accounts != nil {
			for _, a := range p.Accounts() {
				if !a.Disabled {
					counts[a.Provider]++
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"usage": a, "accounts": counts, "quota_status": "not_connected", "since": since})
	})
	g.GET("/activity", func(c *gin.Context) {
		since, ok := p.since(c)
		if !ok {
			return
		}
		v, err := p.Store.Activity(c.Request.Context(), member(c).ID, since)
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
	admin.GET("/prices", func(c *gin.Context) { v, err := p.Store.Prices(c.Request.Context()); respond(c, v, err) })
	admin.POST("/prices", func(c *gin.Context) {
		var v Price
		if !bind(c, &v) {
			return
		}
		if err := p.Store.AddPrice(c.Request.Context(), v); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid price or price could not be saved"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"saved": true})
	})
	admin.PUT("/tokens/:id/settings", func(c *gin.Context) {
		var v struct {
			ServiceID  string `json:"service_id"`
			DailyLimit int64  `json:"daily_limit"`
		}
		if !bind(c, &v) {
			return
		}
		if v.DailyLimit < 0 || len(v.ServiceID) > 256 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settings"})
			return
		}
		err := p.Store.ConfigureToken(c.Request.Context(), c.Param("id"), v.ServiceID, v.DailyLimit)
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
	now := p.clock().UTC()
	var start time.Time
	switch c.DefaultQuery("period", "week") {
	case "today":
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "week":
		start = now.AddDate(0, 0, -7)
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "all":
		start = time.Unix(0, 0)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "period must be today, week, month, or all"})
		return 0, false
	}
	return start.Unix(), true
}
