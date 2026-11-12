import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { css } from "../styled-system/css";
import {
  dollars,
  number,
  queries,
  type Metric,
  type Period,
  type Usage,
} from "./api";
import { EmptyState, ErrorState, Loading, palette } from "./ui";

export const clients: Record<string, { label: string; color: string }> = {
  "claude-code": { label: "Claude Code", color: palette.claude },
  codex: { label: "Codex", color: palette.codex },
  other: { label: "Other", color: palette.violet },
};
const client = (id: string) => clients[id] ?? clients.other;
const periodDays: Record<Period, number> = {
  "24h": 2,
  "7d": 8,
  "30d": 31,
  "90d": 91,
};
const axis = { fontSize: 12, fill: "#8a8a90" };
const label = css({ color: "dim", fontSize: "14px" });

export const amount = (metric: Metric, value: number) =>
  metric === "cost" ? dollars(value) : number.format(value);

/** One person's usage: totals by tool, a daily stacked chart, and a breakdown by token type. */
export function UsageView({
  period,
  metric,
  owner,
}: {
  period: Period;
  metric: Metric;
  owner?: string;
}) {
  const usage = useQuery(queries.usage(period, owner));
  if (usage.isError)
    return (
      <ErrorState error={usage.error} retry={() => void usage.refetch()} />
    );
  if (usage.isPending) return <Loading />;
  const u = usage.data;
  if (!u.requests)
    return (
      <EmptyState
        title="No usage in this period."
        description="Requests show up here as soon as a token is used."
      />
    );
  const value = (row: { tokens: number; cost_micros: number }) =>
    metric === "cost" ? row.cost_micros : row.tokens;
  const total = metric === "cost" ? u.cost_micros : u.tokens;

  return (
    <div className={css({ display: "grid", gap: "32px" })}>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(240px, 300px) minmax(0, 1fr)",
          gap: "40px",
          mdDown: { gridTemplateColumns: "minmax(0, 1fr)" },
        })}
      >
        <div
          className={css({
            display: "grid",
            gap: "22px",
            alignContent: "start",
          })}
        >
          <div>
            <strong
              className={css({
                display: "block",
                fontSize: "44px",
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
              })}
            >
              {amount(metric, total)}
            </strong>
            <span className={label}>
              {number.format(u.requests)} requests
              {metric === "cost" && " · API estimate"}
            </span>
          </div>
          {u.clients.map((c) => (
            <div
              key={c.client}
              className={css({ display: "grid", gap: "2px" })}
            >
              <div
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "16px",
                })}
              >
                <span
                  className={css({
                    width: "8px",
                    height: "8px",
                    borderRadius: "full",
                    flexShrink: 0,
                  })}
                  style={{ background: client(c.client).color }}
                />
                <span className={css({ flex: 1 })}>
                  {client(c.client).label}
                </span>
                <strong
                  className={css({
                    fontWeight: 500,
                    fontVariantNumeric: "tabular-nums",
                  })}
                >
                  {amount(metric, value(c))}
                </strong>
              </div>
              <span
                className={css({
                  color: "faint",
                  fontSize: "13px",
                  paddingLeft: "18px",
                })}
              >
                {total ? Math.round((value(c) / total) * 1000) / 10 : 0}% of{" "}
                {metric === "cost" ? "cost" : "tokens"} ·{" "}
                {metric === "cost"
                  ? number.format(c.tokens) + " tokens"
                  : dollars(c.cost_micros)}
              </span>
            </div>
          ))}
        </div>
        <DailyChart usage={u} period={period} metric={metric} />
      </div>

      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: "20px",
          mdDown: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        })}
      >
        <Figure label="Processed tokens">{number.format(u.tokens)}</Figure>
        <Figure label="Cached input" color={palette.teal}>
          {number.format(u.cache_read)}
        </Figure>
        <Figure label="Uncached input" color={palette.blue}>
          {number.format(u.uncached + u.cache_write)}
        </Figure>
        <Figure label="Output" color={palette.pink}>
          {number.format(u.output)}
        </Figure>
        <Figure label="Cache savings" color={palette.ok}>
          {dollars(u.savings_micros)}
        </Figure>
      </div>

      <TypeBar usage={u} metric={metric} />
    </div>
  );
}

function Figure({
  label: text,
  color,
  children,
}: {
  label: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <div className={css({ display: "grid", gap: "4px", minWidth: 0 })}>
      <span className={label}>{text}</span>
      <strong
        className={css({
          fontSize: "22px",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
        })}
        style={{ color }}
      >
        {children}
      </strong>
    </div>
  );
}

function DailyChart({
  usage,
  period,
  metric,
}: {
  usage: Usage;
  period: Period;
  metric: Metric;
}) {
  const ids = usage.clients.map((c) => c.client);
  const byDate = new Map<string, Record<string, number>>();
  for (const d of usage.days) {
    const row = byDate.get(d.date) ?? {};
    row[d.client] = metric === "cost" ? d.cost_micros : d.tokens;
    byDate.set(d.date, row);
  }
  // Every UTC day in the period, so quiet days show as zero instead of a straight line.
  const rows = Array.from({ length: periodDays[period] }, (_, i) => {
    const date = new Date(
      Date.now() - (periodDays[period] - 1 - i) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const row: Record<string, number | string> = { date };
    for (const id of ids) row[id] = byDate.get(date)?.[id] ?? 0;
    return row;
  });
  const format = (v: number) =>
    metric === "cost" ? dollars(v) : number.format(v);

  return (
    <div className={css({ display: "grid", gap: "12px", minWidth: 0 })}>
      <span className={css({ fontSize: "16px", fontWeight: 500 })}>
        Daily {metric === "cost" ? "cost" : "tokens"}
      </span>
      <div
        role="img"
        aria-label={`Daily ${metric} by tool`}
        className={css({ height: "260px", marginInline: "-6px" })}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              {ids.map((id) => (
                <linearGradient
                  key={id}
                  id={"usage-" + id}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={client(id).color}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={client(id).color}
                    stopOpacity={0.04}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="#1c1c1f" vertical={false} />
            <XAxis
              dataKey="date"
              tick={axis}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={40}
              tickFormatter={(v) =>
                new Date(String(v) + "T00:00:00Z").toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric", timeZone: "UTC" },
                )
              }
            />
            <YAxis
              tick={axis}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v) => format(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: "#4a4a50" }}
              contentStyle={{
                background: "#1b1b1e",
                border: "1px solid #2c2c30",
                borderRadius: 8,
                fontSize: 13,
              }}
              labelFormatter={(v) =>
                new Date(String(v) + "T00:00:00Z").toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric", timeZone: "UTC" },
                )
              }
              formatter={(v, name) => [
                format(Number(v)),
                client(String(name)).label,
              ]}
            />
            {ids.map((id) => (
              <Area
                key={id}
                type="monotone"
                dataKey={id}
                stackId="1"
                stroke={client(id).color}
                strokeWidth={1.75}
                fill={`url(#usage-${id})`}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TypeBar({ usage, metric }: { usage: Usage; metric: Metric }) {
  const parts = [
    {
      label: "Input",
      color: palette.blue,
      tokens: usage.uncached,
      cost: usage.cost.uncached,
    },
    {
      label: "Cache read",
      color: palette.teal,
      tokens: usage.cache_read,
      cost: usage.cost.cache_read,
    },
    {
      label: "Cache write",
      color: palette.warn,
      tokens: usage.cache_write,
      cost: usage.cost.cache_write,
    },
    {
      label: "Output",
      color: palette.pink,
      tokens: usage.output,
      cost: usage.cost.output,
    },
  ].map((p) => ({ ...p, value: metric === "cost" ? p.cost : p.tokens }));
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return null;
  return (
    <div className={css({ display: "grid", gap: "12px" })}>
      <span className={css({ fontSize: "16px", fontWeight: 500 })}>
        {metric === "cost" ? "Cost" : "Tokens"} by type
      </span>
      <div className={css({ display: "flex", gap: "3px", height: "8px" })}>
        {parts.map((p) =>
          p.value ? (
            <span
              key={p.label}
              title={p.label}
              className={css({ borderRadius: "full", minWidth: "4px" })}
              style={{ flex: p.value, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <div
        className={css({
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 22px",
          fontSize: "14px",
        })}
      >
        {parts.map((p) => (
          <span
            key={p.label}
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            })}
          >
            <span
              className={css({
                width: "9px",
                height: "9px",
                borderRadius: "2px",
              })}
              style={{ background: p.color }}
            />
            <span className={css({ color: "dim" })}>{p.label}</span>
            <span className={css({ fontVariantNumeric: "tabular-nums" })}>
              {amount(metric, p.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
