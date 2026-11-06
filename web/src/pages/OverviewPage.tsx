import { styles } from "../styles";
import { QuotaSection } from "../QuotaSection";
import { cx } from "../../styled-system/css";
import { button, panel } from "../../styled-system/recipes";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Plus } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dollars, number, queries, type Period } from "../api";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  PeriodSelect,
  Stat,
} from "../components";

export function OverviewPage({
  onCreate,
  admin,
}: {
  onCreate: () => void;
  admin: boolean;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const overview = useQuery(queries.overview(period));
  const activity = useQuery(queries.activity(period));
  return (
    <>
      <PageHeader
        title="Overview"
        description="One view of your shared pool and your own usage."
      >
        <PeriodSelect value={period} onChange={setPeriod} />
        <button className={button({ variant: "primary" })} onClick={onCreate}>
          <Plus size={15} />
          Create token
        </button>
      </PageHeader>
      {overview.isError ? (
        <ErrorState
          error={overview.error}
          retry={() => void overview.refetch()}
        />
      ) : overview.isPending ? (
        <Loading />
      ) : (
        <>
          <section className={styles.statGrid} aria-label="Your usage summary">
            <Stat
              label="Total tokens"
              value={number.format(overview.data.usage.tokens)}
              detail="Your tokens, all models"
            />
            <Stat
              label="Requests"
              value={number.format(overview.data.usage.requests)}
              detail={overview.data.usage.failures + " failed executions"}
            />
            <Stat
              label="Cache reads"
              value={number.format(overview.data.usage.cached)}
              detail="Already included in input tokens"
            />
            <Stat
              label="Est. API cost"
              value={
                overview.data.usage.priced
                  ? dollars(overview.data.usage.cost_micros)
                  : "—"
              }
              detail={
                overview.data.usage.priced +
                " of " +
                overview.data.usage.requests +
                " executions priced"
              }
            />
          </section>
          <QuotaSection admin={admin} />
        </>
      )}
      <section className={cx(panel(), styles.activityPanel)}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Your activity</h2>
            <p className={cx(styles.muted, styles.small)}>
              Reported tokens by day · UTC
            </p>
          </div>
          <ArrowUpRight size={17} className={styles.muted} />
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
            className={styles.usageChart}
            role="img"
            aria-label="Your daily token usage"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={activity.data}
                margin={{ top: 16, right: 18, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  stroke="#242428"
                  strokeDasharray="3 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#92929c", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(5)}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fill: "#92929c", fontSize: 11 }}
                  tickFormatter={(value) => number.format(Number(value))}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    background: "#19191d",
                    border: "1px solid #34343b",
                    borderRadius: 8,
                    color: "#f0f0f2",
                  }}
                  formatter={(value) => [
                    number.format(Number(value)),
                    "Tokens",
                  ]}
                />
                <Line
                  type="linear"
                  dataKey="tokens"
                  stroke="#b3b6dc"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#b3b6dc", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </>
  );
}
