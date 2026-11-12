import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { css, cx } from "../../styled-system/css";
import { api, type Member, type Tier } from "../api";
import {
  ErrorState,
  Loading,
  PageHeader,
  Person,
  Segmented,
  card,
  formError,
  note,
  tiers,
  primaryCell,
  table,
  tableScroll,
} from "../ui";

export default function AdminPage() {
  const members = useQuery({
    queryKey: ["members"],
    queryFn: ({ signal }) => api<Member[]>("/admin/members", { signal }),
  });

  return (
    <>
      <PageHeader title="Administration" />
      <section className={cx(card, tableScroll)}>
        <h2 className={css({ fontSize: "18px", fontWeight: 600, mb: "4px" })}>
          People
        </h2>
        <p className={css({ color: "dim", fontSize: "14px", mb: "16px" })}>
          New people start on Standard. A tier caps API cost per day and per
          week across all of a person's tokens.
        </p>
        {members.isError ? (
          <ErrorState
            error={members.error}
            retry={() => void members.refetch()}
          />
        ) : members.isPending ? (
          <Loading />
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function MemberRow({ member }: { member: Member }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (tier: Tier) =>
      api(`/admin/members/${encodeURIComponent(member.id)}/tier`, {
        method: "PUT",
        body: JSON.stringify({ tier }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["members"] }),
  });
  const current = save.isPending ? save.variables : member.tier;
  const color = tiers.find((t) => t.value === current)?.color;
  return (
    <tr>
      <td className={primaryCell}>
        <Person person={member} />
        <span className={note}>
          {member.tokens} active {member.tokens === 1 ? "token" : "tokens"}
        </span>
      </td>
      <td>
        <div
          className={css({
            "& [aria-checked=true]": { color: "var(--tier) !important" },
          })}
          style={{ "--tier": color } as CSSProperties}
        >
          <Segmented
            label={"Tier for " + (member.login || member.name)}
            value={current}
            onChange={(tier) => save.mutate(tier)}
            options={tiers}
          />
        </div>
        {save.isError && (
          <p role="alert" className={formError}>
            {save.error.message}
          </p>
        )}
      </td>
    </tr>
  );
}
