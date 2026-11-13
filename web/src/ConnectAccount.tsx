import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { css } from "../styled-system/css";
import { button, field } from "../styled-system/recipes";
import { api } from "./api";
import {
  CodeBlock,
  Loading,
  ProviderIcon,
  Segmented,
  caption,
  formError,
  label,
} from "./ui";

type Provider = "claude" | "codex";
type Login = {
  id: string;
  provider: Provider;
  status:
    | "starting"
    | "waiting"
    | "connecting"
    | "connected"
    | "failed"
    | "expired"
    | "cancelled";
  url?: string;
  user_code?: string;
  error?: string;
  expires_at: number;
};

// Numbered rows; each li holds one div so inline text stays on one line.
const steps = css({
  display: "grid",
  gap: "16px",
  fontSize: "15px",
  counterReset: "step",
  "& > li": {
    counterIncrement: "step",
    display: "grid",
    gridTemplateColumns: "26px minmax(0, 1fr)",
    gap: "10px",
    alignItems: "start",
  },
  "& > li::before": {
    content: "counter(step)",
    display: "grid",
    placeItems: "center",
    width: "24px",
    height: "24px",
    borderRadius: "full",
    fontSize: "13px",
    fontWeight: 700,
    color: "focus",
    background: "rgba(138,164,255,0.16)",
  },
  "& > li > div": { display: "grid", gap: "10px", minWidth: 0 },
});

function SignIn({ url, provider }: { url: string; provider: Provider }) {
  return (
    <div>
      <a
        className={button({ variant: "primary" })}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ProviderIcon provider={provider} size={16} />
        Open {provider === "claude" ? "Claude" : "OpenAI"} sign-in
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  );
}

/**
 * A small drawing of the browser tab Claude leaves you on, so people know
 * which address to copy. It is a picture, not a field: no focus, no selection.
 */
function AddressBar() {
  return (
    <figure
      aria-label="Example: the page that won't load, with its address bar"
      className={css({
        display: "grid",
        gap: "6px",
        maxWidth: "460px",
        userSelect: "none",
        pointerEvents: "none",
      })}
    >
      <figcaption
        className={css({
          fontSize: "12px",
          color: "faint",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        })}
      >
        Example
      </figcaption>
      <div
        aria-hidden="true"
        className={css({
          borderRadius: "10px",
          border: "1px solid token(colors.edge)",
          overflow: "hidden",
          background: "#141416",
        })}
      >
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 10px",
            background: "#1c1c1f",
            borderBottom: "1px solid token(colors.line)",
          })}
        >
          <span className={css({ display: "flex", gap: "5px" })}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={css({
                  width: "8px",
                  height: "8px",
                  borderRadius: "full",
                  background: "#3a3a3f",
                })}
              />
            ))}
          </span>
          <span
            className={css({
              flex: 1,
              minWidth: 0,
              padding: "3px 10px",
              borderRadius: "full",
              background: "#0f0f10",
              fontSize: "12px",
              color: "dim",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            })}
          >
            <span
              className={css({
                color: "fg",
                background: "rgba(138,164,255,0.28)",
                borderRadius: "3px",
                padding: "0 2px",
              })}
            >
              localhost:54545/callback?code=Xy7…&state=…
            </span>
          </span>
        </div>
        <div
          className={css({
            display: "grid",
            gap: "2px",
            padding: "14px 16px 16px",
            fontSize: "13px",
          })}
        >
          <strong className={css({ fontWeight: 600, color: "#c8c8cc" })}>
            This site can't be reached
          </strong>
          <span className={css({ color: "faint" })}>
            localhost refused to connect.
          </span>
        </div>
      </div>
      <span className={css({ fontSize: "13px", color: "dim" })}>
        Copy the highlighted address from the top of the window.
      </span>
    </figure>
  );
}

const pending = (status?: Login["status"]) =>
  status === "starting" || status === "waiting" || status === "connecting";
const storageKey = "pool-account-login";

export default function ConnectAccount() {
  const client = useQueryClient();
  const [provider, setProvider] = useState<Provider>("claude");
  const [id, setId] = useState(() => sessionStorage.getItem(storageKey));
  const [redirect, setRedirect] = useState("");
  const session = useQuery({
    queryKey: ["account-login", id],
    queryFn: ({ signal }) => api<Login>("/logins/" + id, { signal }),
    enabled: !!id,
    retry: false,
    refetchInterval: (query) =>
      pending(query.state.data?.status) ? 1500 : false,
  });
  const remember = (login: Login) => {
    sessionStorage.setItem(storageKey, login.id);
    client.setQueryData(["account-login", login.id], login);
    setId(login.id);
  };
  const start = useMutation({
    mutationFn: () =>
      api<Login>("/logins", {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),
    onSuccess: remember,
  });
  const finish = useMutation({
    mutationFn: () =>
      api<Login>(`/logins/${id}/callback`, {
        method: "POST",
        body: JSON.stringify({ redirect_url: redirect }),
      }),
    onSuccess: (login) => {
      setRedirect("");
      remember(login);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api<Login>(`/logins/${id}`, { method: "DELETE" }),
    onSuccess: remember,
  });
  const login = session.data;

  // Logins live in server memory, so a restart forgets the one this tab
  // remembered. Drop it and show the start form instead of an error.
  useEffect(() => {
    if (session.isError) {
      sessionStorage.removeItem(storageKey);
      setId(null);
    }
  }, [session.isError]);

  useEffect(() => {
    if (login?.status === "connected") {
      void client.invalidateQueries({ queryKey: ["accounts"] });
      void client.invalidateQueries({ queryKey: ["quota"] });
    }
  }, [login?.status, client]);

  function reset() {
    sessionStorage.removeItem(storageKey);
    setId(null);
    setRedirect("");
    start.reset();
    finish.reset();
    cancel.reset();
  }

  return (
    <div className={css({ display: "grid", gap: "16px", minWidth: 0 })}>
      {!id && (
        <>
          <Segmented
            label="Account provider"
            value={provider}
            onChange={setProvider}
            options={(["claude", "codex"] as const).map((value) => ({
              value,
              label: (
                <>
                  <ProviderIcon provider={value} size={16} />
                  {value === "claude" ? "Claude" : "ChatGPT"}
                </>
              ),
            }))}
          />
          <p className={caption}>
            {provider === "claude"
              ? "Use the Claude account you pay for (Pro or Max)."
              : "Use the ChatGPT account you pay for (Plus, Pro, or Team)."}{" "}
            You sign in on {provider === "claude" ? "Claude's" : "OpenAI's"} own
            page, so Pool never sees your password. The login stays on the Pool
            server and the whole team can use the plan.
          </p>
          <div>
            <button
              className={button({ variant: "primary" })}
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              <ProviderIcon provider={provider} size={16} />
              {start.isPending
                ? "Starting login…"
                : `Connect ${provider === "claude" ? "Claude" : "ChatGPT"}`}
            </button>
          </div>
        </>
      )}
      {id && session.isPending && <Loading label="Loading login…" />}
      {login && (
        <>
          <div aria-live="polite" role="status">
            {login.status === "starting" && (
              <Loading label="Preparing provider login…" />
            )}
            {login.status === "connecting" && (
              <Loading label="Connecting account…" />
            )}
            {login.status === "connected" && (
              <p className={css({ color: "ok" })}>
                Account saved. Pool loads it automatically. Quota updates within
                two minutes.
              </p>
            )}
            {login.status === "failed" && (
              <p className={formError}>{login.error}</p>
            )}
            {login.status === "expired" && (
              <p className={caption}>
                This login expired. Start a new connection.
              </p>
            )}
            {login.status === "cancelled" && (
              <p className={caption}>Login cancelled.</p>
            )}
          </div>
          {login.status === "waiting" && (
            <>
              {login.provider === "codex" ? (
                <ol className={steps}>
                  <li>
                    <div>
                      <span>Copy this code.</span>
                      {login.user_code && (
                        <CodeBlock
                          label="Device code"
                          value={login.user_code}
                        />
                      )}
                    </div>
                  </li>
                  <li>
                    <div>
                      <span>
                        Open OpenAI's page, sign in, and paste the code.
                      </span>
                      {login.url && <SignIn url={login.url} provider="codex" />}
                    </div>
                  </li>
                  <li>
                    <div>Approve. This page notices by itself.</div>
                  </li>
                </ol>
              ) : (
                <ol className={steps}>
                  <li>
                    <div>
                      <span>
                        Sign in on Claude's page and click <b>Authorize</b>.
                      </span>
                      {login.url && (
                        <SignIn url={login.url} provider="claude" />
                      )}
                    </div>
                  </li>
                  <li>
                    <div>
                      <span>
                        Claude then sends you to a page that won't load. That's
                        expected. The login code is in that page's address.
                      </span>
                      <AddressBar />
                    </div>
                  </li>
                  <li>
                    <div>
                      Copy that whole address from the address bar and paste it
                      below.
                    </div>
                  </li>
                </ol>
              )}
              {login.provider === "claude" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    finish.mutate();
                  }}
                  className={css({ display: "grid", gap: "10px" })}
                >
                  <label className={label} htmlFor="account-callback">
                    Address from the page that didn't load
                  </label>
                  <input
                    id="account-callback"
                    className={field()}
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    placeholder="http://localhost:54545/callback?code=…&state=…"
                    value={redirect}
                    onChange={(event) => setRedirect(event.target.value)}
                  />
                  <div>
                    <button
                      className={button({ variant: "primary" })}
                      disabled={finish.isPending || !redirect.trim()}
                    >
                      {finish.isPending ? "Connecting…" : "Finish connection"}
                    </button>
                  </div>
                </form>
              )}
              <p className={caption}>
                This login works until{" "}
                {new Date(login.expires_at * 1000).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                .
              </p>
            </>
          )}
          <div>
            {pending(login.status) ? (
              <button
                className={button({ variant: "ghost" })}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel login"}
              </button>
            ) : (
              <button
                className={button({ variant: "secondary" })}
                onClick={reset}
              >
                Connect another account
              </button>
            )}
          </div>
        </>
      )}
      {[start.error, finish.error, cancel.error].map(
        (error, index) =>
          error && (
            <p key={index} role="alert" className={formError}>
              {error.message}
            </p>
          ),
      )}
    </div>
  );
}
