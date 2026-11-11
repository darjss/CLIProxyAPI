import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { css, cx } from "../../styled-system/css";
import {
  dollars,
  number,
  periodOptions,
  queries,
  type Metric,
  type Period,
} from "../api";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Segmented,
  card,
  note,
  primaryCell,
  table,
  tableScroll,
} from "../ui";

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<Metric>("tokens");
  const leaders = useQuery(queries.leaders(period, metric));
  const top = leaders.data?.[0];
  const max = top ? (metric === "tokens" ? top.tokens : top.cost_micros) : 0;

  return (
    <>
      <PageHeader
        title="Leaderboard"
        meta="Ranked by named token · personal requests stay private"
      >
        <Segmented
          label="Leaderboard period"
          value={period}
          onChange={setPeriod}
          options={periodOptions}
        />
      </PageHeader>
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
          mb: "20px",
        })}
      >
        <Segmented
          label="Rank by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "tokens", label: "Total tokens" },
            { value: "cost", label: "Est. API cost" },
          ]}
        />
        <span className={css({ color: "dim", fontSize: "15px" })}>
          Top 100 ·{" "}
          {metric === "tokens"
            ? "canonical token totals"
            : "configured token rates"}
        </span>
      </div>
      {metric === "cost" && (
        <p className={css({ color: "dim", fontSize: "14px", mb: "20px" })}>
          API-equivalent estimates, not subscription spending. Missing prices
          are excluded from the cost total; coverage shows what was priced.
        </p>
      )}
      {leaders.isError ? (
        <ErrorState
          error={leaders.error}
          retry={() => void leaders.refetch()}
        />
      ) : leaders.isPending ? (
        <Loading />
      ) : !leaders.data.length ? (
        <div className={card}>
          <EmptyState
            title="An open field."
            description="Named tokens appear here after their first reported execution."
          />
        </div>
      ) : (
        <div className={cx(card, tableScroll)}>
          <table className={table}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Token name</th>
                <th className={css({ width: "32%" })}>
                  {metric === "tokens" ? "Total tokens" : "Est. API cost"}
                </th>
                <th>Input / output</th>
                <th>Cache reads</th>
                <th>
                  {metric === "tokens" ? "Est. API cost" : "Total tokens"}
                </th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {leaders.data.map((leader, index) => {
                const value =
                  metric === "tokens" ? leader.tokens : leader.cost_micros;
                return (
                  <tr key={leader.id}>
                    <td>
                      <span
                        className={css({
                          fontFamily: "mono",
                          fontSize: "14px",
                        })}
                        style={{ color: index < 3 ? "#e8c37a" : "#68686e" }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className={primaryCell}>
                      {leader.name}
                      <span className={note}>
                        {leader.id.slice(-6)} · {number.format(leader.requests)}{" "}
                        executions
                      </span>
                    </td>
                    <td>
                      <div
                        className={css({
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                        })}
                      >
                        <strong
                          className={css({
                            color: "fg",
                            fontWeight: 600,
                            minWidth: "64px",
                          })}
                        >
                          {metric === "tokens"
                            ? number.format(leader.tokens)
                            : leader.priced
                              ? dollars(leader.cost_micros)
                              : "Unpriced"}
                        </strong>
                        <div
                          className={css({
                            flex: 1,
                            minWidth: "80px",
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
                              background: "#b9c3ff",
                            })}
                            style={{
                              width: max ? (value / max) * 100 + "%" : 0,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {number.format(leader.input)} /{" "}
                      {number.format(leader.output)}
                    </td>
                    <td>{number.format(leader.cached)}</td>
                    <td>
                      {metric === "tokens"
                        ? leader.priced
                          ? dollars(leader.cost_micros)
                          : "Unpriced"
                        : number.format(leader.tokens)}
                    </td>
                    <td>
                      {leader.priced}/{leader.requests}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
