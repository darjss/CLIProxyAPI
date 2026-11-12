package pool

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/misc"
	sdkauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	log "github.com/sirupsen/logrus"
)

type loginStatus struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	URL       string `json:"url,omitempty"`
	UserCode  string `json:"user_code,omitempty"`
	Error     string `json:"error,omitempty"`
	ExpiresAt int64  `json:"expires_at"`
}

type accountLogin struct {
	loginStatus
	owner    string
	state    string
	callback chan string
	ctx      context.Context
	cancel   context.CancelFunc
}

// AccountLogins keeps pending provider credentials on the server, scoped to the member who started them.
type AccountLogins struct {
	mu       sync.Mutex
	ctx      context.Context
	cfg      *config.Config
	manager  *sdkauth.Manager
	sessions map[string]*accountLogin
}

func NewAccountLogins(ctx context.Context, cfg *config.Config) *AccountLogins {
	return &AccountLogins{
		ctx: ctx, cfg: cfg.CloneForRuntime(), sessions: make(map[string]*accountLogin),
		manager: sdkauth.NewManager(sdkauth.GetTokenStore(), sdkauth.NewClaudeAuthenticator(), sdkauth.NewCodexAuthenticator()),
	}
}

func loginPending(status string) bool {
	return status == "starting" || status == "waiting" || status == "connecting"
}

func (l *AccountLogins) register(group *gin.RouterGroup) {
	group.POST("/logins", func(c *gin.Context) {
		var req struct {
			Provider string `json:"provider"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		if c.ShouldBindJSON(&req) != nil || (req.Provider != "claude" && req.Provider != "codex") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "choose Claude or Codex"})
			return
		}
		id, err := misc.GenerateRandomState()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start login"})
			return
		}
		l.mu.Lock()
		defer l.mu.Unlock()
		for key, session := range l.sessions {
			if !loginPending(session.Status) || time.Now().Unix() >= session.ExpiresAt {
				session.cancel()
				delete(l.sessions, key)
				continue
			}
			if session.owner == member(c).ID && loginPending(session.Status) {
				c.JSON(http.StatusConflict, gin.H{"error": "finish or cancel your current login first"})
				return
			}
		}
		if len(l.sessions) >= 32 {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many login attempts, try again later"})
			return
		}
		ttl := 5 * time.Minute
		if req.Provider == "codex" {
			ttl = 15 * time.Minute
		}
		ctx, cancel := context.WithTimeout(l.ctx, ttl)
		session := &accountLogin{
			loginStatus: loginStatus{ID: id, Provider: req.Provider, Status: "starting", ExpiresAt: time.Now().Add(ttl).Unix()},
			owner:       member(c).ID, callback: make(chan string, 1), ctx: ctx, cancel: cancel,
		}
		l.sessions[id] = session
		go l.run(session)
		c.JSON(http.StatusAccepted, session.loginStatus)
	})

	// Every operation checks ownership, including reads and cancellation.
	sessions := group.Group("/logins/:id", func(c *gin.Context) {
		l.mu.Lock()
		defer l.mu.Unlock()
		session := l.sessions[c.Param("id")]
		if session == nil || session.owner != member(c).ID {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "login not found, start a new connection"})
			return
		}
		if time.Now().Unix() >= session.ExpiresAt && loginPending(session.Status) {
			session.Status = "expired"
			session.URL, session.UserCode, session.state = "", "", ""
			session.cancel()
		}
		c.Set("pool.login", session)
	})
	sessions.GET("", func(c *gin.Context) {
		l.mu.Lock()
		defer l.mu.Unlock()
		c.JSON(http.StatusOK, c.MustGet("pool.login").(*accountLogin).loginStatus)
	})
	sessions.DELETE("", func(c *gin.Context) {
		l.mu.Lock()
		defer l.mu.Unlock()
		session := c.MustGet("pool.login").(*accountLogin)
		if loginPending(session.Status) {
			session.Status = "cancelled"
			session.URL, session.UserCode, session.state = "", "", ""
			session.cancel()
		}
		c.JSON(http.StatusOK, session.loginStatus)
	})
	sessions.POST("/callback", func(c *gin.Context) {
		var req struct {
			RedirectURL string `json:"redirect_url"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
		if c.ShouldBindJSON(&req) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "paste the full callback URL"})
			return
		}
		l.mu.Lock()
		defer l.mu.Unlock()
		session := c.MustGet("pool.login").(*accountLogin)
		if session.Provider != "claude" || session.Status != "waiting" || session.ctx.Err() != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "this login is no longer waiting for a callback"})
			return
		}
		u, err := url.Parse(strings.TrimSpace(req.RedirectURL))
		expected, _ := url.Parse(claude.RedirectURI)
		callback, errCallback := misc.ParseOAuthCallback(req.RedirectURL)
		if err != nil || u.Scheme != expected.Scheme || u.Host != expected.Host || u.Path != expected.Path || errCallback != nil || callback == nil || callback.State != session.state {
			c.JSON(http.StatusBadRequest, gin.H{"error": "paste the full localhost callback URL from this login"})
			return
		}
		session.Status = "connecting"
		session.callback <- req.RedirectURL
		c.JSON(http.StatusAccepted, session.loginStatus)
	})
}

func (l *AccountLogins) run(session *accountLogin) {
	defer session.cancel()
	opts := &sdkauth.LoginOptions{NoBrowser: true, Metadata: map[string]string{"codex_login_mode": "device"}}
	opts.DeviceCode = func(verificationURL, userCode string) {
		l.mu.Lock()
		defer l.mu.Unlock()
		if session.ctx.Err() == nil {
			session.URL, session.UserCode, session.Status = verificationURL, userCode, "waiting"
		}
	}
	opts.CallbackURL = func(ctx context.Context, authURL string) (string, error) {
		l.mu.Lock()
		if ctx.Err() == nil {
			u, _ := url.Parse(authURL)
			session.URL, session.state, session.Status = authURL, u.Query().Get("state"), "waiting"
		}
		l.mu.Unlock()
		select {
		case callback := <-session.callback:
			return callback, nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	_, _, err := l.manager.Login(session.ctx, session.Provider, l.cfg, opts)
	l.mu.Lock()
	defer l.mu.Unlock()
	session.URL, session.UserCode, session.state = "", "", ""
	if session.Status == "cancelled" {
		return
	}
	switch {
	case session.ctx.Err() != nil:
		session.Status = "expired"
	case err != nil:
		session.Status, session.Error = "failed", "Could not connect the account. Start a new login and try again."
		log.WithField("provider", session.Provider).Warn("Pool account login failed")
	default:
		session.Status = "connected"
	}
}
