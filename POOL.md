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

Quick Start sets up Claude Code or Codex with one command. The
page creates a single-use code that expires after 10 minutes and shows
`curl -fsSL https://pool.erxes.tech/setup/<code> | sh`. Fetching that script
consumes the code, creates a token for the member, and embeds it. The script
saves the token to `~/.config/pool/token`, backs up each config file it changes,
and merges in the Pool settings. It needs Python 3. The page then shows the
token's first request as it arrives. Codes live in memory and are lost on restart.

Members can also create a token by naming it. The secret is returned once and only
a SHA-256 digest is stored. Rankings show each member's GitHub handle and avatar.
Access reports the GitHub user ID, and the public GitHub users API resolves it,
so no GitHub App is needed. Emails and request history stay private. Members
can rename or revoke their own keys.

Admins put each person on a tier in **Administration**. A tier caps the
person's API-equivalent cost across all their tokens, per UTC day and per
rolling 7 days:

| Tier | Per day | Per 7 days |
| --- | --- | --- |
| Light | $20 | $100 |
| Standard | $50 | $200 |
| Unlimited | none | none |

The amounts live in `Tiers` in `internal/pool/store.go`. The dashboard shows
tier names only, and members see the share used on their Usage page. People
signing in for the first time start on Standard. People who existed when tiers
shipped start on Unlimited, so nobody was cut off mid-session. Once a cap is
reached, inference returns HTTP 429 with an Anthropic-style
`rate_limit_error` that says when it frees up.

Clients use `https://pool.erxes.tech/v1` as the OpenAI-compatible base URL and send:

```text
Authorization: Bearer <pool-token>
```

Claude-compatible clients can send `X-Api-Key: <pool-token>` instead. The token
identifies the owner and named client for usage tracking. Expiry, revocation, and
tier limits apply without Cloudflare machine credentials. Treat the token as a
password; anyone holding it can use its allocation.

Anyone signed in can share an account from **Quick Start → Share an account**.
Choose Claude or Codex and click Connect. Claude opens a provider sign-in page;
after authorizing, paste the full localhost redirect URL into Pool and click
Finish connection. Codex displays a device code to enter on OpenAI's sign-in page,
then detects approval automatically. Passwords and MFA codes stay on the provider's
page. Login attempts expire after five minutes for Claude or 15 minutes for Codex,
can be cancelled, and resume after refreshing the same browser tab.

Credentials stay on the server in the configured OAuth account directory. Pool
loads saved accounts automatically, and quota updates within two minutes.
The existing CLI also supports account login:

```sh
go run ./cmd/server --config pool.example.yaml --claude-login
go run ./cmd/server --config pool.example.yaml --codex-device-login
```

The member-facing host does not expose the legacy management console or APIs.
Account login endpoints under `/pool/api/logins` require a verified Access
identity. Only the member who starts a login can read it, submit its callback, or
cancel it. Pending sessions remain in memory and are lost on a server restart.

## Usage and estimates

The runtime usage hook stores canonical token breakdowns, model, provider,
timestamp, latency, and success/failure. It stores no prompts, response bodies,
raw proxy keys, or upstream credentials. Delivery is asynchronous; abrupt process
termination can lose events still in memory. Graceful shutdown waits for the
usage dispatcher before closing SQLite. This is observability, not a billing ledger.

Execution IDs deduplicate repeated deliveries. Retries remain distinct upstream
executions. Cache and reasoning subtotals are not added to their parent totals.
Tier caps use completed, priced usage, so in-flight requests can overshoot.

Pool loads public API rates from `https://models.dev/api.json` at startup and
then daily. Claude models use the `anthropic` rates and Codex models use the
`openai` rates, in USD per million tokens. Estimates use uncached input, cache
reads, cache writes, and output. The applied price version is saved with the
event, and a changed rate adds a new version without rewriting history. Complete
events that had no rate get priced when one first appears. Unclassified usage
stays unpriced. Costs are token-only API-equivalent estimates, not actual
subscription charges or tool/media fees.

Each request is tagged with its coding tool from the User-Agent: `claude-cli/`
is Claude Code, `codex…` is Codex, and anything else is Other. Usage and the
leaderboard split cost and tokens by tool. Anyone signed in can open a person's
daily history from the leaderboard. Individual requests stay private to their
owner.

The React dashboard uses Panda CSS tokens, shared component recipes, and
generated static utilities. `npm ci` runs Panda code generation; the generated
`web/styled-system` directory is ignored.

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

The **Accounts** page shows each account's email, a state such as "7-day limit
used · back in 3d" or "Sign-in expired", its requests and cost in the last 24
hours, and the quota windows. A chip shows the plan and its monthly price, such
as "Max 20x · $200". For Claude, Pool reads `api.anthropic.com/api/oauth/profile`
at most every 6 hours, and only the organization's `rate_limit_tier` tells Max 5x
from Max 20x. Codex plans come from `plan_type` in the auth file: `pro` is $200,
`prolite` is $100, `plus` is $20. Each event records the upstream account that
served it. Admins use the account's ⋯ menu for these actions:

- **Disable / Enable.** Disabling takes the account out of routing and keeps its
  credentials. The state persists in the auth file, and a disabled account stays
  listed so it can be enabled again.
- **Delete.** Removes the auth file and drops the account from routing, like
  upstream's Auth Files delete. Connecting the account again adds it back.
- **Retry now.** After an upstream 429 or error, CLIProxyAPI pauses the account
  until a retry time, shown as "Paused · retrying in 12m". Retry now calls the
  auth manager's `ResetQuota`, the same reset as upstream's
  `POST /v8/management/routing/cooldown/reset`, so routing tries the account
  again right away. It does not restore provider quota. An account whose
  7-day window is used up stays limited until the provider resets it.
- **Use free reset.** Anthropic gives some Claude plans free "reset grants",
  and OpenAI gives Codex "rate-limit reset credits". Each one sets the account's
  usage back to zero. Pool reads them with each quota check, from the Claude
  usage endpoint with `cedar_ember=1` and from
  `chatgpt.com/backend-api/wham/rate-limit-reset-credits`. Admins see
  "N free resets" in Accounts, and only admins can spend one. The ⋯ menu opens
  a list of the account's grants or credits, each with what it clears and when
  it expires, and the admin picks one. Spending it posts that `grant_id` to
  `api.anthropic.com/api/organizations/<org>/reset_rate_limits` or that
  `credit_id` to `…/rate-limit-reset-credits/consume`, then clears Pool's
  cooldown for that account. The dashboard warns before using one on an account that still has
  quota, since that wastes it. The contracts follow
  router-for-me/Cli-Proxy-API-Management-Center.

The sidebar collapses with Ctrl+B, or Cmd+B on macOS. Someone with no tokens
lands on Quick Start.

Usage retention automation remains a subsequent increment.

## Routing

Weekly quota left at a reset is lost, so Pool spends the account that resets
soonest first. Every minute `pool.Router` sets each account's `priority` from
its latest quota reading:

| Priority | When |
|---|---|
| 10 down to 3 | Weekly reset today (10) through seven days out (3) |
| 2 | No reading in the last 15 minutes |
| 1 | A 5-hour window under 10%, or a weekly window under 3% |

New sessions go only to the highest priority that has an available account.
Inside that tier, `weighted-round-robin` splits them by plan: Claude Max 20x is
20, Max 5x is 5, Pro is 1, ChatGPT Pro is 10, Pro Lite is 5, Plus is 1. Accounts
lists rows in this order and marks the current tier "Next up". Pool writes
`priority` and `weight` into the auth files only when they change.

A session stays on the account it started on, whatever its tier, so the
provider's prompt cache keeps working. Pool forces `session-affinity: true` with
`session-affinity-rebind-on: quota`: only a quota or auth error moves a session.
A transient 5xx retries elsewhere for that request and keeps the binding.
Bindings live in memory, so on reload the old process writes them to
`sessions.json` next to the database and the new process loads and deletes it.
Idle bindings expire after `session-affinity-ttl` (1 hour).

## T3 Code usage

T3 Code shows limits from CLIProxyAPI hubs on its Usage page. It calls
`v0/management/auth-files` and `v0/management/api-call` under the source URL,
so Pool answers both at `https://pool.erxes.tech/v1/t3` with any member token:

- `auth-files` lists enabled Claude and Codex accounts by quota ID and email.
- `api-call` only accepts the Claude and Codex usage URLs and returns the
  collector's last good provider response. It never uses an account token, so
  T3 sees no secrets and providers see no extra polls. Codex reset credits come
  back empty; admins spend them on Accounts.

Every setup script also adds `usageLimitSources.pool` to
`$T3CODE_HOME/userdata/settings.json` (default `~/.t3`) with the new token. T3
Code picks the file change up live and moves the key into its secret store.
T3 Code keeps a source URL's path from 0.1.3, so the script reads the version
from `server-runtime.json`, `/Applications/T3 Code*.app`, or
`runtime/versions`, and skips the change on anything older, nightlies of 0.1.3
included. The Claude and Codex scripts print a note and go on; the T3-only
script stops.

The first T3 read sets `owners.t3_at`, and `/pool/api/me` returns `t3`. Until
then, Accounts asks people who already ran a Claude Code or Codex setup whether
they use T3 Code and offers the T3-only command (`harness: "t3"`). "No, I don't
use it" stays dismissed in that browser.

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
on inference routes, serves single-use install scripts under `/setup/`, and
rejects management routes. `/` redirects to `/pool/`.
The development identity is never used by the production service.

```sh
systemctl --user daemon-reload
systemctl --user enable --now pool.service pool-tunnel.service
loginctl enable-linger "$USER"
```

Enabling lingering lets user services start after boot without an interactive
login. Existing tunnels and other Access applications do not need changes.

To ship a new build, replace the binary and web assets, then reload:

```sh
systemctl --user reload pool.service
```

Reload sends SIGHUP. Pool starts the binary now on disk with the same listening
socket, using [tableflip](https://github.com/cloudflare/tableflip). Once the new
process listens, the old one closes `kv.db` so the new one can open it, stops
token refresh and quota polling, and lets open requests finish for up to
`server.shutdown-timeout` seconds. That defaults to 600 in Pool. No connection
is refused and no stream is cut. `restart` still works, but it cuts every open
stream.

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
