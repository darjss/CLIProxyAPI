import { useState, type ReactNode } from "react";
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
import { css, cx } from "../../styled-system/css";
import {
  dateTime,
  dollars,
  number,
  periodOptions,
  queries,
  type Period,
} from "../api";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  ProviderIcon,
  Segmented,
  card,
  note,
  primaryCell,
  table,
  tableScroll,
} from "../ui";

const axis = { fontSize: 13, fill: "#8a8a90" };

export default function UsagePage() {
  const [period, setPeriod] = useState<Period>("week");
  const overview = useQuery(queries.overview(period));
  const activity = useQuery(queries.activity(period));
  const requests = useQuery(queries.requests(period));
  const usage = overview.data?.usage;

  return (
    <>
      <PageHeader title="My Usage" meta="Private to you · metadata only">
        <Segmented
          label="Usage period"
          value={period}
          onChange={setPeriod}
          options={periodOptions}
        />
      </PageHeader>

      {overview.isError ? (
        <ErrorState
          error={overview.error}
          retry={() => void overview.refetch()}
        />
      ) : (
        <section
          aria-label="Your usage summary"
          className={cx(
            card,
            css({
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "24px",
              mdDown: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
            }),
          )}
        >
          <Figure label="Total tokens" detail="Your tokens, all models">
            {usage ? number.format(usage.tokens) : "—"}
          </Figure>
          <Figure
            label="Requests"
            detail={usage ? usage.failures + " failed executions" : ""}
          >
            {usage ? number.format(usage.requests) : "—"}
          </Figure>
          <Figure label="Cache reads" detail="Already included in input tokens">
            {usage ? number.format(usage.cached) : "—"}
          </Figure>
          <Figure
            label="Est. API cost"
            detail={
              usage
                ? `${usage.priced} of ${usage.requests} executions priced`
                : ""
            }
          >
            {usage?.priced ? dollars(usage.cost_micros) : "—"}
          </Figure>
        </section>
      )}

      <section className={cx(card, css({ marginTop: "20px" }))}>
        <div
          className={css({
            display: "flex",
            alignItems: "baseline",
            gap: "12px",
            mb: "18px",
          })}
        >
          <h2 className={css({ fontSize: "19px", fontWeight: 600 })}>
            Activity
          </h2>
          <span className={css({ color: "dim", fontSize: "15px" })}>
            Reported tokens by day · UTC
          </span>
        </div>
        {activity.isError ? (
          <ErrorState
            error={activity.error}
            retry={() => void activity.refetch()}
          />
        ) : activity.isPending ? (
          <Loading />
        ) : !activity.data.length ? (
          <EmptyState
            title="Your first request starts the story."
            description="Create a token, connect a client, and usage will be saved here."
          />
        ) : (
          <div
            role="img"
            aria-label="Your daily token usage"
            className={css({ height: "280px", marginInline: "-6px" })}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={activity.data}
                margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id="activity-fill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#b9c3ff" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#b9c3ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1c1c1f" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={axis}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={12}
                  tickFormatter={(value) => String(value).slice(5)}
                  minTickGap={32}
                />
                <YAxis
                  tick={axis}
                  tickFormatter={(value) => number.format(Number(value))}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip
                  cursor={{ stroke: "#4a4a50" }}
                  contentStyle={{
                    background: "#1b1b1e",
                    border: "1px solid #2c2c30",
                    borderRadius: 8,
                    fontSize: 14,
                  }}
                  formatter={(value) => [
                    number.format(Number(value)),
                    "Tokens",
                  ]}
                />
                <Area
                  type="linear"
                  dataKey="tokens"
                  stroke="#b9c3ff"
                  strokeWidth={2}
                  fill="url(#activity-fill)"
                  dot={
                    activity.data.length < 3
                      ? { r: 3, fill: "#b9c3ff", strokeWidth: 0 }
                      : false
                  }
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className={cx(card, css({ marginTop: "20px" }))}>
        <div
          className={css({
            display: "flex",
            alignItems: "baseline",
            gap: "12px",
            mb: "18px",
          })}
        >
          <h2 className={css({ fontSize: "19px", fontWeight: 600 })}>
            Executions
          </h2>
          <span className={css({ color: "dim", fontSize: "15px" })}>
            Latest 100 · prompts and responses aren’t stored
          </span>
        </div>
        {requests.isError ? (
          <ErrorState
            error={requests.error}
            retry={() => void requests.refetch()}
          />
        ) : requests.isPending ? (
          <Loading />
        ) : !requests.data.length ? (
          <EmptyState
            title="Nothing to inspect yet."
            description="Completed executions from your tokens will show up here, including reported usage on failed attempts."
          />
        ) : (
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th>Token / time</th>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Latency</th>
                  <th>Est. API cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.data.map((event) => (
                  <tr key={event.id}>
                    <td className={primaryCell}>
                      {event.token_name}
                      <span className={note}>{dateTime(event.timestamp)}</span>
                    </td>
                    <td>
                      <span
                        className={css({
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          color: "fg",
                        })}
                      >
                        <ProviderIcon provider={event.provider} size={15} />
                        {event.model}
                      </span>
                    </td>
                    <td className={css({ color: "fg" })}>
                      {number.format(event.tokens)}
                    </td>
                    <td>{(event.latency_ms / 1000).toFixed(1)}s</td>
                    <td>
                      {event.cost_micros === null
                        ? "Unpriced"
                        : dollars(event.cost_micros)}
                    </td>
                    <td>
                      <span
                        style={{ color: event.failed ? "#ef6b63" : "#4fbf7f" }}
                      >
                        {event.failed ? "Failed" : "Complete"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={css({ color: "faint", fontSize: "13px", mt: "18px" })}>
          An execution is an upstream attempt. A retried request can have
          multiple executions; recorded token use is counted once per execution.
        </p>
      </section>
    </>
  );
}

function Figure({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className={css({ display: "grid", gap: "4px", minWidth: 0 })}>
      <span className={css({ color: "dim", fontSize: "15px" })}>{label}</span>
      <strong
        className={css({
          fontSize: "40px",
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          fontVariantNumeric: "tabular-nums",
          smDown: { fontSize: "30px" },
        })}
      >
        {children}
      </strong>
      <span className={css({ color: "faint", fontSize: "14px" })}>
        {detail}
      </span>
    </div>
  );
}
