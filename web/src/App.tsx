import { lazy, Suspense, useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useIsFetching,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Globe,
  KeyRound,
  Layers3,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { css, cx } from "../styled-system/css";
import { iconButton } from "../styled-system/recipes";
import { queries, type Me } from "./api";
import { ErrorState, Loading, Person } from "./ui";

const QuotaPage = lazy(() => import("./pages/QuotaPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const TokensPage = lazy(() => import("./pages/TokensPage"));
const UsagePage = lazy(() => import("./pages/UsagePage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));

type Page = "quota" | "setup" | "tokens" | "usage" | "leaderboard" | "admin";
type NavItem = { id: Page; label: string; icon: LucideIcon; admin?: boolean };

const navigation: NavItem[][] = [
  [
    { id: "quota", label: "Accounts", icon: Gauge },
    { id: "setup", label: "Quick Start", icon: Zap },
  ],
  [
    { id: "usage", label: "Usage", icon: Activity },
    { id: "leaderboard", label: "Leaderboard", icon: Trophy },
    { id: "tokens", label: "API Tokens", icon: KeyRound },
  ],
  [
    {
      id: "admin",
      label: "Administration",
      icon: SlidersHorizontal,
      admin: true,
    },
  ],
];
const pages = navigation.flat().map((item) => item.id);

function readPage(): Page {
  const hash = window.location.hash.slice(2) as Page;
  return pages.includes(hash) ? hash : "quota";
}

function usePage() {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    const sync = () => setPage(readPage());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return page;
}

export function App() {
  const me = useQuery(queries.me());
  if (me.isPending)
    return (
      <main className={entry}>
        <Loading label="Opening Pool…" />
      </main>
    );
  if (me.isError)
    return (
      <main className={entry}>
        <Brand />
        <ErrorState error={me.error} retry={() => void me.refetch()} />
        <p className={css({ color: "dim", fontSize: "14px" })}>
          Open Pool through your Cloudflare Access application, or start the
          loopback development server.
        </p>
      </main>
    );
  return <Session key={me.data.identity.id} me={me.data} />;
}

const entry = css({
  display: "grid",
  gap: "20px",
  alignContent: "center",
  width: "min(520px, calc(100% - 32px))",
  minHeight: "100vh",
  margin: "0 auto",
});

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
      <Shell me={me} />
    </QueryClientProvider>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <a
      href="#/quota"
      aria-label="Pool"
      className={css({
        display: "flex",
        alignItems: "center",
        gap: "12px",
        paddingInline: "10px",
        fontSize: "19px",
        fontWeight: 650,
        letterSpacing: "-0.01em",
      })}
    >
      <span
        className={css({
          display: "grid",
          placeItems: "center",
          width: "38px",
          height: "38px",
          borderRadius: "11px",
          background: "raised",
          color: "fg",
          flexShrink: 0,
        })}
      >
        <Layers3 size={20} strokeWidth={2} />
      </span>
      {!collapsed && "Pool"}
    </a>
  );
}

function Shell({ me }: { me: Me }) {
  const page = usePage();
  const client = useQueryClient();
  const fetching = useIsFetching();
  const [collapsed, setCollapsed] = useState(false);
  const admin = me.identity.admin;

  return (
    <div
      className={css({
        "--sidebar": collapsed ? "84px" : "290px",
        minHeight: "100vh",
      })}
    >
      <aside
        className={css({
          position: "fixed",
          inset: "0 auto 0 0",
          width: "var(--sidebar)",
          display: "flex",
          flexDirection: "column",
          padding: "22px 14px",
          zIndex: 10,
          background: "canvas",
          mdDown: {
            position: "sticky",
            top: 0,
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: "8px",
            padding: "10px 12px",
            overflowX: "auto",
            scrollbarWidth: "none",
            borderBottom: "1px solid token(colors.line)",
          },
        })}
      >
        <Brand collapsed={collapsed} />
        <nav
          aria-label="Main navigation"
          className={css({
            display: "grid",
            gap: "4px",
            marginTop: "34px",
            mdDown: { display: "flex", marginTop: 0, gap: "2px" },
          })}
        >
          {navigation.map((group, index) => {
            const items = group.filter((item) => !item.admin || admin);
            if (!items.length) return null;
            return (
              <div
                key={index}
                className={css({
                  display: "grid",
                  gap: "2px",
                  "& + &": { marginTop: "22px" },
                  mdDown: {
                    display: "flex",
                    "& + &": { marginTop: 0 },
                  },
                })}
              >
                {items.map((item) => (
                  <a
                    key={item.id}
                    href={"#/" + item.id}
                    aria-current={page === item.id ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      height: "46px",
                      paddingInline: "16px",
                      borderRadius: "12px",
                      color: "#c8c8cc",
                      fontSize: "17px",
                      whiteSpace: "nowrap",
                      transition: "background 0.12s, color 0.12s",
                      _hover: { background: "card", color: "fg" },
                      "&[aria-current=page]": {
                        background: "raised",
                        color: "fg",
                        fontWeight: 500,
                        "& svg": { color: "focus" },
                      },
                      mdDown: {
                        height: "38px",
                        paddingInline: "12px",
                        fontSize: "15px",
                      },
                    })}
                  >
                    <item.icon size={19} strokeWidth={1.8} />
                    <span
                      className={cx(
                        collapsed && css({ md: { display: "none" } }),
                      )}
                    >
                      {item.label}
                    </span>
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div
          className={css({
            marginTop: "auto",
            paddingInline: "16px",
            display: "grid",
            gap: "2px",
            fontSize: "13px",
            color: "faint",
            mdDown: { display: "none" },
          })}
        >
          {!collapsed && (
            <>
              <span className={css({ color: "fg", fontSize: "14px" })}>
                {me.identity.login ? (
                  <Person person={me.identity} />
                ) : (
                  me.identity.email
                )}
              </span>
              {admin && <span>Admin</span>}
            </>
          )}
        </div>
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((value) => !value)}
          className={css({
            position: "absolute",
            top: "50%",
            right: "-16px",
            display: "grid",
            placeItems: "center",
            width: "32px",
            height: "64px",
            borderRadius: "16px",
            background: "card",
            color: "dim",
            _hover: { color: "fg", background: "raised" },
            mdDown: { display: "none" },
          })}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </aside>
      <div
        className={css({
          marginLeft: "var(--sidebar)",
          padding: "26px 56px 64px",
          minWidth: 0,
          lgDown: { padding: "22px 32px 48px" },
          mdDown: { marginLeft: 0, padding: "16px 16px 40px" },
        })}
      >
        <div
          className={css({
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "8px",
            minHeight: "40px",
            marginBottom: "20px",
          })}
        >
          {me.development && (
            <span
              className={css({
                marginRight: "auto",
                fontSize: "13px",
                color: "warn",
              })}
            >
              Development mode
            </span>
          )}
          <button
            className={iconButton()}
            aria-label="Refresh data"
            title="Refresh data"
            onClick={() => void client.invalidateQueries()}
          >
            <RefreshCw
              size={18}
              className={cx(
                fetching > 0 && css({ animation: "spin 0.9s linear infinite" }),
              )}
            />
          </button>
          <a
            className={iconButton()}
            aria-label="Source on GitHub"
            title="Source on GitHub"
            href="https://github.com/darjss/CLIProxyAPI"
            target="_blank"
            rel="noreferrer"
          >
            <Globe size={18} />
          </a>
          {!me.development && (
            <a
              className={iconButton()}
              aria-label="Sign out"
              title="Sign out"
              href="/cdn-cgi/access/logout"
            >
              <LogOut size={18} />
            </a>
          )}
        </div>
        <main className={css({ maxWidth: "1560px" })}>
          <Suspense fallback={<Loading />}>
            {page === "quota" && <QuotaPage admin={admin} />}
            {page === "setup" && <SetupPage />}
            {page === "tokens" && <TokensPage />}
            {page === "usage" && <UsagePage />}
            {page === "leaderboard" && <LeaderboardPage />}
            {page === "admin" &&
              (admin ? (
                <AdminPage />
              ) : (
                <ErrorState error={new Error("Administrators only.")} />
              ))}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
