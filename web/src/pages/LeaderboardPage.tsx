import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { css, cx } from "../../styled-system/css";
import {
  dollars,
  number,
  periodOptions,
  queries,
  type Leader,
  type Period,
} from "../api";
import { UsageView } from "../UsageView";
import {
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  Person,
  Segmented,
  card,
} from "../ui";

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});
// Gold, silver, bronze.
const medals = ["#f2c14e", "#c9d1dc", "#d08a5a"];
const cacheHit = (l: Leader) => (l.input ? l.cached / l.input : 0);

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [open, setOpen] = useState<Leader | null>(null);
  const leaders = useQuery(queries.leaders(period, "cost"));

  return (
    <>
      <PageHeader title="Leaderboard">
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
            title="Nobody on the board yet."
            description="People show up here after their first request."
          />
        </div>
      ) : (
        <Board leaders={leaders.data} onOpen={setOpen} />
      )}
      {open && (
        <Modal
          wide
          title={<Person person={open} size={28} />}
          onClose={() => setOpen(null)}
        >
          <UsageView period={period} metric="cost" owner={open.id} />
        </Modal>
      )}
    </>
  );
}

function Board({
  leaders,
  onOpen,
}: {
  leaders: Leader[];
  onOpen: (l: Leader) => void;
}) {
  const pool = leaders.reduce((sum, l) => sum + l.cost_micros, 0);
  const share = (l: Leader) => (pool ? l.cost_micros / pool : 0);

  return (
    <div className={css({ display: "grid", gap: "20px" })}>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          alignItems: "end",
          gap: "16px",
          mdDown: { gridTemplateColumns: "minmax(0, 1fr)" },
        })}
      >
        {[1, 0, 2].map((rank) => {
          const l = leaders[rank];
          if (!l)
            return (
              <div
                key={rank}
                className={css({ mdDown: { display: "none" } })}
              />
            );
          return (
            <button
              key={l.id}
              onClick={() => onOpen(l)}
              className={cx(
                card,
                css({
                  display: "grid",
                  justifyItems: "center",
                  gap: "10px",
                  textAlign: "center",
                  cursor: "pointer",
                  borderTop: "3px solid var(--medal)",
                  transition: "transform 0.15s, background 0.15s",
                  _hover: {
                    background: "raised",
                    transform: "translateY(-2px)",
                  },
                  mdDown: { order: rank },
                }),
              )}
              style={
                {
                  "--medal": medals[rank],
                  paddingBlock: rank === 0 ? "36px" : "24px",
                  background: `linear-gradient(180deg, color-mix(in srgb, ${medals[rank]} 10%, transparent), transparent 70%)`,
                } as CSSProperties
              }
            >
              <span
                className={css({
                  display: "grid",
                  placeItems: "center",
                  width: "30px",
                  height: "30px",
                  borderRadius: "full",
                  fontWeight: 700,
                  color: "canvas",
                })}
                style={{ background: medals[rank] }}
              >
                {rank + 1}
              </span>
              <span className={css({ fontSize: "17px", fontWeight: 600 })}>
                <Person person={l} size={rank === 0 ? 44 : 36} />
              </span>
              <strong
                className={css({
                  fontSize: rank === 0 ? "38px" : "30px",
                  fontWeight: 650,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                })}
              >
                {dollars(l.cost_micros)}
              </strong>
              <span className={css({ color: "dim", fontSize: "14px" })}>
                {percent.format(share(l))} of the pool ·{" "}
                {number.format(l.tokens)} tokens
              </span>
            </button>
          );
        })}
      </div>

      {leaders.length > 3 && (
        <div className={cx(card, css({ padding: "8px 12px" }))}>
          {leaders.slice(3).map((l, i) => (
            <button
              key={l.id}
              onClick={() => onOpen(l)}
              className={css({
                display: "grid",
                gridTemplateColumns: "32px minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: "16px",
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                textAlign: "left",
                cursor: "pointer",
                _hover: { background: "raised" },
              })}
            >
              <span className={css({ fontFamily: "mono", color: "faint" })}>
                {i + 4}
              </span>
              <Person person={l} />
              <span
                className={css({
                  color: "dim",
                  fontSize: "14px",
                  smDown: { display: "none" },
                })}
              >
                {number.format(l.tokens)} tokens · {percent.format(cacheHit(l))}{" "}
                cache
              </span>
              <strong className={css({ fontVariantNumeric: "tabular-nums" })}>
                {dollars(l.cost_micros)}
              </strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
