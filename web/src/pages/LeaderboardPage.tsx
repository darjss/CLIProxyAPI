import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import {
  number,
  periodOptions,
  queries,
  type Leader,
  type Metric,
  type Period,
} from "../api";
import { UsageView, amount, clients } from "../UsageView";
import { metricOptions } from "./UsagePage";
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
  const [period, setPeriod] = useState<Period>("7d");
  const [metric, setMetric] = useState<Metric>("cost");
  const [open, setOpen] = useState<string | null>(null);
  const leaders = useQuery(queries.leaders(period, metric));
  const value = (l: Leader) => (metric === "cost" ? l.cost_micros : l.tokens);
  const max = leaders.data?.[0] ? value(leaders.data[0]) : 0;

  return (
    <>
      <PageHeader title="Leaderboard">
        <Segmented
          label="Rank by"
          value={metric}
          onChange={setMetric}
          options={metricOptions}
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
                <th className={css({ width: "30%" })}>
                  {metric === "cost" ? "Est. cost" : "Tokens"}
                </th>
                <th>Tools</th>
                <th>Cache hit</th>
                <th>{metric === "cost" ? "Tokens" : "Est. cost"}</th>
              </tr>
            </thead>
            <tbody>
              {leaders.data.map((leader, index) => {
                const expanded = open === leader.id;
                return (
                  <Fragment key={leader.id}>
                    <tr
                      onClick={() => setOpen(expanded ? null : leader.id)}
                      aria-expanded={expanded}
                      className={css({
                        cursor: "pointer",
                        _hover: { "& td": { background: "raised" } },
                      })}
                    >
                      <td
                        className={css({
                          fontFamily: "mono",
                          color: index < 3 ? "warn" : "faint",
                        })}
                      >
                        {index + 1}
                      </td>
                      <td className={primaryCell}>
                        <span
                          className={css({
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          })}
                        >
                          {expanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <Person person={leader} />
                        </span>
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
                              fontWeight: 600,
                              minWidth: "72px",
                              fontVariantNumeric: "tabular-nums",
                            })}
                          >
                            {amount(metric, value(leader))}
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
                                width: max
                                  ? (value(leader) / max) * 100 + "%"
                                  : 0,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div
                          title={leader.clients
                            .map(
                              (c) =>
                                `${(clients[c.client] ?? clients.other).label} ${number.format(c.tokens)}`,
                            )
                            .join(" · ")}
                          className={css({
                            display: "flex",
                            gap: "2px",
                            width: "96px",
                            height: "6px",
                          })}
                        >
                          {leader.clients.map((c) => (
                            <span
                              key={c.client}
                              className={css({ borderRadius: "full" })}
                              style={{
                                flex: c.tokens || 1,
                                background: (clients[c.client] ?? clients.other)
                                  .color,
                              }}
                            />
                          ))}
                        </div>
                      </td>
                      <td>
                        {leader.input
                          ? percent.format(leader.cached / leader.input)
                          : "—"}
                      </td>
                      <td>
                        {amount(
                          metric === "cost" ? "tokens" : "cost",
                          metric === "cost"
                            ? leader.tokens
                            : leader.cost_micros,
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td
                          colSpan={6}
                          className={css({
                            padding: "24px 8px 32px !important",
                          })}
                        >
                          <UsageView
                            period={period}
                            metric={metric}
                            owner={leader.id}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
