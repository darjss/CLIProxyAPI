import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { button, field, iconButton } from "../../styled-system/recipes";
import { api, date, useTokens, type Token } from "../api";
import {
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  actions,
  caption,
  card,
  formError,
  label,
  palette,
  primaryCell,
  table,
  tableScroll,
  useCopy,
} from "../ui";

function status(token: Token, now: number) {
  if (token.revoked_at) return "Revoked";
  if (token.expires_at && token.expires_at <= now) return "Expired";
  return "Active";
}

export default function TokensPage() {
  const tokens = useTokens();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [renaming, setRenaming] = useState<Token | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api("/tokens/" + encodeURIComponent(id), { method: "DELETE" }),
    onSuccess: async () => {
      setRevoking(null);
      await client.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const active =
    tokens.data?.filter((token) => status(token, now) === "Active").length ?? 0;

  return (
    <>
      <PageHeader
        title="API Tokens"
        meta={tokens.data && `${active} active · ${tokens.data.length} total`}
      >
        <a href="#/setup" className={button()}>
          <Zap size={16} />
          Quick Start
        </a>
        <button
          className={button({ variant: "primary" })}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          Create token
        </button>
      </PageHeader>
      {tokens.isError ? (
        <ErrorState error={tokens.error} retry={() => void tokens.refetch()} />
      ) : tokens.isPending ? (
        <Loading />
      ) : !tokens.data.length ? (
        <div className={card}>
          <EmptyState
            title="No tokens yet."
            description="Create one per machine or tool, like “Laptop · Claude Code”."
          >
            <button
              className={button({ variant: "primary" })}
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Create token
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className={cx(card, tableScroll)}>
          <table className={table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th>
                  <span className={css({ srOnly: true })}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((token) => {
                const state = status(token, now);
                return (
                  <tr key={token.id}>
                    <td className={primaryCell}>{token.name}</td>
                    <td>
                      <code className={css({ fontSize: "13px" })}>
                        {token.prefix}…
                      </code>
                    </td>
                    <td>
                      <Chip
                        color={
                          state === "Active"
                            ? palette.ok
                            : state === "Revoked"
                              ? palette.bad
                              : palette.warn
                        }
                      >
                        {state}
                      </Chip>
                    </td>
                    <td>{date(token.created_at)}</td>
                    <td>
                      {token.expires_at ? date(token.expires_at) : "Never"}
                    </td>
                    <td>
                      <div
                        className={css({
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: "4px",
                        })}
                      >
                        <button
                          className={iconButton()}
                          aria-label={"Rename " + token.name}
                          title="Rename"
                          onClick={() => setRenaming(token)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className={cx(
                            iconButton(),
                            css({ _hover: { color: "bad" } }),
                          )}
                          aria-label={"Revoke " + token.name}
                          title="Revoke"
                          disabled={!!token.revoked_at}
                          onClick={() => {
                            revoke.reset();
                            setRevoking(token);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}
      {renaming && (
        <RenameTokenDialog token={renaming} onClose={() => setRenaming(null)} />
      )}
      {revoking && (
        <Modal title="Revoke this token?" onClose={() => setRevoking(null)}>
          <p className={caption}>
            New requests using{" "}
            <strong className={css({ color: "fg" })}>{revoking.name}</strong>{" "}
            will stop working. Its usage history will remain.
          </p>
          {revoke.isError && (
            <p className={formError} role="alert">
              {revoke.error.message}
            </p>
          )}
          <div className={actions}>
            <button className={button()} onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <button
              className={button({ variant: "danger" })}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(revoking.id)}
            >
              {revoke.isPending ? "Revoking…" : "Revoke token"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CreateTokenDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const { copied, error, copy } = useCopy();
  const create = useMutation({
    mutationFn: () =>
      api<{ token: Token; secret: string }>("/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          expires_at: Number(expiry)
            ? Math.floor(Date.now() / 1000) + Number(expiry) * 86400
            : 0,
        }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
    gcTime: 0,
  });

  if (create.isSuccess) {
    const secret = create.data.secret;
    return (
      <Modal title="Your token is ready." onClose={onClose}>
        <p className={caption}>
          Save this key now. It belongs to{" "}
          <strong className={css({ color: "fg" })}>
            {create.data.token.name}
          </strong>{" "}
          and won’t be shown again.
        </p>
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "8px",
            margin: "16px 0 8px",
            padding: "6px 6px 6px 14px",
            borderRadius: "12px",
            background: "canvas",
            border: "1px solid token(colors.edge)",
          })}
        >
          <code
            className={css({
              flex: 1,
              fontSize: "13px",
              overflowWrap: "anywhere",
              userSelect: "all",
            })}
          >
            {secret}
          </code>
          <button
            className={iconButton()}
            onClick={() => void copy(secret)}
            aria-label="Copy token"
          >
            {copied === secret ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <p className={caption} role="status">
          {error ||
            (copied === secret
              ? "Copied to clipboard."
              : "Store it somewhere private.")}
        </p>
        <div className={actions}>
          <button className={button({ variant: "primary" })} onClick={onClose}>
            I’ve saved my key
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Create an API token" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className={label}>
          Token name
          <input
            className={field()}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            placeholder="Laptop · Claude Code"
            autoComplete="off"
          />
        </label>
        <label className={label}>
          Expires
          <select
            className={field()}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            <option value="0">Never</option>
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
          </select>
        </label>
        {create.isError && (
          <p className={formError} role="alert">
            {create.error.message}
          </p>
        )}
        <div className={actions}>
          <button className={button()} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={button({ variant: "primary" })}
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "Creating…" : "Create token"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameTokenDialog({
  token,
  onClose,
}: {
  token: Token;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(token.name);
  const rename = useMutation({
    mutationFn: () =>
      api("/tokens/" + encodeURIComponent(token.id), {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["tokens"] });
      await client.invalidateQueries({ queryKey: ["leaders"] });
      onClose();
    },
  });
  return (
    <Modal title="Rename token" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate();
        }}
      >
        <label className={label}>
          Token name
          <input
            className={field()}
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className={caption}>
          This changes the leaderboard label. The key and its usage history stay
          the same.
        </p>
        {rename.isError && (
          <p className={formError} role="alert">
            {rename.error.message}
          </p>
        )}
        <div className={actions}>
          <button type="button" className={button()} onClick={onClose}>
            Cancel
          </button>
          <button
            className={button({ variant: "primary" })}
            disabled={rename.isPending || !name.trim()}
          >
            {rename.isPending ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
