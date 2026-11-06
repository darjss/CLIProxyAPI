import { styles } from "../styles";
import { cx } from "../../styled-system/css";
import {
  button,
  iconButton,
  panel,
  tokenStatus,
} from "../../styled-system/recipes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, date, number, useTokens, type Token } from "../api";
import { EmptyState, ErrorState, Loading, PageHeader } from "../components";

export function TokensPage({ development }: { development: boolean }) {
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
  return (
    <>
      <PageHeader
        title="API tokens"
        description="A name for every client. A separate key for every connection."
      >
        <button
          className={button({ variant: "primary" })}
          onClick={() => setCreating(true)}
        >
          <Plus size={15} />
          Create token
        </button>
      </PageHeader>
      <div className={styles.notice}>
        <KeyRound size={16} />
        <p>
          {development
            ? "Local tokens work against this loopback server. Production clients will also need Cloudflare Access credentials."
            : "Tokens authenticate the proxy. Cloudflare Access credentials are also required; an admin must bind the machine credential before unattended use."}
        </p>
      </div>
      {tokens.isError ? (
        <ErrorState error={tokens.error} retry={() => void tokens.refetch()} />
      ) : tokens.isPending ? (
        <Loading />
      ) : !tokens.data.length ? (
        <div className={panel()}>
          <EmptyState
            title="Make your first connection."
            description="Name a token after the person, machine, or project using it."
          >
            <button className={button()} onClick={() => setCreating(true)}>
              <Plus size={14} />
              Create token
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className={panel({ table: true })}>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th>Daily limit</th>
                  <th>Created</th>
                  <th>
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokens.data.map((token) => {
                  const status = token.revoked_at
                    ? "Revoked"
                    : token.expires_at && token.expires_at <= now
                      ? "Expired"
                      : "Active";
                  return (
                    <tr key={token.id}>
                      <td className={styles.strong}>
                        <span className={styles.tokenName}>
                          {token.name}
                          <button
                            className={iconButton()}
                            aria-label={"Rename " + token.name}
                            onClick={() => setRenaming(token)}
                          >
                            <Pencil size={12} />
                          </button>
                        </span>
                      </td>
                      <td>
                        <code>{token.prefix}…</code>
                      </td>
                      <td>
                        <span
                          className={tokenStatus({
                            state: status === "Active" ? "active" : "inactive",
                          })}
                        >
                          {status}
                        </span>
                        {!development &&
                          status === "Active" &&
                          !token.service_id && (
                            <span className={styles.cellNote}>
                              Machine setup pending
                            </span>
                          )}
                      </td>
                      <td>
                        {token.daily_limit
                          ? number.format(token.daily_limit)
                          : "Unlimited"}
                      </td>
                      <td className={styles.muted}>{date(token.created_at)}</td>
                      <td>
                        <button
                          className={iconButton({ danger: true })}
                          aria-label={"Revoke " + token.name}
                          disabled={!!token.revoked_at}
                          onClick={() => {
                            revoke.reset();
                            setRevoking(token);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}
      {renaming && (
        <RenameTokenDialog token={renaming} onClose={() => setRenaming(null)} />
      )}
      {revoking && (
        <Modal title="Revoke this token?" onClose={() => setRevoking(null)}>
          <p className={styles.muted}>
            New requests using <strong>{revoking.name}</strong> will stop
            working. Its usage history will remain.
          </p>
          {revoke.isError && (
            <p className={styles.formError} role="alert">
              {revoke.error.message}
            </p>
          )}
          <div className={styles.dialogActions}>
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
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
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
  async function copy() {
    try {
      await navigator.clipboard.writeText(create.data!.secret);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy was unavailable. Select the key and copy it manually.",
      );
    }
  }
  return (
    <Modal
      title={create.isSuccess ? "Your token is ready." : "Create an API token"}
      onClose={onClose}
    >
      {create.isSuccess ? (
        <>
          <p className={styles.muted}>
            Save this key now. It belongs to{" "}
            <strong>{create.data.token.name}</strong> and won’t be shown again.
          </p>
          <div className={styles.secret}>
            <code>{create.data.secret}</code>
            <button
              className={iconButton()}
              onClick={() => void copy()}
              aria-label="Copy token"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <p className={cx(styles.small, styles.muted)} role="status">
            {copyError ||
              (copied ? "Copied to clipboard." : "Store it somewhere private.")}
          </p>
          <div className={styles.dialogActions}>
            <button
              className={button({ variant: "primary" })}
              onClick={onClose}
            >
              I’ve saved my key
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className={styles.field}>
            Token name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              placeholder="Darjs laptop"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            Expires
            <select
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
            <p className={styles.formError} role="alert">
              {create.error.message}
            </p>
          )}
          <div className={styles.dialogActions}>
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
      )}
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
        onSubmit={(e) => {
          e.preventDefault();
          rename.mutate();
        }}
      >
        <label className={styles.field}>
          Token name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className={cx(styles.muted, styles.small)}>
          This changes the leaderboard label. The key and its usage history stay
          the same.
        </p>
        {rename.isError && (
          <p className={styles.formError} role="alert">
            {rename.error.message}
          </p>
        )}
        <div className={styles.dialogActions}>
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

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <div className={styles.dialogHeading}>
        <h2 id="dialog-title">{title}</h2>
        <button
          className={iconButton()}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
