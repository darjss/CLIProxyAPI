import { useQuery } from "@tanstack/react-query";

export type Period = "today" | "week" | "month" | "all";
export type Metric = "tokens" | "cost";
export type Person = { login: string; name: string; avatar: string };
export type Me = {
  identity: Person & { id: string; email: string; admin: boolean };
  development: boolean;
};
export type Token = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  expires_at: number;
  revoked_at: number;
  daily_limit: number;
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
export type Overview = {
  usage: Aggregate;
  accounts: Record<string, number>;
  quota_status: string;
  since: number;
};
export type Leader = Aggregate & Person & { id: string; keys: number };
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
};
export type Day = { date: string; tokens: number; requests: number };
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
export type Account = {
  id: string;
  provider: string;
  status: string;
  disabled: boolean;
};
export type Price = {
  id: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
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
  overview: (period: Period) => ({
    queryKey: ["overview", period],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Overview>("/overview?period=" + period, { signal }),
  }),
  activity: (period: Period) => ({
    queryKey: ["activity", period],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<Day[]>("/activity?period=" + period, { signal }),
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
  today: "Today (UTC)",
  week: "Last 7 days",
  month: "This month (UTC)",
  all: "All time",
};
export const periodOptions = (Object.keys(periodLabels) as Period[]).map(
  (value) => ({ value, label: periodLabels[value] }),
);
