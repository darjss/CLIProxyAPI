import { styles } from "../styles";
import { panel, tokenStatus } from "../../styled-system/recipes";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dateTime, dollars, number, queries, type Period } from "../api";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  PeriodSelect,
} from "../components";

export function UsagePage() {
  const [period, setPeriod] = useState<Period>("week");
  const requests = useQuery(queries.requests(period));
  return (
    <>
      <PageHeader
        title="My usage"
        description="Your latest 100 executions. Metadata only; prompts and responses aren’t stored."
      >
        <PeriodSelect value={period} onChange={setPeriod} />
      </PageHeader>
      {requests.isError ? (
        <ErrorState
          error={requests.error}
          retry={() => void requests.refetch()}
        />
      ) : requests.isPending ? (
        <Loading />
      ) : !requests.data.length ? (
        <div className={panel()}>
          <EmptyState
            title="Nothing to inspect yet."
            description="Completed executions from your tokens will show up here, including reported usage on failed attempts."
          />
        </div>
      ) : (
        <div className={panel({ table: true })}>
          <div className={styles.tableScroll}>
            <table>
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
                    <td className={styles.strong}>
                      {event.token_name}
                      <span className={styles.cellNote}>
                        {dateTime(event.timestamp)}
                      </span>
                    </td>
                    <td>
                      {event.model}
                      <span className={styles.cellNote}>{event.provider}</span>
                    </td>
                    <td>{number.format(event.tokens)}</td>
                    <td className={styles.muted}>
                      {(event.latency_ms / 1000).toFixed(1)}s
                    </td>
                    <td className={styles.muted}>
                      {event.cost_micros === null
                        ? "Unpriced"
                        : dollars(event.cost_micros)}
                    </td>
                    <td>
                      <span
                        className={tokenStatus({
                          state: event.failed ? "failed" : "active",
                        })}
                      >
                        {event.failed ? "Failed" : "Complete"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className={styles.footnote}>
        An execution is an upstream attempt. A retried request can have multiple
        executions; recorded token use is counted once per execution.
      </p>
    </>
  );
}
