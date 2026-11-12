import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Save } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { button, field } from "../../styled-system/recipes";
import { api, type Account, type Price, type Token } from "../api";
import ConnectAccount from "../ConnectAccount";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  ProviderIcon,
  Segmented,
  caption,
  card,
  formError,
  label,
  note,
  primaryCell,
  providerName,
  table,
  tableScroll,
} from "../ui";

export default function AdminPage() {
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: ({ signal }) => api<Account[]>("/admin/accounts", { signal }),
  });
  const prices = useQuery({
    queryKey: ["prices"],
    queryFn: ({ signal }) => api<Price[]>("/admin/prices", { signal }),
  });
  const tokens = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: ({ signal }) => api<Token[]>("/admin/tokens", { signal }),
  });
  const liveTokens = tokens.data?.filter((token) => !token.revoked_at) ?? [];

  return (
    <>
      <PageHeader
        title="Administration"
        meta="Shared accounts, named-token limits, and model prices"
      />
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "20px",
        })}
      >
        <Section title="Upstream accounts" meta="Shared provider accounts">
          {accounts.isError ? (
            <ErrorState error={accounts.error} />
          ) : accounts.isPending ? (
            <Loading />
          ) : !accounts.data.length ? (
            <EmptyState
              title="Connect the pool."
              description="Connect a Claude or Codex account below to share it with the pool."
            />
          ) : (
            <div className={tableScroll}>
              <table className={table}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Provider</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.map((account) => (
                    <tr key={account.id}>
                      <td className={primaryCell}>
                        <code className={css({ fontSize: "13px" })}>
                          {account.id}
                        </code>
                      </td>
                      <td>
                        <span
                          className={css({
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            color: "fg",
                          })}
                        >
                          <ProviderIcon provider={account.provider} size={16} />
                          {providerName(account.provider)}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            color: account.disabled
                              ? "#68686e"
                              : account.status === "active"
                                ? "#4fbf7f"
                                : "#e0b34f",
                          }}
                        >
                          {account.disabled ? "Disabled" : account.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ConnectAccount />
        </Section>

        <Section title="Token limits" meta="0 means unlimited">
          <p className={caption}>
            Limits apply to new requests after recorded daily usage reaches the
            cap. Each token works directly as an API key.
          </p>
          {tokens.isError ? (
            <ErrorState error={tokens.error} />
          ) : tokens.isPending ? (
            <Loading />
          ) : !liveTokens.length ? (
            <p className={caption}>
              Create a token to configure its daily limit.
            </p>
          ) : (
            <div>
              {liveTokens.map((token) => (
                <TokenLimit
                  key={token.id}
                  token={token}
                  onSaved={() => {
                    void client.invalidateQueries({ queryKey: ["tokens"] });
                    void client.invalidateQueries({
                      queryKey: ["admin-tokens"],
                    });
                  }}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="API-equivalent token prices"
          meta="USD / 1 million tokens"
        >
          <p className={caption}>
            Set exact provider and model names. Each save creates a new price
            version; previous usage keeps its original estimate. No prices are
            guessed.
          </p>
          <PriceForm
            onSaved={() =>
              void client.invalidateQueries({ queryKey: ["prices"] })
            }
          />
          {prices.isError ? (
            <ErrorState error={prices.error} />
          ) : prices.isPending ? (
            <Loading />
          ) : prices.data.length > 0 ? (
            <div className={tableScroll}>
              <table className={table}>
                <thead>
                  <tr>
                    <th>Provider / model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Cache read</th>
                    <th>Cache write</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.data.map((price) => (
                    <tr key={price.id}>
                      <td className={primaryCell}>
                        {price.model}
                        <span className={note}>
                          {price.provider} · version {price.id}
                        </span>
                      </td>
                      {[
                        price.input,
                        price.output,
                        price.cache_read,
                        price.cache_write,
                      ].map((value, index) => (
                        <td key={index}>${value.toLocaleString()}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={caption}>
              No model rates configured. Usage remains unpriced until a matching
              rate exists.
            </p>
          )}
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        card,
        css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "18px",
        }),
      )}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "baseline",
          gap: "12px",
          flexWrap: "wrap",
        })}
      >
        <h2 className={css({ fontSize: "19px", fontWeight: 600 })}>{title}</h2>
        <span className={css({ color: "dim", fontSize: "15px" })}>{meta}</span>
      </div>
      {children}
    </section>
  );
}

function TokenLimit({ token, onSaved }: { token: Token; onSaved: () => void }) {
  const [limit, setLimit] = useState(String(token.daily_limit));
  const save = useMutation({
    mutationFn: () =>
      api("/admin/tokens/" + encodeURIComponent(token.id) + "/settings", {
        method: "PUT",
        body: JSON.stringify({ daily_limit: Number(limit) }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className={css({
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 220px auto",
        alignItems: "center",
        gap: "16px",
        padding: "14px 0",
        borderTop: "1px solid token(colors.line)",
        smDown: { gridTemplateColumns: "minmax(0, 1fr) auto" },
      })}
    >
      <div className={css({ minWidth: 0, smDown: { gridColumn: "1 / -1" } })}>
        <strong className={css({ fontWeight: 500 })}>{token.name}</strong>
        <code className={note}>
          {token.owner ? "@" + token.owner + " · " : ""}
          {token.prefix}…
        </code>
      </div>
      <input
        className={field()}
        aria-label={"Daily token cap for " + token.name}
        type="number"
        min="0"
        max={Number.MAX_SAFE_INTEGER}
        step="1"
        value={limit}
        onChange={(event) => setLimit(event.target.value)}
        required
      />
      <button
        className={button()}
        disabled={save.isPending}
        aria-label={"Save settings for " + token.name}
      >
        {save.isSuccess ? <Check size={15} /> : <Save size={15} />}
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {save.isError && (
        <p
          className={cx(formError, css({ gridColumn: "1 / -1" }))}
          role="alert"
        >
          {save.error.message}
        </p>
      )}
    </form>
  );
}

const rateLabels = {
  input: "Uncached input",
  output: "Output",
  cache_read: "Cache read",
  cache_write: "Cache write",
};
type Rate = keyof typeof rateLabels;

function PriceForm({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState<"claude" | "codex">("codex");
  const [model, setModel] = useState("");
  const [rates, setRates] = useState<Record<Rate, string>>({
    input: "",
    output: "",
    cache_read: "",
    cache_write: "",
  });
  const save = useMutation({
    mutationFn: () =>
      api("/admin/prices", {
        method: "POST",
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...Object.fromEntries(
            Object.entries(rates).map(([key, value]) => [key, Number(value)]),
          ),
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className={css({ display: "grid", gap: "14px" })}
    >
      <div
        className={css({
          display: "flex",
          gap: "14px",
          alignItems: "end",
          flexWrap: "wrap",
        })}
      >
        <div className={label}>
          Provider
          <Segmented
            label="Price provider"
            value={provider}
            onChange={setProvider}
            options={[
              { value: "codex", label: "Codex" },
              { value: "claude", label: "Claude" },
            ]}
          />
        </div>
        <label className={cx(label, css({ flex: "1 1 260px" }))}>
          Model ID
          <input
            className={field()}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Exact upstream model ID"
            required
            maxLength={200}
          />
        </label>
      </div>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "14px",
          mdDown: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        })}
      >
        {(Object.keys(rateLabels) as Rate[]).map((key) => (
          <label key={key} className={label}>
            {rateLabels[key]}
            <input
              className={field()}
              type="number"
              value={rates[key]}
              min="0"
              max="1000000"
              step="any"
              required
              placeholder="0.00"
              onChange={(event) =>
                setRates((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "14px",
          flexWrap: "wrap",
        })}
      >
        <button
          className={button({ variant: "primary" })}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save model price"}
        </button>
        <span role="status" className={save.isError ? formError : caption}>
          {save.isError
            ? save.error.message
            : save.isSuccess
              ? "Saved. New executions will use this price version."
              : ""}
        </span>
      </div>
    </form>
  );
}
