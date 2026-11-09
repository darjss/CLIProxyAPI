# Pool

Pool runs the existing CLIProxyAPI runtime with named member tokens, persistent
usage, and an Access-protected dashboard. It listens on loopback for Cloudflare
Tunnel ingress. The original `cmd/server` entrypoint remains available for provider
OAuth login and existing deployments.

## Local development

```sh
npm --prefix web ci
npm --prefix web run build
go run ./cmd/pool --dev --config pool.example.yaml
```

Open `http://127.0.0.1:8317/pool/`. Explicit `--dev` mode uses a fixed local admin
identity and rejects non-loopback connections and non-local Host headers.
The database defaults to `.pool/pool.db`. Override it with `--database`.

For frontend hot reload, keep the Go process running and start:

```sh
npm --prefix web run dev
```

Use the Vite URL printed in the terminal with `/pool/`. The development proxy
forwards `/pool/api` to port 8317. The production build is served by the Go process
from `web/dist`; use `--web-dir` to change that path.

## Production Access authentication

Do not use `--dev` in the tunnel deployment. Supply the Access team hostname,
application audience, and admin email allowlist:

```sh
export POOL_ACCESS_TEAM=your-team.cloudflareaccess.com
export POOL_ACCESS_AUDIENCE=your-application-audience
export POOL_ADMINS=admin@example.com
go run ./cmd/pool --config pool.example.yaml
```

These values can also be provided using `--access-team`, `--access-audience`, and
`--admins`. Dashboard routes under `/pool` require a valid signed Access assertion
for that issuer and audience. Access controls invitations and the GitHub identity
provider; Pool does not implement a second signup/login flow. Inference routes
require only a valid Pool API token and do not require a browser session or
Cloudflare service credentials.

Browser users create a token by naming it. The secret is returned once and only
a SHA-256 digest is stored. Token names are visible in shared rankings; owner
emails and request history are private. Members can rename or revoke their own keys.
Admins can configure daily per-token caps using the administration page.

Clients use `https://pool.erxes.tech/v1` as the OpenAI-compatible base URL and send:

```text
Authorization: Bearer <pool-token>
```

Claude-compatible clients can send `X-Api-Key: <pool-token>` instead. The token
identifies the owner and named client for usage tracking. Expiry, revocation, and
daily limits apply without Cloudflare machine credentials. Treat the token as a
password; anyone holding it can use its allocation.

The runtime uses the existing config and OAuth account directory. For example:

```sh
go run ./cmd/server --config pool.example.yaml --claude-login
go run ./cmd/server --config pool.example.yaml --codex-device-login
```

The member-facing host does not expose the legacy management console or APIs.
Use the existing CLI to manage upstream logins for now.

## Usage and estimates

The runtime usage hook stores canonical token breakdowns, model, provider,
timestamp, latency, and success/failure. It stores no prompts, response bodies,
raw proxy keys, or upstream credentials. Delivery is asynchronous; abrupt process
termination can lose events still in memory. Graceful shutdown waits for the
usage dispatcher before closing SQLite. This is observability, not a billing ledger.

Execution IDs deduplicate repeated deliveries. Retries remain distinct upstream
executions. Cache and reasoning subtotals are not added to their parent totals.
Daily caps use UTC and completed usage; in-flight requests can overshoot.

Admins supply exact model rates in USD per million tokens. Estimates use uncached
input, cache reads, cache writes, and output. The applied price version is saved
with the event; editing prices does not rewrite history. Unclassified usage or
missing rates remain unpriced. Costs are token-only API-equivalent estimates,
not actual subscription charges or tool/media fees.

The React dashboard uses Panda CSS tokens, shared component recipes, and
generated static utilities. `npm ci` runs Panda code generation; the generated
`web/styled-system` directory is ignored. Pages include personal activity,
private request metadata, named-token rankings, account status, and price/limit
controls.

## Provider quota

The server collects Claude and Codex OAuth quota every two minutes, even when
the dashboard is closed. It uses the existing runtime's authenticated HTTP
request and credential refresh methods, including per-account proxy settings.
Only fixed provider quota endpoints are requested. Credential headers and raw
quota responses are not persisted or returned to members.

Snapshots are retained for 14 days. The quota view shows native windows,
per-account collection status, pooled observations, next reported resets,
1h/3h/6h burn windows, and half/same/double usage projections. Each account
contributes 100 account-relative quota points; subscriptions are not assumed to
have equal token capacity. Only complete observations of the current group are
plotted. Missing or stale quota is never converted into an empty balance.

Forecasts require at least two observations, pause on stale/error data, exclude
reset intervals from burn calculations, and include only the next reported
reset. The horizon ends before a second unreported reset (or at 72 hours).
They are estimates, not promised capacity. New accounts start without history.

Dashboard OAuth management, per-owner aggregate limits, and usage retention
automation remain subsequent increments.

## Persistent deployment

Example user services are under `deploy/pool/`. They expect the Pool binary at
`~/.local/share/pool/bin/pool`, built web assets at `~/.local/share/pool/web`,
and a production proxy config at `~/.config/pool/config.yaml`. Keep the database
and provider auth files in the persistent data directory, outside the checkout.
Use a different production port when local development is running concurrently.

`~/.config/pool/runtime.env` supplies the Access team, audience, and admin emails.
The tunnel token belongs in `~/.config/pool/tunnel.token`, readable only by the
service user. Use a dedicated named tunnel. Do not put token contents in service
command lines.

Scope the Access application to `pool.erxes.tech/pool`, including its subpaths,
and admit the intended GitHub organization and explicit invites through the
existing GitHub provider. In the tunnel, put a hostname rule matching
`^/pool(/.*)?$` first and require its Access assertion. Follow it with a hostname
rule forwarding the remaining paths to the same loopback origin without an
Access requirement, then the catch-all 404 rule. Do not enable Access checks
globally on the tunnel: that would block token-only inference.

The origin separately verifies Access for dashboard routes, accepts Pool tokens
on inference routes, and rejects management routes. `/` redirects to `/pool/`.
The development identity is never used by the production service.

```sh
systemctl --user daemon-reload
systemctl --user enable --now pool.service pool-tunnel.service
loginctl enable-linger "$USER"
```

Enabling lingering lets user services start after boot without an interactive
login. Existing tunnels and other Access applications do not need changes.

## Checks

```sh
npm --prefix web run build
gofmt -w .
go build -o test-output ./cmd/server && rm test-output
go build -o pool ./cmd/pool
```

No new tests are included, as requested. The database, installed dependencies,
and generated frontend build are ignored by Git. Back up the SQLite database
using a SQLite-aware backup procedure while the process is running, or stop
Pool before copying its database and any WAL files.
