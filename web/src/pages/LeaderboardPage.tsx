import { styles } from "../styles";
import { cx } from "../../styled-system/css";
import { panel, rank } from "../../styled-system/recipes";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dollars, number, queries, type Metric, type Period } from "../api";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  PeriodSelect,
} from "../components";

export function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<Metric>("tokens");
  const leaders = useQuery(queries.leaders(period, metric));
  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="The shared pool, ranked by named token. Personal requests stay private."
      >
        <PeriodSelect value={period} onChange={setPeriod} />
      </PageHeader>
      <div className={styles.rankingToolbar}>
        <div className={styles.segmented} aria-label="Rank by">
          <button
            aria-pressed={metric === "tokens"}
            onClick={() => setMetric("tokens")}
          >
            Total tokens
          </button>
          <button
            aria-pressed={metric === "cost"}
            onClick={() => setMetric("cost")}
          >
            Est. API cost
          </button>
        </div>
        <span className={cx(styles.muted, styles.small)}>
          Top 100 ·{" "}
          {metric === "tokens"
            ? "canonical token totals"
            : "configured token rates"}
        </span>
      </div>
      {metric === "cost" && (
        <div className={styles.notice}>
          <p>
            API-equivalent estimates, not subscription spending. Missing prices
            are excluded from the cost total; coverage shows what was priced.
          </p>
        </div>
      )}
      {leaders.isError ? (
        <ErrorState
          error={leaders.error}
          retry={() => void leaders.refetch()}
        />
      ) : leaders.isPending ? (
        <Loading />
      ) : !leaders.data.length ? (
        <div className={panel()}>
          <EmptyState
            title="An open field."
            description="Named tokens appear here after their first reported execution."
          />
        </div>
      ) : (
        <div className={panel({ table: true })}>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Token name</th>
                  <th>Total tokens</th>
                  <th>Input / output</th>
                  <th>Cache reads</th>
                  <th>Est. API cost</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {leaders.data.map((leader, index) => (
                  <tr key={leader.id}>
                    <td>
                      <span
                        className={index < 3 ? rank({ top: true }) : rank()}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className={styles.strong}>
                      {leader.name}
                      <span className={styles.cellNote}>
                        {leader.id.slice(-6)} · {number.format(leader.requests)}{" "}
                        executions
                      </span>
                    </td>
                    <td
                      className={
                        metric === "tokens" ? styles.strong : undefined
                      }
                    >
                      {number.format(leader.tokens)}
                    </td>
                    <td className={styles.muted}>
                      {number.format(leader.input)} /{" "}
                      {number.format(leader.output)}
                    </td>
                    <td className={styles.muted}>
                      {number.format(leader.cached)}
                    </td>
                    <td
                      className={metric === "cost" ? styles.strong : undefined}
                    >
                      {leader.priced ? dollars(leader.cost_micros) : "Unpriced"}
                    </td>
                    <td>
                      <span className={styles.muted}>
                        {leader.priced}/{leader.requests}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
