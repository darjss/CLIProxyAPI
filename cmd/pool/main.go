// Pool embeds the proxy runtime with an Access-protected member portal.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/cloudflare/tableflip"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/api"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/kvstore"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pool"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	log "github.com/sirupsen/logrus"
)

func main() {
	logging.SetupBaseLogger()
	if err := run(); err != nil {
		log.WithError(err).Error("Pool stopped")
		os.Exit(1)
	}
}

func run() error {
	_ = godotenv.Load()
	configPath := flag.String("config", "pool.example.yaml", "Proxy configuration file")
	database := flag.String("database", ".pool/pool.db", "Persistent Pool database")
	webDir := flag.String("web-dir", "web/dist", "Built Pool dashboard directory")
	dev := flag.Bool("dev", false, "Loopback-only development; uses a fixed local admin identity")
	team := flag.String("access-team", os.Getenv("POOL_ACCESS_TEAM"), "Cloudflare Access team hostname")
	audience := flag.String("access-audience", os.Getenv("POOL_ACCESS_AUDIENCE"), "Cloudflare Access application audience")
	admins := flag.String("admins", os.Getenv("POOL_ADMINS"), "Comma-separated verified Access admin emails")
	devGitHubID := flag.Int64("dev-github-id", 0, "GitHub user ID shown for the development identity")
	pidFile := flag.String("pid-file", "", "Write the serving process ID here; systemd follows it across SIGHUP upgrades")
	flag.Parse()
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		return fmt.Errorf("load proxy config: %w", err)
	}
	if cfg.Home.Enabled {
		return errors.New("Pool currently supports standalone shared pools, not Home mode")
	}
	cfg.AuthDir, err = util.ResolveAuthDir(cfg.AuthDir)
	if err != nil {
		return fmt.Errorf("resolve account directory: %w", err)
	}
	// Tunnel ingress connects locally. Do not expose the origin to the public network.
	cfg.Host = "127.0.0.1"
	cfg.RequestLog = false
	cfg.RemoteManagement.DisableControlPanel = true
	cfg.RemoteManagement.SecretKey = ""
	cfg.APIKeys = nil
	cfg.Discovery.Enabled = false
	// Let open streams finish when an upgrade or stop retires this process.
	if cfg.ShutdownTimeoutSeconds == 0 {
		cfg.ShutdownTimeoutSeconds = 600
	}
	// pool.Router ranks accounts through priority and weight. A session stays on
	// its account until that account hits a quota or auth error, or a higher tier
	// has an available account.
	cfg.Routing.Strategy = "weighted-round-robin"
	cfg.Routing.SessionAffinity = true
	cfg.Routing.SessionAffinityRebindOn = "quota"
	cfg.Routing.SessionAffinityFollowPriority = true
	sessionsPath := filepath.Join(filepath.Dir(*database), "sessions.json")
	var authManager atomic.Pointer[coreauth.Manager]
	// SIGHUP starts the new binary on the same socket. Once it serves, this
	// process stops background work and drains its open requests.
	upgrader, err := tableflip.New(tableflip.Options{PIDFile: *pidFile})
	if err != nil {
		return fmt.Errorf("prepare graceful upgrades: %w", err)
	}
	defer upgrader.Stop()
	go func() {
		hup := make(chan os.Signal, 1)
		signal.Notify(hup, syscall.SIGHUP)
		for range hup {
			log.Info("pool: upgrading")
			// bbolt locks kv.db, so hand it over first. Until this process exits,
			// its session pins fall back to memory.
			if errKV := kvstore.ShutdownLocal(); errKV != nil {
				log.WithError(errKV).Warn("pool: release kv store")
			}
			// Session bindings live in memory; hand them to the new process.
			if m := authManager.Load(); m != nil {
				if errSave := pool.SaveSessions(sessionsPath, m); errSave != nil {
					log.WithError(errSave).Warn("pool: save session bindings")
				}
			}
			if errUpgrade := upgrader.Upgrade(); errUpgrade != nil {
				log.WithError(errUpgrade).Error("pool: upgrade failed; this process keeps serving")
				if !cfg.KVStore.Disabled {
					_ = kvstore.ConfigureLocal(true, cfg.EffectiveKVStorePath())
				}
			}
		}
	}()
	var ready sync.Once
	listen := func(network, addr string) (net.Listener, error) {
		ln, errListen := upgrader.Listen(network, addr)
		if errListen == nil {
			ready.Do(func() {
				if errReady := upgrader.Ready(); errReady != nil {
					log.WithError(errReady).Error("pool: signal upgrade readiness")
				}
			})
		}
		return ln, errListen
	}
	store, err := pool.Open(*database)
	if err != nil {
		return err
	}
	defer func() {
		if errClose := store.Close(); errClose != nil {
			log.WithError(errClose).Error("close Pool database")
		}
	}()
	portal := &pool.Portal{Store: store, Dev: *dev, Setups: &pool.Setups{Store: store}}
	if !*dev {
		verifier, errVerifier := pool.NewAccessVerifier(*team, *audience, strings.Split(*admins, ","))
		if errVerifier != nil {
			return errVerifier
		}
		portal.Verifier = verifier
		portal.GitHub = pool.NewGitHub(verifier.IdentityURL(), 0)
	} else {
		log.Warn("Pool development identity enabled; listening on loopback only")
		if *devGitHubID > 0 {
			portal.GitHub = pool.NewGitHub("", *devGitHubID)
		}
	}
	provider := &pool.TokenProvider{Store: store}
	sdkaccess.RegisterProvider(pool.ProviderID, provider)
	sdkaccess.SetExclusiveProvider(pool.ProviderID)
	defer sdkaccess.UnregisterProvider(pool.ProviderID)
	defer sdkaccess.ClearExclusiveProvider()
	usage.RegisterNamedPlugin(pool.ProviderID, store)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go func() {
		select {
		case <-upgrader.Exit():
			log.Info("pool: new process is serving; draining this one")
			cancel()
		case <-ctx.Done():
		}
	}()
	portal.Logins = pool.NewAccountLogins(ctx, cfg)
	prices := make(chan struct{})
	go func() {
		defer close(prices)
		store.RunPriceSync(ctx)
	}()
	var routing sync.WaitGroup
	defer func() {
		cancel()
		<-prices
		routing.Wait()
		if portal.Quota != nil {
			portal.Quota.Wait()
		}
	}()
	builder := cliproxy.NewBuilder().WithConfig(cfg).WithConfigPath(*configPath).WithServerOptions(
		api.WithListenFunc(listen),
		api.WithMiddleware(portal.Guard()),
		api.WithRouterConfigurator(func(r *gin.Engine, base *handlers.BaseAPIHandler, _ *config.Config) {
			portal.Quota = pool.NewCollector(store, base.AuthManager)
			portal.Quota.Start(ctx)
			authManager.Store(base.AuthManager)
			if n, errLoad := pool.LoadSessions(sessionsPath, base.AuthManager); errLoad != nil {
				log.WithError(errLoad).Warn("pool: load session bindings")
			} else if n > 0 {
				log.Infof("pool: kept %d session bindings from the previous process", n)
			}
			router := &pool.Router{Quota: portal.Quota, Manager: base.AuthManager}
			routing.Add(1)
			go func() {
				defer routing.Done()
				router.Run(ctx)
			}()
			portal.Accounts = func() []pool.Account {
				out := []pool.Account{}
				for _, a := range base.AuthManager.List() {
					email, _ := a.Metadata["email"].(string)
					if email == "" {
						email = a.Attributes["email"]
					}
					var cooldown int64
					if a.Unavailable && a.NextRetryAfter.After(time.Now()) {
						cooldown = a.NextRetryAfter.Unix()
					}
					priority, _ := strconv.Atoi(a.Attributes["priority"])
					out = append(out, pool.Account{ID: a.ID, Provider: a.Provider, Status: string(a.Status), Disabled: a.Disabled, Email: email, Message: a.StatusMessage, CooldownUntil: cooldown, Priority: priority})
				}
				return out
			}
			portal.ResetCooldown = func(ctx context.Context, id string) error {
				_, _, err := base.AuthManager.ResetQuota(ctx, id)
				return err
			}
			// Same state change as the management API's auth-file status toggle.
			portal.SetDisabled = func(ctx context.Context, id string, disabled bool) error {
				current, ok := base.AuthManager.GetByID(id)
				if !ok {
					return pool.ErrNotFound
				}
				_, committed, err := base.AuthManager.Modify(ctx, id, current.RegistrationEpoch, func(a *coreauth.Auth) error {
					a.Disabled = disabled
					a.Status, a.StatusMessage = coreauth.StatusActive, ""
					if disabled {
						a.Status, a.StatusMessage = coreauth.StatusDisabled, "disabled in Pool"
					}
					a.UpdatedAt = time.Now()
					return nil
				})
				if err == nil && !committed {
					err = pool.ErrNotFound
				}
				return err
			}
			// Same as the management API's auth-file delete: remove the file, then the runtime record.
			portal.DeleteAccount = func(ctx context.Context, id string) error {
				current, ok := base.AuthManager.GetByID(id)
				if !ok {
					return pool.ErrNotFound
				}
				path := current.Attributes["path"]
				if path == "" {
					path = current.FileName
				}
				if path != "" && !filepath.IsAbs(path) {
					path = filepath.Join(cfg.AuthDir, path)
				}
				if rel, errRel := filepath.Rel(cfg.AuthDir, path); path == "" || errRel != nil || strings.HasPrefix(rel, "..") {
					return fmt.Errorf("account %s has no auth file under %s", id, cfg.AuthDir)
				}
				if errRemove := os.Remove(path); errRemove != nil && !os.IsNotExist(errRemove) {
					return errRemove
				}
				base.AuthManager.Remove(ctx, id)
				return nil
			}
			portal.Register(r)
			r.GET("/pool/", func(c *gin.Context) {
				c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
				index := filepath.Join(*webDir, "index.html")
				if _, errStat := os.Stat(index); errStat != nil {
					c.String(http.StatusServiceUnavailable, "Pool dashboard is not built. Run npm --prefix web ci && npm --prefix web run build.")
					return
				}
				c.File(index)
			})
			r.StaticFS("/pool/assets", http.Dir(filepath.Join(*webDir, "assets")))
		}),
	)
	service, err := builder.Build()
	if err != nil {
		return fmt.Errorf("build Pool runtime: %w", err)
	}
	log.WithField("port", cfg.Port).Info("Pool listening on 127.0.0.1; dashboard at /pool/")
	errRun := service.Run(ctx)
	// The proxy stops delivery asynchronously. Drain before closing SQLite.
	if errDrain := usage.DefaultManager().StopAndWait(context.Background()); errDrain != nil {
		return errDrain
	}
	if errors.Is(errRun, context.Canceled) {
		return nil
	}
	return errRun
}
