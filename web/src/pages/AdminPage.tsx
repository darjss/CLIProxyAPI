import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Save } from "lucide-react";
import { api, type Account, type Price, type Token } from "../api";
import { EmptyState, ErrorState, Loading, PageHeader } from "../components";

export function AdminPage() {
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
  return (
    <>
      <PageHeader
        title="Administration"
        description="Shared accounts, named-token limits, and model prices."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Upstream accounts</h2>
          <span className="subtle-badge">Read only</span>
        </div>
        {accounts.isError ? (
          <ErrorState error={accounts.error} />
        ) : accounts.isPending ? (
          <Loading />
        ) : !accounts.data.length ? (
          <EmptyState
            title="Connect the pool."
            description="Use the existing CLI OAuth login commands to add Claude and Codex accounts. They will appear here after the runtime loads them."
          />
        ) : (
          <div className="account-list">
            {accounts.data.map((account) => (
              <div className="account-row" key={account.id}>
                <span className={"provider-symbol " + account.provider}>
                  {account.provider === "claude" ? "✳" : "◈"}
                </span>
                <div>
                  <strong>{account.provider}</strong>
                  <code>{account.id}</code>
                </div>
                <span className="subtle-badge">
                  {account.disabled ? "Disabled" : account.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="footnote">
          OAuth controls inside Pool are a later increment. No account secrets
          are exposed here.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Token settings</h2>
          <span className="muted small">0 means unlimited</span>
        </div>
        <p className="muted small section-description">
          Bind an existing Cloudflare Access client ID for machine connections.
          Saving a binding does not create Cloudflare credentials. Limits apply
          to new requests after recorded daily usage reaches the cap.
        </p>
        {tokens.isError ? (
          <ErrorState error={tokens.error} />
        ) : tokens.isPending ? (
          <Loading />
        ) : !tokens.data.length ? (
          <p className="muted small">
            Create a token to configure its connection and limit.
          </p>
        ) : (
          <div className="token-settings-list">
            {tokens.data
              .filter((token) => !token.revoked_at)
              .map((token) => (
                <TokenSettings
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
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>API-equivalent token prices</h2>
          <span className="muted small">USD / 1 million tokens</span>
        </div>
        <p className="muted small section-description">
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
          <div className="table-scroll">
            <table>
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
                    <td className="strong">
                      {price.model}
                      <span className="cell-note">
                        {price.provider} · version {price.id}
                      </span>
                    </td>
                    {[
                      price.input,
                      price.output,
                      price.cache_read,
                      price.cache_write,
                    ].map((value, i) => (
                      <td key={i} className="muted">
                        ${value.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">
            No model rates configured. Usage remains unpriced until a matching
            rate exists.
          </p>
        )}
      </section>
    </>
  );
}

function TokenSettings({
  token,
  onSaved,
}: {
  token: Token;
  onSaved: () => void;
}) {
  const [serviceID, setServiceID] = useState(token.service_id);
  const [limit, setLimit] = useState(String(token.daily_limit));
  const save = useMutation({
    mutationFn: () =>
      api("/admin/tokens/" + encodeURIComponent(token.id) + "/settings", {
        method: "PUT",
        body: JSON.stringify({
          service_id: serviceID.trim(),
          daily_limit: Number(limit),
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="token-settings"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="setting-name">
        <strong>{token.name}</strong>
        <code>{token.prefix}…</code>
      </div>
      <label className="field">
        Access client ID
        <input
          value={serviceID}
          onChange={(e) => setServiceID(e.target.value)}
          placeholder="Client ID from Cloudflare"
          maxLength={256}
        />
      </label>
      <label className="field limit-field">
        Daily token cap
        <input
          type="number"
          min="0"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          required
        />
      </label>
      <button
        className="button"
        disabled={save.isPending}
        aria-label={"Save settings for " + token.name}
      >
        {save.isSuccess ? <Check size={14} /> : <Save size={14} />}
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {save.isError && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function PriceForm({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState("codex");
  const [model, setModel] = useState("");
  const [rates, setRates] = useState({
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
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }
  return (
    <form className="price-form" onSubmit={submit}>
      <div className="price-identity">
        <label className="field">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label className="field">
          Model ID
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Exact upstream model ID"
            required
            maxLength={200}
          />
        </label>
      </div>
      <div className="price-rates">
        {(
          Object.entries({
            input: "Uncached input",
            output: "Output",
            cache_read: "Cache read",
            cache_write: "Cache write",
          }) as [keyof typeof rates, string][]
        ).map(([key, label]) => (
          <label key={key} className="field">
            {label}
            <input
              type="number"
              value={rates[key]}
              min="0"
              max="1000000"
              step="any"
              required
              onChange={(e) =>
                setRates((previous) => ({ ...previous, [key]: e.target.value }))
              }
              placeholder="0.00"
            />
          </label>
        ))}
      </div>
      <div className="inline-actions">
        <button className="button" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save model price"}
        </button>
        <span
          role="status"
          className={save.isError ? "form-error" : "small muted"}
        >
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
