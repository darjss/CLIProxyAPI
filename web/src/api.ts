import { useQuery } from "@tanstack/react-query";

export type Period = "24h" | "7d" | "30d" | "90d";
export type Metric = "tokens" | "cost";
export type Person = { login: string; name: string; avatar: string };
export type Tier = "light" | "standard" | "unlimited";
export type Me = {
  identity: Person & { id: string; email: string; admin: boolean };
  development: boolean;
  // Fractions of the tier's daily and weekly cap; absent when uncapped.
  limit?: { tier: Tier; day?: number; week?: number };
};
export type Member = Person & { id: string; tier: Tier; tokens: number };
export type Token = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  expires_at: number;
  revoked_at: number;
  owner: string;
};
export type Aggregate = {
  requests: number;
  tokens: number;
  input: number;
  output: number;
  cached: number;
  failures: number;
  priced: number;
  cost_micros: number;
};
export type ClientUsage = {
  client: string;
  requests: number;
  tokens: number;
  cost_micros: number;
};
export type Usage = {
  requests: number;
  tokens: number;
  uncached: number;
  cache_read: number;
  cache_write: number;
  output: number;
  priced: number;
  cost_micros: number;
  cost: {
    uncached: number;
    cache_read: number;
    cache_write: number;
    output: number;
  };
  savings_micros: number;
  clients: ClientUsage[];
  models: {
    provider: string;
    model: string;
    requests: number;
    tokens: number;
    input: number;
    cached: number;
    cost_micros: number;
  }[];
  days: { date: string; client: string; tokens: number; cost_micros: number }[];
};
export type Leader = Aggregate &
  Person & { id: string; keys: number; clients: ClientUsage[] };
export type UsageEvent = {
  id: string;
  token_name: string;
  provider: string;
  model: string;
  timestamp: number;
  latency_ms: number;
  failed: boolean;
  tokens: number;
  cost_micros: number | null;
  client: string;
};
export type QuotaPoint = { at: number; remaining: number | null };
export type QuotaSample = {
  account: string;
  provider: string;
  window: string;
  period_seconds: number;
  remaining: number;
  reset_at: number;
  observed_at: number;
};
export type QuotaAccount = {
  id: string;
  provider: string;
  status: string;
  checked_at: number;
  windows: QuotaSample[];
  email: string;
  disabled: boolean;
  auth_status: string;
  message: string;
  cooldown_until: number;
  // Provider-granted usage resets (Claude reset grants, Codex reset credits).
  free_reset?: {
    left: number;
    usable: boolean;
    expires?: number;
    note?: string;
  };
  day: { requests: number; cost_micros: number; last_used: number };
};
export type QuotaPool = {
  id: string;
  provider: string;
  window: string;
  period_seconds: number;
  accounts: number;
  remaining: number;
  capacity: number;
  observed_at: number;
  stale: boolean;
  burn_per_hour: number | null;
  next_reset: number;
  history: QuotaPoint[];
  projected: QuotaPoint[];
};
export type QuotaSnapshot = {
  pools: QuotaPool[];
  accounts: QuotaAccount[];
  observed_at: number;
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/pool/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Pool-Request": "1",
      ...options.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const queries = {
  me: () => ({
    queryKey: ["me"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Me>("/me", { signal }),
    retry: false as const,
  }),
  tokens: () => ({
    queryKey: ["tokens"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Token[]>("/tokens", { signal }),
  }),
  usage: (period: Period, owner?: string) => ({
    queryKey: ["usage", period, owner],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Usage>(
        `/usage?period=${period}` +
          (owner ? "&owner=" + encodeURIComponent(owner) : ""),
        { signal },
      ),
  }),
  requests: (period: Period) => ({
    queryKey: ["requests", period],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<UsageEvent[]>("/requests?period=" + period, { signal }),
  }),
  leaders: (period: Period, metric: Metric) => ({
    queryKey: ["leaders", period, metric],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Leader[]>(`/leaderboard?period=${period}&metric=${metric}`, {
        signal,
      }),
  }),
};

export function useTokens() {
  return useQuery(queries.tokens());
}
export const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const integer = new Intl.NumberFormat("en");
export const dollars = (micros: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(micros / 1_000_000);
export const date = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    timestamp * 1000,
  );
export const dateTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(timestamp * 1000);
export const periodLabels: Record<Period, string> = {
  "24h": "24h",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};
export const periodOptions = (Object.keys(periodLabels) as Period[]).map(
  (value) => ({ value, label: periodLabels[value] }),
);
