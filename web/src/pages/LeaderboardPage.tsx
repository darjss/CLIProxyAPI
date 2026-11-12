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
  Person,
  Segmented,
  card,
  note,
  primaryCell,
  table,
  tableScroll,
} from "../ui";

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<Metric>("tokens");
  const leaders = useQuery(queries.leaders(period, metric));
  const top = leaders.data?.[0];
  const max = top ? (metric === "tokens" ? top.tokens : top.cost_micros) : 0;

  return (
    <>
      <PageHeader title="Leaderboard">
        <Segmented
          label="Rank by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "tokens", label: "Tokens" },
            { value: "cost", label: "Cost" },
          ]}
        />
        <Segmented
          label="Leaderboard period"
          value={period}
          onChange={setPeriod}
          options={periodOptions}
        />
      </PageHeader>
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
            title="No usage in this period."
            description="People show up here after their first request."
          />
        </div>
      ) : (
        <div className={cx(card, tableScroll)}>
          <table className={table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th className={css({ width: "32%" })}>
                  {metric === "tokens" ? "Tokens" : "Est. cost"}
                </th>
                <th>Input / output</th>
                <th>Cache hit</th>
                <th>{metric === "tokens" ? "Est. cost" : "Tokens"}</th>
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
                      <Person person={leader} />
                      <span className={note}>
                        {number.format(leader.requests)} requests ·{" "}
                        {leader.keys} {leader.keys === 1 ? "token" : "tokens"}
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
                              : "—"}
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
                    <td>
                      {leader.input
                        ? percent.format(leader.cached / leader.input)
                        : "—"}
                    </td>
                    <td>
                      {metric === "tokens"
                        ? leader.priced
                          ? dollars(leader.cost_micros)
                          : "—"
                        : number.format(leader.tokens)}
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
