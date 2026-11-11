import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { css } from "../../styled-system/css";
import type { QuotaPoint, QuotaPool } from "../api";
import { dayTicks, tickLabel, when } from "../time";

export type View = "remaining" | "drain";
type Row = { at: number; recorded: number | null; projected: number | null };

const axis = { fontSize: 13, fill: "#8a8a90" };

export function QuotaChart({
  pool,
  view,
  color,
  now,
  domain,
  burnHours,
  factor,
}: {
  pool: QuotaPool;
  view: View;
  color: string;
  now: number;
  domain: [number, number];
  burnHours: number;
  factor: number;
}) {
  const rows =
    view === "remaining"
      ? remainingRows(pool)
      : drainRows(pool, burnHours, factor);
  const current =
    rows.find((row) => row.at === now && row.projected !== null)?.projected ??
    pool.remaining;
  const top =
    view === "remaining"
      ? pool.capacity
      : niceCeil(
          Math.max(
            1,
            ...rows.map((row) =>
              Math.max(row.recorded ?? 0, row.projected ?? 0),
            ),
          ),
        );
  const inView = (at: number) => at >= domain[0] && at <= domain[1];
  const jumps =
    view === "remaining" ? resets(rows).filter((jump) => inView(jump.at)) : [];
  const empty =
    view === "remaining"
      ? pool.projected.find(
          (point) => point.remaining !== null && point.remaining <= 0,
        )
      : undefined;
  const unit = view === "remaining" ? "%" : "%/h";
  const id = "fill-" + pool.id.replace(/[^a-z0-9]/gi, "");

  return (
    <div
      role="img"
      aria-label={`${pool.provider} quota ${view === "remaining" ? "remaining" : "drain rate"}, recorded and projected`}
      className={css({
        height: "360px",
        marginInline: "-6px",
        smDown: { height: "280px", "& .reset-label": { display: "none" } },
      })}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 30, right: 12, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c1c1f" />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={domain}
            allowDataOverflow
            ticks={dayTicks(domain[0], domain[1])}
            tickFormatter={(value) => tickLabel(Number(value))}
            tick={axis}
            tickLine={false}
            axisLine={false}
            tickMargin={12}
            minTickGap={24}
          />
          <YAxis
            domain={[0, top]}
            ticks={[0, top / 2, top]}
            allowDataOverflow
            tickFormatter={(value) => formatValue(Number(value)) + unit}
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={66}
          />
          <Tooltip
            cursor={{ stroke: "#4a4a50" }}
            position={{ y: 0 }}
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              if (!active || !row) return null;
              const projected = row.recorded === null;
              const value = projected ? row.projected : row.recorded;
              return (
                <div
                  className={css({
                    padding: "7px 12px",
                    borderRadius: "8px",
                    background: "#1b1b1e",
                    border: "1px solid token(colors.edge)",
                    fontSize: "14px",
                    whiteSpace: "nowrap",
                  })}
                >
                  {when(Number(label), now)} ·{" "}
                  {value === null
                    ? "no complete observation"
                    : formatValue(value) +
                      unit +
                      (view === "remaining" ? " left" : "")}
                  {" · "}
                  {projected ? "projected" : "recorded"}
                </div>
              );
            }}
          />
          <ReferenceLine
            x={now}
            stroke="#3a3a3f"
            label={{
              value: "Now",
              position: "top",
              fill: "#9b9ba1",
              fontSize: 13,
              offset: 12,
            }}
          />
          <Area
            dataKey="recorded"
            type="linear"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            dot={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Area
            dataKey="projected"
            type="linear"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="7 6"
            fill={`url(#${id})`}
            fillOpacity={0.45}
            dot={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          {jumps.map((jump) => (
            <ReferenceDot
              key={jump.at}
              x={jump.at}
              y={jump.value}
              r={0}
              className="reset-label"
              ifOverflow="visible"
              label={{
                value: "+" + jump.delta.toFixed(0) + "%",
                position: "top",
                fill: "#a6a6ac",
                fontSize: 13,
                offset: 8,
              }}
            />
          ))}
          {inView(now) && (
            <ReferenceDot
              x={now}
              y={current}
              r={4.5}
              fill={color}
              stroke="#0f0f10"
              strokeWidth={2}
            />
          )}
          {empty && inView(empty.at) && (
            <ReferenceDot
              x={empty.at}
              y={0}
              r={6}
              fill="#0f0f10"
              stroke="#ffffff"
              strokeWidth={2}
              ifOverflow="visible"
              label={{
                value: "Empty " + when(empty.at, now),
                position: "top",
                fill: "#ededef",
                fontSize: 14,
                offset: 12,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function remainingRows(pool: QuotaPool): Row[] {
  const rows: Row[] = pool.history.map((point) => ({
    at: point.at,
    recorded: point.remaining,
    projected: null,
  }));
  pool.projected.forEach((point, index) => {
    const last = rows[rows.length - 1];
    // The first projected point is "now"; it also closes the recorded line.
    if (index === 0 && last && last.recorded !== null)
      rows.push({
        at: point.at,
        recorded: point.remaining,
        projected: point.remaining,
      });
    else
      rows.push({ at: point.at, recorded: null, projected: point.remaining });
  });
  return rows;
}

/** Rolling consumption over the burn window, in quota points per hour. */
function drainRows(pool: QuotaPool, hours: number, factor: number): Row[] {
  const history = pool.history;
  const used: number[] = [0];
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1].remaining;
    const b = history[i].remaining;
    used.push(used[i - 1] + (a !== null && b !== null && b < a ? a - b : 0));
  }
  const rows: Row[] = [];
  let j = 0;
  history.forEach((point: QuotaPoint, i) => {
    while (history[j].at < point.at - hours * 3600) j++;
    const elapsed = (point.at - history[j].at) / 3600;
    rows.push({
      at: point.at,
      recorded:
        point.remaining === null || elapsed < 0.25
          ? null
          : (used[i] - used[j]) / elapsed,
      projected: null,
    });
  });
  if (pool.burn_per_hour !== null && pool.projected.length) {
    const rate = pool.burn_per_hour * factor;
    const first = pool.projected[0].at;
    const last = pool.projected[pool.projected.length - 1].at;
    rows.push(
      { at: first, recorded: null, projected: rate },
      { at: last, recorded: null, projected: rate },
    );
  }
  return rows;
}

function resets(rows: Row[]) {
  const jumps: { at: number; value: number; delta: number }[] = [];
  for (const key of ["recorded", "projected"] as const) {
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1][key];
      const b = rows[i][key];
      if (a !== null && b !== null && b - a >= 5)
        jumps.push({ at: rows[i].at, value: b, delta: b - a });
    }
  }
  return jumps;
}

function formatValue(value: number) {
  return value >= 100 || Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(1);
}

function niceCeil(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}
