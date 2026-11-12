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

export const metricOptions = [
  { value: "cost" as const, label: "Cost" },
  { value: "tokens" as const, label: "Tokens" },
];

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
