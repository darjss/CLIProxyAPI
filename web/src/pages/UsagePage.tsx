import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { css, cx } from "../../styled-system/css";
import {
  dateTime,
  dollars,
  number,
  periodOptions,
  queries,
  type Metric,
  type Period,
} from "../api";
import { UsageView, clients } from "../UsageView";
import {
  Chip,
  ErrorState,
  Loading,
  PageHeader,
  ProviderIcon,
  Segmented,
  card,
  note,
  palette,
  primaryCell,
  table,
  tableScroll,
  tiers,
} from "../ui";

const metricOptions = [
  { value: "cost" as const, label: "Cost" },
  { value: "tokens" as const, label: "Tokens" },
];

/** Your tier and how much of today's and this week's cap is used. Hidden when uncapped. */
function PlanBar() {
  const me = useQuery(queries.me());
  const limit = me.data?.limit;
  if (!limit || (limit.day === undefined && limit.week === undefined))
    return null;
  const tier = tiers.find((t) => t.value === limit.tier);
  const meters = [
    { label: "Today", value: limit.day },
    { label: "This week", value: limit.week },
  ];
  return (
    <section
      className={cx(
        card,
        css({
          display: "flex",
          alignItems: "center",
          gap: "28px",
          flexWrap: "wrap",
          mb: "20px",
          padding: "18px 26px",
        }),
      )}
    >
      {tier && <Chip color={tier.color}>{tier.label} plan</Chip>}
      {meters.map((m) =>
        m.value === undefined ? null : (
          <div
            key={m.label}
            className={css({ display: "grid", gap: "6px", flex: "1 1 200px" })}
          >
            <span
              className={css({
                display: "flex",
                justifyContent: "space-between",
                fontSize: "14px",
              })}
            >
              <span className={css({ color: "dim" })}>{m.label}</span>
              <span className={css({ fontVariantNumeric: "tabular-nums" })}>
                {Math.min(100, Math.round(m.value * 100))}% used
              </span>
            </span>
            <div
              className={css({
                height: "6px",
                borderRadius: "full",
                background: "active",
                overflow: "hidden",
              })}
            >
              <div
                className={css({ height: "100%", borderRadius: "full" })}
                style={{
                  width: Math.min(100, m.value * 100) + "%",
                  background:
                    m.value >= 0.9
                      ? palette.bad
                      : m.value >= 0.7
                        ? palette.warn
                        : palette.ok,
                }}
              />
            </div>
          </div>
        ),
      )}
    </section>
  );
}

export default function UsagePage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [metric, setMetric] = useState<Metric>("cost");
  const requests = useQuery(queries.requests(period));

  return (
    <>
      <PageHeader title="Usage">
        <Segmented
          label="Show"
          value={metric}
          onChange={setMetric}
          options={metricOptions}
        />
        <Segmented
          label="Usage period"
          value={period}
          onChange={setPeriod}
          options={periodOptions}
        />
      </PageHeader>
      <PlanBar />
      <section className={card}>
        <UsageView period={period} metric={metric} />
      </section>

      <section className={cx(card, css({ marginTop: "20px" }))}>
        <h2 className={css({ fontSize: "18px", fontWeight: 600, mb: "16px" })}>
          Recent requests
        </h2>
        {requests.isError ? (
          <ErrorState
            error={requests.error}
            retry={() => void requests.refetch()}
          />
        ) : requests.isPending ? (
          <Loading />
        ) : !requests.data.length ? (
          <p className={css({ color: "dim", fontSize: "14px" })}>
            None in this period.
          </p>
        ) : (
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Tool</th>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Latency</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {requests.data.slice(0, 25).map((event) => (
                  <tr key={event.id}>
                    <td className={primaryCell}>
                      {event.token_name}
                      <span className={note}>{dateTime(event.timestamp)}</span>
                    </td>
                    <td>{(clients[event.client] ?? clients.other).label}</td>
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
                      {event.failed ? (
                        <span className={css({ color: "bad" })}>Failed</span>
                      ) : event.cost_micros === null ? (
                        "—"
                      ) : (
                        dollars(event.cost_micros)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
