import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Plus,
  RefreshCw,
} from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { button, iconButton } from "../../styled-system/recipes";
import {
  api,
  dollars,
  number,
  type PoolModel,
  type QuotaAccount,
  type QuotaPool,
  type QuotaSample,
  type QuotaSnapshot,
} from "../api";
import ConnectAccount from "../ConnectAccount";
import {
  numericDateTime,
  relative,
  shortDate,
  startOfDay,
  when,
} from "../time";
import {
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  ProviderIcon,
  Segmented,
  Stat,
  card,
  formError,
  palette,
  primaryCell,
  providerName,
  table,
  tableScroll,
} from "../ui";
import { QuotaChart, type View } from "./QuotaChart";

type Provider = "all" | "claude" | "codex";
type Hours = "1" | "3" | "6";
type Scenario = "same" | "half" | "double";

const providers = ["claude", "codex"] as const;
const colors = { claude: "#e8835f", codex: "#7d9ef5" };
const factors: Record<Scenario, number> = { same: 1, half: 0.5, double: 2 };
const day = 86400;
const viewDays = 7;
const shiftDays = 3;

export default function QuotaPage({ admin }: { admin: boolean }) {
  const [provider, setProvider] = useState<Provider>("all");
  const [view, setView] = useState<View>("remaining");
  const [hours, setHours] = useState<Hours>("3");
  const [scenario, setScenario] = useState<Scenario>("same");
  const [tab, setTab] = useState<"quota" | "models">("quota");
  const [connecting, setConnecting] = useState(false);
  const [shift, setShift] = useState(0);
  const quota = useQuery({
    queryKey: ["quota", hours, scenario],
    queryFn: ({ signal }) =>
      api<QuotaSnapshot>(`/quota?hours=${hours}&scenario=${scenario}`, {
        signal,
      }),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const refresh = useMutation({
    mutationFn: () => api("/admin/quota/refresh", { method: "POST" }),
  });

  const accounts = quota.data?.accounts ?? [];
  const now = quota.data?.observed_at || Math.floor(Date.now() / 1000);
  const count = (value: string) =>
    accounts.filter((account) => account.provider === value).length;
  const reporting = accounts.filter(
    (account) => account.status === "ok",
  ).length;

  // Every chart shares one time window so the cards line up vertically.
  const horizon = Math.max(
    now + day,
    ...(quota.data?.pools ?? []).map(
      (pool) => pool.projected[pool.projected.length - 1]?.at ?? 0,
    ),
  );
  const end = startOfDay(horizon) + day + shift * shiftDays * day;
  const domain: [number, number] = [end - viewDays * day, end];
  const oldest = now - 14 * day;

  return (
    <>
      <PageHeader
        title="Accounts"
        meta={
          quota.data && (
            <>
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
              <span className={css({ color: "faint", marginInline: "8px" })}>
                ·
              </span>
              {reporting} reporting
            </>
          )
        }
      >
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "quota", label: "Quota" },
            { value: "models", label: "Models" },
          ]}
        />
        {admin && (
          <button
            className={button()}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw size={16} />
            {refresh.isPending
              ? "Scheduling…"
              : refresh.isSuccess
                ? "Scheduled"
                : "Refresh"}
          </button>
        )}
        <button
          className={button({ variant: "primary" })}
          onClick={() => setConnecting(true)}
        >
          <Plus size={16} />
          Connect account
        </button>
      </PageHeader>
      {connecting && (
        <Modal title="Connect an account" onClose={() => setConnecting(false)}>
          <ConnectAccount />
        </Modal>
      )}
      {refresh.isError && (
        <p
          role="alert"
          className={cx(formError, css({ mt: "-16px", mb: "16px" }))}
        >
          {refresh.error.message}
        </p>
      )}

      {tab === "models" ? (
        <Models />
      ) : (
        <>
          <div className={css({ marginBottom: "14px" })}>
            <Segmented
              label="Provider"
              plain
              value={provider}
              onChange={setProvider}
              options={[
                {
                  value: "all",
                  label: (
                    <>
                      <Command size={16} />
                      All
                    </>
                  ),
                  count: accounts.length,
                },
                ...providers.map((value) => ({
                  value,
                  label: (
                    <>
                      <ProviderIcon provider={value} />
                      {providerName(value)}
                    </>
                  ),
                  count: count(value),
                })),
              ]}
            />
          </div>

          <div
            className={css({
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "22px",
            })}
          >
            <Segmented
              label="Chart"
              value={view}
              onChange={setView}
              options={[
                { value: "remaining", label: "Remaining" },
                { value: "drain", label: "Drain rate" },
              ]}
            />
            <Control label="Burn rate">
              <Segmented
                label="Burn rate window"
                value={hours}
                onChange={setHours}
                options={[
                  { value: "1", label: "1h" },
                  { value: "3", label: "3h" },
                  { value: "6", label: "6h" },
                ]}
              />
            </Control>
            <Control label="Future usage">
              <div className={css({ position: "relative" })}>
                <select
                  aria-label="Future usage"
                  value={scenario}
                  onChange={(event) =>
                    setScenario(event.target.value as Scenario)
                  }
                  className={css({
                    appearance: "none",
                    height: "42px",
                    paddingInline: "14px 40px",
                    borderRadius: "12px",
                    background: "card",
                    color: "fg",
                    fontSize: "15px",
                    fontWeight: 500,
                    _hover: { background: "raised" },
                    "& option": { background: "#18181a" },
                  })}
                >
                  <option value="same">Same as now</option>
                  <option value="half">Half as much</option>
                  <option value="double">Twice as much</option>
                </select>
                <ChevronDown
                  size={16}
                  className={css({
                    position: "absolute",
                    right: "14px",
                    top: "13px",
                    pointerEvents: "none",
                    color: "dim",
                  })}
                />
              </div>
            </Control>
            <div
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginLeft: "auto",
                color: "dim",
                fontSize: "15px",
              })}
            >
              <span
                className={css({ marginRight: "6px", whiteSpace: "nowrap" })}
              >
                {shortDate(domain[0])} to {shortDate(domain[1] - 1)}
              </span>
              <button
                className={iconButton()}
                aria-label="Earlier"
                disabled={domain[0] <= oldest}
                onClick={() => setShift((value) => value - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className={button({ size: "md" })}
                disabled={shift === 0}
                onClick={() => setShift(0)}
              >
                Today
              </button>
              <button
                className={iconButton()}
                aria-label="Later"
                disabled={shift === 0}
                onClick={() => setShift((value) => value + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {quota.isError && !quota.data ? (
            <ErrorState
              error={quota.error}
              retry={() => void quota.refetch()}
            />
          ) : !quota.data ? (
            <Loading label="Reading quota snapshots…" />
          ) : (
            <div
              className={css({
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: "20px",
              })}
            >
              {providers
                .filter((value) => provider === "all" || provider === value)
                .map((value) => (
                  <ProviderCard
                    key={value}
                    provider={value}
                    pools={quota.data.pools.filter(
                      (pool) => pool.provider === value,
                    )}
                    accounts={accounts.filter(
                      (account) => account.provider === value,
                    )}
                    view={view}
                    now={now}
                    domain={domain}
                    hours={Number(hours)}
                    factor={factors[scenario]}
                    admin={admin}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Models() {
  const models = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => api<PoolModel[]>("/models", { signal }),
  });
  if (models.isError)
    return (
      <ErrorState error={models.error} retry={() => void models.refetch()} />
    );
  if (models.isPending) return <Loading />;
  if (!models.data.length)
    return (
      <div className={card}>
        <EmptyState
          title="No models yet."
          description="Models appear once an enabled account is connected."
        />
      </div>
    );
  const rate = (v?: number) => (v === undefined ? "—" : "$" + v);
  return (
    <div className={cx(card, tableScroll)}>
      <table className={table}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Accounts</th>
            <th title="USD per million tokens">Input</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {models.data.map((m) => (
            <tr key={m.provider + m.id}>
              <td className={primaryCell}>
                <span
                  className={css({
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  })}
                >
                  <ProviderIcon provider={m.provider} size={15} />
                  {m.id}
                </span>
              </td>
              <td title={m.accounts.join("\n")}>
                <Chip
                  color={
                    colors[m.provider as "claude" | "codex"] ?? palette.gray
                  }
                >
                  {m.accounts.length}
                </Chip>
              </td>
              <td>{rate(m.price?.input)}</td>
              <td>{rate(m.price?.cache_read)}</td>
              <td>{rate(m.price?.cache_write)}</td>
              <td>{rate(m.price?.output)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css({ color: "faint", fontSize: "13px", mt: "12px" })}>
        API rates per million tokens, from models.dev.
      </p>
    </div>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={css({ display: "flex", alignItems: "center", gap: "4px" })}>
      <span
        className={css({
          color: "dim",
          fontSize: "15px",
          paddingInline: "8px",
          whiteSpace: "nowrap",
        })}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function windowLabel(window: string, period: number) {
  if (window === "five_hour") return "5-hour";
  if (window === "seven_day") return "7-day";
  if (window.startsWith("seven_day_"))
    return "7-day " + window.slice(10).replaceAll("_", " ");
  if (period)
    return period >= day
      ? Math.round(period / day) + "-day"
      : Math.round(period / 3600) + "-hour";
  return window.replaceAll("_", " ");
}

function samplesFor(accounts: QuotaAccount[], pool: QuotaPool) {
  return accounts.flatMap((account) =>
    account.windows.filter(
      (w) =>
        w.window === pool.window && w.period_seconds === pool.period_seconds,
    ),
  );
}

function ProviderCard({
  provider,
  pools,
  accounts,
  view,
  now,
  domain,
  hours,
  factor,
  admin,
}: {
  admin: boolean;
  provider: "claude" | "codex";
  pools: QuotaPool[];
  accounts: QuotaAccount[];
  view: View;
  now: number;
  domain: [number, number];
  hours: number;
  factor: number;
}) {
  const [selected, setSelected] = useState("");
  const sorted = [...pools].sort(
    (a, b) =>
      b.period_seconds - a.period_seconds || a.window.localeCompare(b.window),
  );
  const pool =
    sorted.find((p) => p.id === selected) ??
    sorted.find((p) => p.window === "seven_day") ??
    sorted[0];
  const color = colors[provider];

  return (
    <section className={card} aria-label={providerName(provider) + " quota"}>
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          minHeight: "36px",
        })}
      >
        <ProviderIcon provider={provider} size={20} />
        <h2 className={css({ fontSize: "19px", fontWeight: 600 })}>
          {providerName(provider)}
        </h2>
        <span className={css({ color: "dim", fontSize: "15px" })}>
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </span>
        {sorted.length > 1 && pool && (
          <div className={css({ marginLeft: "auto" })}>
            <Segmented
              label={providerName(provider) + " quota window"}
              value={pool.id}
              onChange={setSelected}
              options={sorted.map((p) => ({
                value: p.id,
                label: windowLabel(p.window, p.period_seconds),
              }))}
              plain
            />
          </div>
        )}
      </div>

      {pool ? (
        <PoolSummary
          pool={pool}
          samples={samplesFor(accounts, pool)}
          view={view}
          now={now}
          domain={domain}
          hours={hours}
          factor={factor}
          color={color}
        />
      ) : (
        <EmptyState
          title={
            accounts.length
              ? "Waiting for the first quota check."
              : "No accounts yet."
          }
          description={
            accounts.length
              ? "Quota is checked every two minutes."
              : "Use Connect account to share one."
          }
        />
      )}

      {accounts.length > 0 && (
        <AccountRows accounts={accounts} now={now} admin={admin} />
      )}
    </section>
  );
}

function PoolSummary({
  pool,
  samples,
  view,
  now,
  domain,
  hours,
  factor,
  color,
}: {
  pool: QuotaPool;
  samples: QuotaSample[];
  view: View;
  now: number;
  domain: [number, number];
  hours: number;
  factor: number;
  color: string;
}) {
  const empty = pool.projected.find(
    (point) => point.remaining !== null && point.remaining <= 0,
  );
  const projectionEnd = pool.projected[pool.projected.length - 1]?.at;
  const refill = samples
    .filter((sample) => sample.reset_at === pool.next_reset)
    .reduce((total, sample) => total + (100 - sample.remaining), 0);

  return (
    <>
      <div
        className={css({
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: "20px 56px",
          marginTop: "4px",
        })}
      >
        <div
          className={css({
            display: "flex",
            alignItems: "baseline",
            gap: "12px",
            flexWrap: "wrap",
          })}
        >
          <strong
            className={css({
              fontSize: "60px",
              lineHeight: 1.05,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              smDown: { fontSize: "46px" },
            })}
          >
            {pool.remaining.toFixed(0)}%
          </strong>
          <span className={css({ color: "dim", fontSize: "17px" })}>
            of {pool.capacity.toFixed(0)}%
          </span>
          <span className={css({ color: "dim", fontSize: "17px" })}>
            {windowLabel(pool.window, pool.period_seconds)} window
          </span>
        </div>
        <div
          className={css({
            display: "grid",
            gridAutoFlow: "column",
            gap: "56px",
            paddingBottom: "6px",
            lgDown: {
              gridAutoFlow: "row",
              gridTemplateColumns: "repeat(2, auto)",
              gap: "14px 40px",
            },
          })}
        >
          <Stat
            label="Pool empty"
            value={
              empty
                ? when(empty.at, now)
                : projectionEnd
                  ? "Not by " + shortDate(projectionEnd)
                  : pool.stale
                    ? "Projection paused"
                    : "Collecting history"
            }
          />
          <Stat
            label="Observed"
            tone={pool.stale ? "bad" : undefined}
            value={
              pool.stale
                ? "Stale · " + relative(pool.observed_at, now)
                : relative(pool.observed_at, now)
            }
          />
          <Stat
            label="Next reset"
            value={
              pool.next_reset
                ? (refill >= 0.5 ? "+" + refill.toFixed(0) + "% " : "") +
                  when(pool.next_reset, now)
                : "Unknown"
            }
          />
          <Stat
            label={`Burn, last ${hours}h`}
            value={
              pool.burn_per_hour === null
                ? "Collecting"
                : pool.burn_per_hour.toFixed(1) + "%/h"
            }
          />
        </div>
      </div>

      <div className={css({ marginTop: "18px" })}>
        <QuotaChart
          pool={pool}
          view={view}
          color={color}
          now={now}
          domain={domain}
          burnHours={hours}
          factor={factor}
        />
      </div>

      <div
        className={css({
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px 28px",
          marginTop: "16px",
          fontSize: "15px",
          color: "dim",
        })}
      >
        <span className={css({ color: "fg", marginRight: "14px" })}>Pool</span>
        <LegendKey color={color} label="Recorded" />
        <LegendKey color={color} label="Projected" dashed />
        {pool.stale ? (
          <span
            className={css({
              marginLeft: "auto",
              color: "faint",
              fontSize: "14px",
            })}
          >
            Projections paused until fresh quota arrives
          </span>
        ) : (
          pool.history.some((point) => point.remaining === null) && (
            <span
              className={css({
                marginLeft: "auto",
                color: "faint",
                fontSize: "14px",
              })}
            >
              Gaps indicate incomplete pool observations
            </span>
          )
        )}
      </div>
    </>
  );
}

function LegendKey({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span
      className={css({
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
      })}
    >
      <svg width="20" height="4" aria-hidden="true">
        <line
          x1="0"
          y1="2"
          x2="20"
          y2="2"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function barColor(value: number) {
  return value >= 50 ? "#4fbf7f" : value >= 20 ? "#e0b34f" : "#ef6b63";
}

/** One plain-language state per account; quota exhaustion explains most upstream errors. */
function accountState(account: QuotaAccount, now: number) {
  if (account.disabled) return { label: "Disabled", color: palette.gray };
  const empty = account.windows
    .filter((w) => w.remaining <= 0 && w.reset_at > now)
    .sort((a, b) => b.reset_at - a.reset_at)[0];
  if (empty)
    return {
      label: `${windowLabel(empty.window, empty.period_seconds)} limit used · back ${relative(empty.reset_at, now)}`,
      color: palette.warn,
    };
  if (account.status === "sign_in_required")
    return { label: "Sign-in expired · reconnect", color: palette.bad };
  if (account.auth_status === "error" || account.status !== "ok")
    return { label: "Error", color: palette.bad, title: account.message };
  return { label: "Active", color: palette.ok };
}

function AccountToggle({ account }: { account: QuotaAccount }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api(`/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: "PUT",
        body: JSON.stringify({ disabled: !account.disabled }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["quota"] }),
  });
  return (
    <button
      className={button({ size: "md" })}
      disabled={toggle.isPending}
      title={toggle.isError ? toggle.error.message : undefined}
      onClick={() => toggle.mutate()}
    >
      {account.disabled ? "Enable" : "Disable"}
    </button>
  );
}

function AccountRows({
  accounts,
  now,
  admin,
}: {
  accounts: QuotaAccount[];
  now: number;
  admin: boolean;
}) {
  return (
    <div
      className={css({
        marginTop: "26px",
        borderTop: "1px solid token(colors.line)",
      })}
    >
      {accounts.map((account) => {
        const state = accountState(account, now);
        const windows = [...account.windows].sort(
          (a, b) => b.period_seconds - a.period_seconds,
        );
        return (
          <div
            key={account.id}
            className={css({
              display: "grid",
              gridTemplateColumns: "minmax(200px, 1fr) minmax(0, 3fr)",
              gap: "16px 40px",
              alignItems: "center",
              padding: "20px 0",
              borderBottom: "1px solid token(colors.line)",
              _last: { borderBottom: 0, paddingBottom: 0 },
              mdDown: { gridTemplateColumns: "minmax(0, 1fr)" },
            })}
          >
            <div className={css({ display: "grid", gap: "3px", minWidth: 0 })}>
              <span
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                })}
              >
                <ProviderIcon provider={account.provider} size={15} />
                <span
                  className={css({
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "fg",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  })}
                >
                  {account.email ||
                    account.provider + "-" + account.id.slice(0, 6)}
                </span>
              </span>
              <span
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                })}
              >
                <span title={state.title}>
                  <Chip color={state.color}>{state.label}</Chip>
                </span>
                {admin && <AccountToggle account={account} />}
              </span>
              <span className={css({ color: "faint", fontSize: "14px" })}>
                {account.day.requests
                  ? `${number.format(account.day.requests)} requests · ${dollars(account.day.cost_micros)} in 24h`
                  : "No requests in 24h"}
                {account.checked_at
                  ? " · checked " + relative(account.checked_at, now)
                  : ""}
              </span>
            </div>
            {windows.length ? (
              <div
                className={css({
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "18px 32px",
                })}
              >
                {windows.map((sample) => (
                  <div
                    key={sample.window + sample.period_seconds}
                    className={css({ display: "grid", gap: "8px" })}
                  >
                    <div
                      className={css({
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "15px",
                      })}
                    >
                      <span className={css({ color: "dim" })}>
                        {windowLabel(sample.window, sample.period_seconds)}
                      </span>
                      <strong
                        className={css({
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        })}
                      >
                        {sample.remaining.toFixed(0)}%
                      </strong>
                    </div>
                    <div
                      className={css({
                        height: "4px",
                        borderRadius: "full",
                        background: "active",
                        overflow: "hidden",
                      })}
                    >
                      <div
                        className={css({
                          height: "100%",
                          borderRadius: "full",
                        })}
                        style={{
                          width:
                            Math.min(100, Math.max(0, sample.remaining)) + "%",
                          background: barColor(sample.remaining),
                        }}
                      />
                    </div>
                    <span className={css({ color: "faint", fontSize: "14px" })}>
                      {sample.reset_at > now ? (
                        <>
                          <span className={css({ color: "dim" })}>
                            {relative(sample.reset_at, now)}
                          </span>{" "}
                          · {numericDateTime(sample.reset_at)}
                        </>
                      ) : (
                        "No reset pending"
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className={css({ color: "faint", fontSize: "14px" })}>
                No windows reported
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
