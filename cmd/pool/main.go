// Pool embeds the proxy runtime with an Access-protected member portal.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/api"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pool"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
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
	flag.Parse()
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		return fmt.Errorf("load proxy config: %w", err)
	}
	if cfg.Home.Enabled {
		return errors.New("Pool currently supports standalone shared pools, not Home mode")
	}
	// Tunnel ingress connects locally. Do not expose the origin to the public network.
	cfg.Host = "127.0.0.1"
	cfg.RequestLog = false
	cfg.RemoteManagement.DisableControlPanel = true
	cfg.RemoteManagement.SecretKey = ""
	cfg.APIKeys = nil
	cfg.Discovery.Enabled = false
	store, err := pool.Open(*database)
	if err != nil {
		return err
	}
	defer func() {
		if errClose := store.Close(); errClose != nil {
			log.WithError(errClose).Error("close Pool database")
		}
	}()
	portal := &pool.Portal{Store: store, Dev: *dev}
	if !*dev {
		portal.Verifier, err = pool.NewAccessVerifier(*team, *audience, strings.Split(*admins, ","))
		if err != nil {
			return err
		}
	} else {
		log.Warn("Pool development identity enabled; listening on loopback only")
	}
	provider := &pool.TokenProvider{Store: store}
	sdkaccess.RegisterProvider(pool.ProviderID, provider)
	sdkaccess.SetExclusiveProvider(pool.ProviderID)
	defer sdkaccess.UnregisterProvider(pool.ProviderID)
	defer sdkaccess.ClearExclusiveProvider()
	usage.RegisterNamedPlugin(pool.ProviderID, store)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	defer func() {
		cancel()
		if portal.Quota != nil {
			portal.Quota.Wait()
		}
	}()
	builder := cliproxy.NewBuilder().WithConfig(cfg).WithConfigPath(*configPath).WithServerOptions(
		api.WithMiddleware(portal.Guard()),
		api.WithRouterConfigurator(func(r *gin.Engine, base *handlers.BaseAPIHandler, _ *config.Config) {
			portal.Quota = pool.NewCollector(store, base.AuthManager)
			portal.Quota.Start(ctx)
			portal.Accounts = func() []pool.Account {
				out := []pool.Account{}
				for _, a := range base.AuthManager.List() {
					out = append(out, pool.Account{ID: a.ID, Provider: a.Provider, Status: string(a.Status), Disabled: a.Disabled})
				}
				return out
			}
			portal.Register(r)
			r.GET("/pool/", func(c *gin.Context) {
				c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
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
