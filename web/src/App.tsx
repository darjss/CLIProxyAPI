import { styles } from "./styles";
import { cx } from "../styled-system/css";
import { iconButton, sidebar } from "../styled-system/recipes";
import { lazy, Suspense, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Gauge,
  KeyRound,
  Layers3,
  Menu,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  X,
} from "lucide-react";
import { queries, type Me } from "./api";
import { ErrorState, Loading } from "./components";
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((m) => ({ default: m.OverviewPage })),
);
const TokensPage = lazy(() =>
  import("./pages/TokensPage").then((m) => ({ default: m.TokensPage })),
);
const UsagePage = lazy(() =>
  import("./pages/UsagePage").then((m) => ({ default: m.UsagePage })),
);
const LeaderboardPage = lazy(() =>
  import("./pages/LeaderboardPage").then((m) => ({
    default: m.LeaderboardPage,
  })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);

const navigation = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "tokens", label: "API tokens", icon: KeyRound },
  { id: "usage", label: "My usage", icon: Activity },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "admin", label: "Administration", icon: SlidersHorizontal },
] as const;
type Page = (typeof navigation)[number]["id"];

export function App() {
  const me = useQuery(queries.me());
  if (me.isPending)
    return (
      <main className={styles.entryState}>
        <Loading label="Opening Pool…" />
      </main>
    );
  if (me.isError)
    return (
      <main className={styles.entryState}>
        <div className={styles.brand}>
          <Layers3 size={23} />
          Pool
        </div>
        <ErrorState error={me.error} retry={() => void me.refetch()} />
        <p className={styles.muted}>
          Open Pool through your Cloudflare Access application, or start the
          loopback development server.
        </p>
      </main>
    );
  return <Session key={me.data.identity.id} me={me.data} />;
}

function Session({ me }: { me: Me }) {
  // A different Access identity gets a fresh private-data cache.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace me={me} />
    </QueryClientProvider>
  );
}

function Workspace({ me }: { me: Me }) {
  const client = useQueryClient();
  const [page, setPage] = useState<Page>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={styles.appShell}>
      <aside className={menuOpen ? sidebar({ open: true }) : sidebar()}>
        <a className={styles.brand} href="/pool/" aria-label="Pool overview">
          <span className={styles.brandMark}>
            <Layers3 size={20} strokeWidth={1.7} />
          </span>
          Pool<span className={styles.brandOrg}>/ erxes</span>
        </a>
        <button
          className={cx(iconButton(), styles.mobileClose)}
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        >
          <X size={18} />
        </button>
        <div className={styles.navCaption}>WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation
            .filter((item) => item.id !== "admin" || me.identity.admin)
            .map((item) => (
              <button
                key={item.id}
                className={styles.navItem}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => {
                  setPage(item.id);
                  setMenuOpen(false);
                }}
              >
                <item.icon size={17} strokeWidth={1.7} />
                {item.label}
                {page === item.id && <span className={styles.navDot} />}
              </button>
            ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.connection}>
            <span className={styles.statusDot} />
            {me.development ? "Local development" : "Cloudflare Access"}
          </div>
          <div className={styles.identity}>
            <div className={styles.avatar}>
              {me.identity.email.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{me.identity.email}</strong>
              <span>{me.identity.admin ? "Administrator" : "Member"}</span>
            </div>
            <ShieldCheck size={15} />
          </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          className={styles.navBackdrop}
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className={styles.workspace}>
        <div className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <button
              className={cx(iconButton(), styles.mobileMenu)}
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={18} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {navigation.find((item) => item.id === page)?.label}
            </strong>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.version}>Claude + Codex</span>
            <button
              className={iconButton()}
              aria-label="Refresh current data"
              onClick={() => void client.invalidateQueries()}
            >
              <RefreshCw size={15} />
            </button>
            <a
              className={iconButton()}
              aria-label="Open source on GitHub"
              href="https://github.com/darjss/CLIProxyAPI"
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
        </div>
        {me.development && (
          <div className={styles.devBanner}>
            <span className={styles.statusDot} />
            Development mode · fixed local identity · not a production Access
            session
          </div>
        )}
        <main className={styles.pageContent}>
          <Suspense fallback={<Loading />}>
            {page === "overview" && (
              <OverviewPage
                onCreate={() => setPage("tokens")}
                admin={me.identity.admin}
              />
            )}
            {page === "tokens" && <TokensPage development={me.development} />}
            {page === "usage" && <UsagePage />}
            {page === "leaderboard" && <LeaderboardPage />}
            {page === "admin" && me.identity.admin && <AdminPage />}
          </Suspense>
        </main>
        <footer className={styles.appFooter}>
          <span>
            Pool <span className={styles.footerDivider}>/</span> Your shared AI
            gateway.
          </span>
          <span>
            Usage metadata only. Your prompts stay out of the dashboard.
          </span>
        </footer>
      </div>
    </div>
  );
}
