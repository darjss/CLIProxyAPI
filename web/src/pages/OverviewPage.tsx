import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, Plus } from "lucide-react";
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

export function OverviewPage({ onCreate }: { onCreate: () => void }) {
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
        <button className="button primary" onClick={onCreate}>
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
          <section className="stat-grid" aria-label="Your usage summary">
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
          <div className="section-heading">
            <h2>Shared quota</h2>
            <span className="muted small">Admin-maintained accounts</span>
          </div>
          <div className="provider-grid">
            {(["claude", "codex"] as const).map((provider) => (
              <section
                key={provider}
                className={"panel provider-panel " + provider}
              >
                <div className="panel-heading">
                  <div className="provider-name">
                    <span className="provider-symbol" aria-hidden="true">
                      {provider === "claude" ? "✳" : "◈"}
                    </span>
                    <h3>{provider === "claude" ? "Claude" : "Codex"}</h3>
                    <span className="count-badge">
                      {overview.data.accounts[provider] ?? 0} accounts
                    </span>
                  </div>
                  <span className="subtle-badge">Awaiting quota collector</span>
                </div>
                <div className="quota-unknown">
                  —<span>remaining capacity</span>
                </div>
                <div className="quota-pending">
                  <Clock3 size={16} />
                  <p>
                    Quota history and forecasts will appear when collection is
                    connected. No balance has been inferred from token usage.
                  </p>
                </div>
                <div className="provider-foot">
                  <span>History</span>
                  <span>Burn rate</span>
                  <span>Next reset</span>
                  <span>Not collected yet</span>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      <section className="panel activity-panel">
        <div className="panel-heading">
          <div>
            <h2>Your activity</h2>
            <p className="muted small">Reported tokens by day · UTC</p>
          </div>
          <ArrowUpRight size={17} className="muted" />
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
            className="usage-chart"
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
