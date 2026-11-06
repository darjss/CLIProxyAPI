import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { button, panel, providerSymbol } from "../styled-system/recipes";
import {
  api,
  dateTime,
  type QuotaAccount,
  type QuotaPool,
  type QuotaSnapshot,
} from "./api";
import { EmptyState, ErrorState, Loading } from "./components";
import { styles } from "./styles";

type Provider = "all" | "claude" | "codex";

export function QuotaSection({ admin }: { admin: boolean }) {
  const [provider, setProvider] = useState<Provider>("all");
  const [hours, setHours] = useState("3");
  const [scenario, setScenario] = useState("same");
  const quota = useQuery({
    queryKey: ["quota", hours, scenario],
    queryFn: ({ signal }) =>
      api<QuotaSnapshot>("/quota?hours=" + hours + "&scenario=" + scenario, {
        signal,
      }),
    refetchInterval: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => api("/admin/quota/refresh", { method: "POST" }),
  });
  return (
    <section aria-label="Shared provider quota">
      <div className={styles.sectionHeading}>
        <h2>Shared quota</h2>
        <span className={styles.small}>
          Claude + Codex · account-relative quota
        </span>
      </div>
      <div className={styles.rankingToolbar}>
        <div className={styles.segmented}>
          {(["all", "claude", "codex"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={provider === value}
              onClick={() => setProvider(value)}
            >
              {value === "all"
                ? "All providers"
                : value === "claude"
                  ? "Claude"
                  : "Codex"}
            </button>
          ))}
        </div>
        <div className={styles.quotaControls}>
          <select
            aria-label="Future usage"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            <option value="same">Same usage</option>
            <option value="half">Half usage</option>
            <option value="double">Double usage</option>
          </select>
          <select
            aria-label="Burn rate window"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          >
            <option value="1">Burn · last 1h</option>
            <option value="3">Burn · last 3h</option>
            <option value="6">Burn · last 6h</option>
          </select>
          {admin && (
            <button
              className={button()}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw size={13} />
              {refresh.isPending ? "Scheduling…" : "Refresh quota"}
            </button>
          )}
        </div>
      </div>
      {refresh.isError && (
        <p className={styles.formError} role="alert">
          {refresh.error.message}
        </p>
      )}
      {refresh.isSuccess && (
        <p className={styles.footnote} role="status">
          Refresh scheduled. Observations update in the background.
        </p>
      )}
      {quota.isError ? (
        <ErrorState error={quota.error} retry={() => void quota.refetch()} />
      ) : quota.isPending ? (
        <Loading label="Reading quota snapshots…" />
      ) : (
        (["claude", "codex"] as const)
          .filter((value) => provider === "all" || provider === value)
          .map((value) => (
            <ProviderQuota
              key={value}
              provider={value}
              pools={quota.data.pools.filter((pool) => pool.provider === value)}
              accounts={quota.data.accounts.filter(
                (account) => account.provider === value,
              )}
              observedAt={quota.data.observed_at}
            />
          ))
      )}
      <p className={styles.footnote}>
        Each measured account contributes 100 quota points. Plans can have
        different capacity; these are unweighted account percentages, not token
        balances. History covers current accounts and begins when collection
        starts. Dashed projections assume recent burn and only the next reported
        reset; they are estimates.
      </p>
    </section>
  );
}

function windowLabel(pool: QuotaPool) {
  if (pool.window.startsWith("seven_day"))
    return (
      "7-day" +
      (pool.window === "seven_day"
        ? ""
        : " · " + pool.window.slice(10).replaceAll("_", " "))
    );
  if (pool.window === "five_hour") return "5-hour";
  return pool.period_seconds
    ? pool.period_seconds / 3600 >= 24
      ? (pool.period_seconds / 86400).toFixed(0) + "-day"
      : (pool.period_seconds / 3600).toFixed(0) + "-hour"
    : pool.window;
}

function ProviderQuota({
  provider,
  pools,
  accounts,
  observedAt,
}: {
  provider: "claude" | "codex";
  pools: QuotaPool[];
  accounts: QuotaAccount[];
  observedAt: number;
}) {
  const [selected, setSelected] = useState("");
  const pool =
    pools.find((pool) => pool.id === selected) ??
    pools.find((pool) => pool.period_seconds >= 604800) ??
    pools[0];
  const color = provider === "claude" ? "#d79479" : "#a4b6df";
  const data = pool
    ? [
        ...pool.history.map((point) => ({
          at: point.at,
          recorded: point.remaining,
          projected: null as number | null,
        })),
        ...pool.projected.map((point) => ({
          at: point.at,
          recorded: null as number | null,
          projected: point.remaining,
        })),
      ]
    : [];
  const empty = pool?.projected.find(
    (point) => point.remaining !== null && point.remaining <= 0,
  );
  return (
    <section className={panel()}>
      <div className={styles.panelHeading}>
        <div className={styles.providerName}>
          <span className={providerSymbol({ provider })} aria-hidden="true">
            {provider === "claude" ? "✳" : "◈"}
          </span>
          <h3>{provider === "claude" ? "Claude" : "Codex"}</h3>
          <span className={styles.countBadge}>{accounts.length} connected</span>
        </div>
        {pool ? (
          <div className={styles.headerActions}>
            <span className={styles.subtleBadge}>
              {pool.stale
                ? "Stale observation"
                : "Observed " + dateTime(pool.observed_at)}
            </span>
            <select
              aria-label={provider + " quota window"}
              value={pool.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {windowLabel(pool)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className={styles.subtleBadge}>
            {accounts.length ? "Waiting for quota" : "No accounts"}
          </span>
        )}
      </div>
      {pool ? (
        <>
          <div className={styles.quotaSummary}>
            <div>
              <strong className={styles.quotaBalance}>
                {pool.remaining.toFixed(0)}%
                <span> of {pool.capacity.toFixed(0)}%</span>
              </strong>
              <p className={styles.footnote}>
                {pool.accounts} measured accounts · {windowLabel(pool)} ·{" "}
                {pool.stale ? "refresh required" : "account quota points"}
              </p>
            </div>
            <div>
              <span className={styles.cellNote}>Burn per hour</span>
              <strong>
                {pool.burn_per_hour === null
                  ? "Collecting history"
                  : pool.burn_per_hour.toFixed(1) + "%"}
              </strong>
            </div>
            <div>
              <span className={styles.cellNote}>Next reported reset</span>
              <strong>
                {pool.next_reset ? dateTime(pool.next_reset) : "Unknown"}
              </strong>
            </div>
            <div>
              <span className={styles.cellNote}>Projected pool empty</span>
              <strong>
                {empty
                  ? "~ " + dateTime(empty.at)
                  : pool.projected.length
                    ? "Outside projection"
                    : "Insufficient history"}
              </strong>
            </div>
          </div>
          <div
            className={styles.quotaChart}
            role="img"
            aria-label={provider + " quota history and estimated future quota"}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 18, right: 14, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="#242428" vertical={false} />
                <XAxis
                  dataKey="at"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value) =>
                    new Date(Number(value) * 1000).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )
                  }
                  tick={{ fontSize: 10, fill: "#8a8a96" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={36}
                />
                <YAxis
                  domain={[0, pool.capacity]}
                  tickFormatter={(value) => value + "%"}
                  tick={{ fontSize: 10, fill: "#8a8a96" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "#19191d",
                    border: "1px solid #34343b",
                    borderRadius: 8,
                  }}
                  labelFormatter={(value) => dateTime(Number(value))}
                  formatter={(value) => [
                    Number(value).toFixed(1) + "%",
                    "Quota points",
                  ]}
                />
                <ReferenceLine
                  x={observedAt}
                  stroke="#686875"
                  label={{
                    value: "Now",
                    fill: "#8a8a96",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
                <Line
                  dataKey="recorded"
                  name="Recorded"
                  type="linear"
                  stroke={color}
                  strokeWidth={2}
                  dot={data.length < 3 ? { r: 3 } : false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="projected"
                  name="Projected"
                  type="linear"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.quotaLegend}>
            <span style={{ color }}>━ Recorded</span>
            <span style={{ color }}>┄ Projected</span>
            <span>
              {pool.stale
                ? "Projections paused until fresh quota arrives"
                : "Gaps indicate incomplete pool observations"}
            </span>
          </div>
        </>
      ) : (
        <EmptyState
          title={
            accounts.length
              ? "Waiting for the first observation."
              : "Connect an account to start."
          }
          description={
            accounts.length
              ? "The collector checks the provider in the background every two minutes. Any errors are shown below."
              : "Sign in with the existing CLI OAuth flow. Server-side history will collect even when this page is closed."
          }
        />
      )}
      {accounts.length > 0 && (
        <details className={styles.quotaDetails}>
          <summary>Accounts · {accounts.length}</summary>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Collection</th>
                  <th>Checked</th>
                  <th>Reported windows</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      {provider} · {account.id.slice(0, 6)}
                    </td>
                    <td>{account.status.replaceAll("_", " ")}</td>
                    <td>
                      {account.checked_at
                        ? dateTime(account.checked_at)
                        : "Pending"}
                    </td>
                    <td>
                      {account.windows
                        .map(
                          (window) =>
                            window.window.replaceAll("_", " ") +
                            ": " +
                            window.remaining.toFixed(0) +
                            "%",
                        )
                        .join(" · ") || "Not reported"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
