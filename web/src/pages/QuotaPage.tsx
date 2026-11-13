import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  Menu,
  Modal,
  PageHeader,
  ProviderIcon,
  Segmented,
  Stat,
  actions,
  card,
  formError,
  palette,
  providerName,
} from "../ui";
import { QuotaChart, type View } from "./QuotaChart";

type Provider = "all" | "claude" | "codex";
type Hours = "1" | "3" | "6";

const providers = ["claude", "codex"] as const;
const colors = { claude: "#e8835f", codex: "#7d9ef5" };
const day = 86400;
const viewDays = 7;
const shiftDays = 3;

export default function QuotaPage({ admin }: { admin: boolean }) {
  const [provider, setProvider] = useState<Provider>("all");
  const [view, setView] = useState<View>("remaining");
  const [hours, setHours] = useState<Hours>("3");
  const [connecting, setConnecting] = useState(false);
  const [shift, setShift] = useState(0);
  const quota = useQuery({
    queryKey: ["quota", hours],
    queryFn: ({ signal }) =>
      api<QuotaSnapshot>(`/quota?hours=${hours}`, {
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
      <PageHeader title="Accounts">
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

      {
        <>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
              marginBottom: "20px",
            })}
          >
            <Segmented
              label="Provider"
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
            <Segmented
              label="Chart"
              value={view}
              onChange={setView}
              options={[
                { value: "remaining", label: "Remaining" },
                { value: "drain", label: "Drain rate" },
              ]}
            />
            <span title="How far back the burn rate and forecast look">
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
            </span>
            <div
              title={`${shortDate(domain[0])} to ${shortDate(domain[1] - 1)}`}
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "auto",
                color: "dim",
              })}
            >
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
                    factor={1}
                    admin={admin}
                  />
                ))}
            </div>
          )}
        </>
      }
    </>
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
  // After an upstream 429 or error, Pool skips the account until this time.
  if (account.cooldown_until > now)
    return {
      label: `Paused · retrying ${relative(account.cooldown_until, now)}`,
      color: palette.warn,
      title: account.message,
    };
  if (account.auth_status === "error" || account.status !== "ok")
    return { label: "Error", color: palette.bad, title: account.message };
  return { label: "Active", color: palette.ok };
}

type ResetOption = NonNullable<
  NonNullable<QuotaAccount["free_reset"]>["options"]
>[number];

function resetDetail(option: ResetOption) {
  return [
    option.clears?.length && "Clears " + option.clears.join(" and "),
    option.left > 1 && `${option.left} left`,
    option.expires && "Expires " + shortDate(option.expires),
    option.detail,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Pick which Claude grant or Codex credit to spend on an account. */
function FreeResetDialog({
  account,
  onClose,
}: {
  account: QuotaAccount;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const options = account.free_reset?.options ?? [];
  const [chosen, setChosen] = useState(
    () => options.find((option) => option.usable)?.id ?? "",
  );
  const spend = useMutation({
    mutationFn: () =>
      api(`/admin/accounts/${encodeURIComponent(account.id)}/free-reset`, {
        method: "POST",
        body: JSON.stringify({ option: chosen }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["quota"] });
      onClose();
    },
  });
  const limited = account.windows.some((w) => w.remaining <= 0);
  return (
    <Modal title="Use a free reset" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          spend.mutate();
        }}
      >
        <p className={css({ color: "dim", fontSize: "14px" })}>
          {account.email || "This account"} goes back to zero usage on the
          windows the reset clears.
        </p>
        <div role="radiogroup" aria-label="Free resets">
          {options.map((option) => (
            <label
              key={option.id}
              className={css({
                display: "grid",
                gridTemplateColumns: "20px minmax(0, 1fr)",
                alignItems: "center",
                gap: "12px",
                padding: "12px 4px",
                borderTop: "1px solid token(colors.line)",
                cursor: "pointer",
                _first: { borderTop: 0 },
                "&:has(input:disabled)": { cursor: "default", opacity: 0.55 },
              })}
            >
              <input
                type="radio"
                name="free-reset"
                disabled={!option.usable}
                checked={chosen === option.id}
                onChange={() => setChosen(option.id)}
                className={css({
                  accentColor: "focus",
                  width: "16px",
                  height: "16px",
                })}
              />
              <span className={css({ display: "grid", gap: "2px" })}>
                <strong className={css({ fontWeight: 500, fontSize: "15px" })}>
                  {option.label}
                </strong>
                <span className={css({ color: "dim", fontSize: "13px" })}>
                  {resetDetail(option)}
                </span>
                {option.note && (
                  <span
                    className={css({ fontSize: "13px" })}
                    style={{ color: palette.warn }}
                  >
                    {option.note}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        {!limited && chosen && (
          <p
            className={css({ fontSize: "14px" })}
            style={{ color: palette.warn }}
          >
            This account still has quota left. A reset now throws that unused
            quota away.
          </p>
        )}
        {spend.error && (
          <p role="alert" className={formError}>
            {spend.error.message}
          </p>
        )}
        <div className={actions}>
          <button
            type="button"
            className={button({ variant: "ghost" })}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={button({ variant: "primary" })}
            disabled={!chosen || spend.isPending}
          >
            {spend.isPending ? "Resetting…" : "Use reset"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AccountMenu({ account }: { account: QuotaAccount }) {
  const client = useQueryClient();
  const [picking, setPicking] = useState(false);
  const act = useMutation({
    mutationFn: (action: "disable" | "enable" | "reset" | "delete") =>
      api(`/admin/accounts/${encodeURIComponent(account.id)}/${action}`, {
        method: "POST",
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["quota"] }),
    onError: (error) => window.alert(error.message),
  });
  const free = account.free_reset;
  return (
    <>
      {picking && (
        <FreeResetDialog account={account} onClose={() => setPicking(false)} />
      )}
      <Menu
        label={"Actions for " + (account.email || account.id)}
        items={[
          ...(free?.options?.length
            ? [
                {
                  label: `Use free reset… (${free.left} left)`,
                  onSelect: () => setPicking(true),
                },
              ]
            : []),
          ...(account.cooldown_until
            ? [{ label: "Retry now", onSelect: () => act.mutate("reset") }]
            : []),
          account.disabled
            ? { label: "Enable", onSelect: () => act.mutate("enable") }
            : {
                label: "Disable",
                danger: true,
                onSelect: () => act.mutate("disable"),
              },
          {
            label: "Delete",
            danger: true,
            onSelect: () => {
              const name = account.email || "this account";
              if (
                window.confirm(
                  `Delete ${name}? Pool removes its login and stops using it. To add it back, connect it again.`,
                )
              )
                act.mutate("delete");
            },
          },
        ]}
      />
    </>
  );
}

// Bigger plans get the louder color, so $200 accounts stand out in the list.
const planColor = (price = 0) =>
  price >= 200 ? palette.blue : price >= 100 ? palette.teal : palette.gray;

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
              gridTemplateColumns:
                "minmax(220px, 1.2fr) minmax(0, 3fr) 96px 36px",
              gap: "16px 32px",
              alignItems: "center",
              padding: "18px 0",
              borderBottom: "1px solid token(colors.line)",
              _last: { borderBottom: 0, paddingBottom: 0 },
              mdDown: { gridTemplateColumns: "minmax(0, 1fr) auto" },
            })}
          >
            <div
              className={css({
                display: "grid",
                gap: "8px",
                justifyItems: "start",
                minWidth: 0,
              })}
            >
              <span
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  maxWidth: "100%",
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
                    whiteSpace: "nowrap",
                  })}
                >
                  {account.email ||
                    account.provider + "-" + account.id.slice(0, 6)}
                </span>
              </span>
              <div
                className={css({
                  display: "flex",
                  gap: "6px",
                  flexWrap: "wrap",
                })}
              >
                {account.plan && (
                  <Chip color={planColor(account.plan.price)}>
                    {account.plan.name}
                    {account.plan.price ? ` · $${account.plan.price}` : ""}
                  </Chip>
                )}
                <span
                  title={
                    [
                      state.title,
                      account.checked_at &&
                        "Checked " + relative(account.checked_at, now),
                    ]
                      .filter(Boolean)
                      .join("\n") || undefined
                  }
                >
                  <Chip color={state.color}>{state.label}</Chip>
                </span>
                {admin && account.free_reset && account.free_reset.left > 0 && (
                  <span
                    title={[
                      "Free usage resets from the provider. Each one sets this account's limits back to zero.",
                      account.free_reset.expires &&
                        "Next one expires " +
                          numericDateTime(account.free_reset.expires),
                      account.free_reset.note,
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  >
                    <Chip color={palette.violet}>
                      {account.free_reset.left} free{" "}
                      {account.free_reset.left === 1 ? "reset" : "resets"}
                    </Chip>
                  </span>
                )}
              </div>
            </div>
            {windows.length ? (
              <div
                className={css({
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "18px 32px",
                  mdDown: { gridColumn: "1 / -1", order: 3 },
                  smDown: { gridTemplateColumns: "minmax(0, 1fr)" },
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
              <span
                className={css({
                  color: "faint",
                  fontSize: "14px",
                  mdDown: { gridColumn: "1 / -1", order: 3 },
                })}
              >
                No quota reported yet
              </span>
            )}
            <div
              title="Last 24 hours"
              className={css({
                display: "grid",
                gap: "2px",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                mdDown: { display: "none" },
              })}
            >
              <strong className={css({ fontWeight: 600 })}>
                {account.day.requests ? dollars(account.day.cost_micros) : "—"}
              </strong>
              <span className={css({ color: "faint", fontSize: "13px" })}>
                {account.day.requests === 1
                  ? "1 request"
                  : number.format(account.day.requests) + " requests"}
              </span>
            </div>
            <div className={css({ justifySelf: "end" })}>
              {admin && <AccountMenu account={account} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
