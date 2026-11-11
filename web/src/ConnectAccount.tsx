import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { css } from "../styled-system/css";
import { button, field } from "../styled-system/recipes";
import { api } from "./api";
import {
  CodeBlock,
  ErrorState,
  Loading,
  ProviderIcon,
  Segmented,
  caption,
  formError,
  label,
  providerName,
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
    queryFn: ({ signal }) => api<Login>("/admin/logins/" + id, { signal }),
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
      api<Login>("/admin/logins", {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),
    onSuccess: remember,
  });
  const finish = useMutation({
    mutationFn: () =>
      api<Login>(`/admin/logins/${id}/callback`, {
        method: "POST",
        body: JSON.stringify({ redirect_url: redirect }),
      }),
    onSuccess: (login) => {
      setRedirect("");
      remember(login);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api<Login>(`/admin/logins/${id}`, { method: "DELETE" }),
    onSuccess: remember,
  });
  const login = session.data;

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
    <div
      className={css({
        display: "grid",
        gap: "16px",
        minWidth: 0,
        paddingTop: "22px",
        borderTop: "1px solid token(colors.line)",
      })}
    >
      <h3 className={css({ fontSize: "17px", fontWeight: 600 })}>
        Connect an account
      </h3>
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
                  {providerName(value)}
                </>
              ),
            }))}
          />
          <p className={caption}>
            Add a shared {providerName(provider)} account. Sign in on the
            provider's page, then finish here.
          </p>
          <div>
            <button
              className={button({ variant: "primary" })}
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending
                ? "Starting login…"
                : `Connect ${providerName(provider)}`}
            </button>
          </div>
        </>
      )}
      {id && session.isPending && <Loading label="Loading login…" />}
      {session.isError && (
        <>
          <ErrorState
            error={session.error}
            retry={() => void session.refetch()}
          />
          <div>
            <button
              className={button({ variant: "secondary" })}
              onClick={reset}
            >
              Start a new login
            </button>
          </div>
        </>
      )}
      {login && (
        <>
          <div aria-live="polite" role="status">
            {login.status === "starting" && (
              <Loading label="Preparing provider login…" />
            )}
            {login.status === "connecting" && (
              <Loading label="Connecting account…" />
            )}
            {login.status === "waiting" && (
              <p className={caption}>
                {login.provider === "claude"
                  ? "Sign in to Claude, then paste the redirect URL below."
                  : "Enter this device code on OpenAI's page. This page updates after approval."}
              </p>
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
              {login.user_code && (
                <CodeBlock label="Device code" value={login.user_code} />
              )}
              {login.url && (
                <div>
                  <a
                    className={button({ variant: "primary" })}
                    href={login.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {providerName(login.provider)} sign-in{" "}
                    <ExternalLink size={15} aria-hidden="true" />
                  </a>
                </div>
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
                    Full redirect URL
                  </label>
                  <p id="callback-help" className={caption}>
                    After authorizing, the localhost page may fail to load. Copy
                    its full URL from the address bar and paste it here.
                  </p>
                  <input
                    id="account-callback"
                    aria-describedby="callback-help"
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
                Expires at{" "}
                {new Date(login.expires_at * 1000).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . Keep passwords and MFA codes on the provider's page.
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
