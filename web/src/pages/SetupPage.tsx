import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, TerminalSquare } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { button } from "../../styled-system/recipes";
import { api, number, type UsageEvent } from "../api";
import ConnectAccount from "../ConnectAccount";
import {
  CodeBlock,
  ErrorState,
  Loading,
  PageHeader,
  ProviderIcon,
  Segmented,
  caption,
  card,
  formError,
} from "../ui";

type ConfigFile = {
  path: string;
  json?: Record<string, unknown>;
  remove_env?: string[];
  toml_block?: string;
  toml_top?: Record<string, string>;
};
type Harness = {
  label: string;
  install: string;
  run: string;
  test: string;
  models: string[];
  files: Record<string, ConfigFile[]>;
};
type HarnessID = "claude" | "codex";
type SetupCode = { code: string; command: string; expires_at: number };
type SetupStatus = {
  status: "waiting" | "installed" | "expired";
  first?: UsageEvent | null;
};

const harnessOrder: HarnessID[] = ["claude", "codex"];
const modelLabels: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-fable-5-1": "Fable 5.1",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-sol": "GPT-6 Sol",
  "gpt-6-luna": "GPT-6 Luna",
};

/** Plain-language explanation of Pool for people new to it. */
export function PoolIntro() {
  return (
    <p className={cx(caption, css({ fontSize: "15px", maxWidth: "680px" }))}>
      Pool shares a few paid Claude and ChatGPT plans with the whole team. You
      use Claude Code or Codex as usual, and Pool runs your requests through
      those plans. You never sign in to Claude or ChatGPT in your terminal. One
      command connects your computer.
    </p>
  );
}

/**
 * Quick Start. On first run (no tokens yet) it doubles as the welcome:
 * same page and components, with a skip and a finish.
 */
export default function SetupPage({ onDone }: { onDone?: () => void }) {
  const [share, setShare] = useState(false);
  return (
    <>
      <PageHeader title={onDone ? "Welcome to Pool" : "Quick Start"}>
        {onDone && (
          <button className={button({ variant: "ghost" })} onClick={onDone}>
            Skip for now
          </button>
        )}
      </PageHeader>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "16px",
          maxWidth: "980px",
        })}
      >
        <PoolIntro />
        <section className={card}>
          <h2 className={css({ fontSize: "16px", fontWeight: 600, mb: "8px" })}>
            Do you have a Claude or ChatGPT plan to share?
          </h2>
          <div role="radiogroup" aria-label="Share a plan">
            <Choice
              checked={!share}
              onSelect={() => setShare(false)}
              title="No, I'll just use the pool"
              text="Set up Claude Code or Codex. About a minute."
            />
            <Choice
              checked={share}
              onSelect={() => setShare(true)}
              title="Yes, add my plan"
              text="Pro, Max, Plus, or Team. More plans means more room for everyone."
              icons
            />
          </div>
        </section>
        {share && (
          <Step number={1} title="Connect your plan">
            <ConnectAccount />
          </Step>
        )}
        <ToolSetup first={share ? 2 : 1} />
        {onDone && (
          <div>
            <button className={button({ variant: "primary" })} onClick={onDone}>
              Go to the dashboard
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  text,
  icons,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
  icons?: boolean;
}) {
  return (
    <label
      className={css({
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: "12px",
        padding: "14px 4px",
        borderTop: "1px solid token(colors.line)",
        cursor: "pointer",
        _first: { borderTop: 0 },
        "&:hover strong": { color: "fg" },
      })}
    >
      <input
        type="radio"
        name="share-plan"
        checked={checked}
        onChange={onSelect}
        className={css({ accentColor: "focus", width: "16px", height: "16px" })}
      />
      <span className={css({ display: "grid", gap: "2px" })}>
        <strong
          className={css({ fontWeight: 500, fontSize: "15px" })}
          style={{ color: checked ? undefined : "#c8c8cc" }}
        >
          {title}
        </strong>
        <span className={css({ color: "dim", fontSize: "13px" })}>{text}</span>
      </span>
      {icons && (
        <span className={css({ display: "flex", gap: "8px" })}>
          <ProviderIcon provider="claude" size={18} />
          <ProviderIcon provider="codex" size={18} />
        </span>
      )}
    </label>
  );
}

/** Pick a tool, run one command, and watch for the first request. */
export function ToolSetup({ first = 1 }: { first?: number }) {
  const [tool, setTool] = useState<HarnessID>("claude");
  const harnesses = useQuery({
    queryKey: ["harnesses"],
    queryFn: ({ signal }) =>
      api<Record<HarnessID, Harness>>("/setup/harnesses", { signal }),
    staleTime: Infinity,
  });
  if (harnesses.isError)
    return (
      <ErrorState
        error={harnesses.error}
        retry={() => void harnesses.refetch()}
      />
    );
  if (harnesses.isPending) return <Loading />;
  const harness = harnesses.data[tool];
  const model = harness.models[0];
  return (
    <>
      <Step number={first} title="Pick your tool">
        <p className={caption}>
          Both are coding assistants that run in your terminal. Pick the one you
          use. Not sure? Pick Claude Code.
        </p>
        <div
          className={css({ display: "flex", gap: "12px", flexWrap: "wrap" })}
        >
          <Segmented
            label="Coding tool"
            value={tool}
            onChange={setTool}
            options={harnessOrder.map((id) => ({
              value: id,
              label: (
                <>
                  <ProviderIcon provider={id} size={16} />
                  {harnesses.data[id].label}
                </>
              ),
            }))}
          />
        </div>
        <p className={caption}>
          It starts on <code>{modelLabels[model] ?? model}</code>. You can
          switch models inside {harness.label} any time.
        </p>
      </Step>
      <Install
        key={tool + model}
        tool={tool}
        model={model}
        harness={harness}
        first={first + 1}
      />
      <OtherWays harness={harness} model={model} />
    </>
  );
}

function Install({
  tool,
  model,
  harness,
  first,
}: {
  tool: HarnessID;
  model: string;
  harness: Harness;
  first: number;
}) {
  const create = useMutation({
    mutationFn: () =>
      api<SetupCode>("/setup", {
        method: "POST",
        body: JSON.stringify({ harness: tool, model }),
      }),
  });
  const code = create.data?.code;
  const status = useQuery({
    queryKey: ["setup", code],
    queryFn: ({ signal }) => api<SetupStatus>("/setup/" + code, { signal }),
    enabled: !!code,
    refetchInterval: (query) =>
      (query.state.data?.first && !query.state.data.first.failed) ||
      query.state.data?.status === "expired"
        ? false
        : 2000,
  });
  const state = status.data;

  return (
    <>
      <Step number={first} title="Run this on your computer">
        <p className={caption}>
          Open a terminal (Terminal on a Mac), paste the command, and press
          Enter. It points {harness.label} at Pool and gives it your own key.
        </p>
        {create.data ? (
          <>
            <CodeBlock label="Setup command" value={create.data.command} />
            <p className={caption}>
              Works once, within 10 minutes. It keeps a backup of any settings
              it changes. Needs Python 3, which Macs and Linux usually have.
            </p>
          </>
        ) : (
          <div>
            <button
              className={button({ variant: "primary" })}
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <TerminalSquare size={16} />
              {create.isPending ? "Creating…" : "Get setup command"}
            </button>
          </div>
        )}
        {create.isError && (
          <p role="alert" className={formError}>
            {create.error.message}
          </p>
        )}
        <details
          className={css({ "& summary": { color: "dim", fontSize: "14px" } })}
        >
          <summary>{harness.label} not installed?</summary>
          <div className={css({ mt: "12px" })}>
            <CodeBlock
              label={harness.label + " installer"}
              value={harness.install}
            />
          </div>
        </details>
      </Step>
      <Step number={first + 1} title="Check that it works">
        {state?.first && !state.first.failed ? (
          <Works harness={harness} event={state.first} />
        ) : (
          <>
            <p className={caption}>
              When the setup command finishes, paste this in the same terminal.
              You should get a short reply, and this page turns green.
            </p>
            <CodeBlock label="Test command" value={harness.test} />
            <Progress
              done={state?.status === "installed"}
              active={!!code && state?.status !== "expired"}
            >
              {state?.status === "expired"
                ? "That setup command expired. Get a new one."
                : state?.status === "installed"
                  ? "Setup command ran."
                  : "Waiting for the setup command to run."}
            </Progress>
            <Progress done={false} active={state?.status === "installed"}>
              {state?.first?.failed
                ? "Pool got your message, but the request failed. Run the test again."
                : "Waiting for your test message."}
            </Progress>
            <details
              className={css({
                "& summary": { color: "dim", fontSize: "14px" },
              })}
            >
              <summary>No reply, or an error?</summary>
              <ul
                className={cx(
                  caption,
                  css({
                    display: "grid",
                    gap: "8px",
                    mt: "12px",
                    pl: "18px",
                    listStyle: "disc",
                  }),
                )}
              >
                <li>
                  <code>command not found</code>: install {harness.label} with
                  the installer in step {first}, then run the test again.
                </li>
                <li>
                  {harness.label} was already open: quit it and start it again.
                  It reads its settings when it starts.
                </li>
                {tool === "claude" && (
                  <li>
                    It asks you to log in, or says the API key is invalid:
                    delete any <code>export ANTHROPIC_API_KEY</code> line from
                    your shell profile, open a new terminal, and run the test
                    again.
                  </li>
                )}
                <li>
                  This page still says the setup command hasn't run: it only
                  works once, within 10 minutes. Reload the page and get a new
                  one.
                </li>
              </ul>
            </details>
          </>
        )}
      </Step>
    </>
  );
}

/** The unmistakable "you're done" state once a test message comes back. */
function Works({ harness, event }: { harness: Harness; event: UsageEvent }) {
  return (
    <div
      role="status"
      className={css({
        display: "grid",
        gridTemplateColumns: "36px minmax(0, 1fr)",
        alignItems: "start",
        gap: "14px",
        padding: "18px",
        borderRadius: "control",
        border:
          "1px solid color-mix(in srgb, token(colors.ok) 45%, transparent)",
        background: "color-mix(in srgb, token(colors.ok) 10%, transparent)",
      })}
    >
      <span
        className={css({
          display: "grid",
          placeItems: "center",
          width: "36px",
          height: "36px",
          borderRadius: "full",
          background: "ok",
          color: "canvas",
        })}
      >
        <Check size={20} strokeWidth={3} />
      </span>
      <div className={css({ display: "grid", gap: "4px" })}>
        <strong className={css({ fontSize: "18px", fontWeight: 600 })}>
          It works. You're set up.
        </strong>
        <p className={caption}>
          Pool answered your test message with{" "}
          {modelLabels[event.model] ?? event.model} in{" "}
          {number.format(event.latency_ms / 1000)}s. From now on, run{" "}
          <code>{harness.run}</code> in any project folder and use it as usual.
        </p>
      </div>
    </div>
  );
}

function Progress({
  done,
  active,
  children,
}: {
  done: boolean;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <p
      className={cx(
        caption,
        css({ display: "flex", alignItems: "center", gap: "10px" }),
        (done || active) && css({ color: "fg" }),
      )}
    >
      {done ? (
        <span
          className={css({
            display: "grid",
            placeItems: "center",
            width: "20px",
            height: "20px",
            borderRadius: "full",
            background: "ok",
            color: "canvas",
          })}
        >
          <Check size={13} strokeWidth={3} />
        </span>
      ) : active ? (
        <LoaderCircle
          size={20}
          className={css({
            color: "focus",
            animation: "spin 0.9s linear infinite",
          })}
        />
      ) : (
        <span
          className={css({
            width: "20px",
            height: "20px",
            borderRadius: "full",
            border: "2px solid token(colors.active)",
          })}
        />
      )}
      <span>{children}</span>
    </p>
  );
}

const tokenPath = "~/.config/pool/token";

function renderFile(file: ConfigFile) {
  if (file.json) return JSON.stringify(file.json, null, 2);
  const top = Object.entries(file.toml_top ?? {})
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");
  return top + "\n\n" + (file.toml_block ?? "");
}

function agentPrompt(harness: Harness, files: ConfigFile[]) {
  const removed = files.flatMap((file) => file.remove_env ?? []);
  return `Connect ${harness.label} on this computer to Pool, our team's shared AI gateway.

1. Ask me for my Pool API token, then wait for my reply. It starts with "pool_". Change nothing until I answer.
2. Save the token to ${tokenPath}, with no trailing newline. Set the file's permissions to 600.
3. For each file below, copy it to <file>.pool-backup if it exists. Then merge in the settings shown and keep every setting already there.${
    removed.length
      ? `\n   In "env", delete these keys if present, because they override the gateway: ${removed.join(", ")}.`
      : ""
  }
   Replace "pool_PASTE_YOUR_TOKEN" with my token. Replace "{TOKEN_FILE}" with the absolute path of ${tokenPath}.
4. Check that each file still parses, and set its permissions to 600.
5. Tell me which files you changed and where the backups are. Show the token only as its first 9 characters.
6. Tell me to quit ${harness.label} if it is open, then run: ${harness.test}
   Setup is done when that prints a reply.

${files.map((file) => `${file.path}\n${renderFile(file)}`).join("\n\n")}`;
}

function OtherWays({ harness, model }: { harness: Harness; model: string }) {
  const [way, setWay] = useState<"agent" | "manual">("agent");
  const files = harness.files[model];
  return (
    <details className={cx(card, css({ "& summary": { fontWeight: 500 } }))}>
      <summary>Other ways to set up</summary>
      <div className={css({ display: "grid", gap: "14px", mt: "16px" })}>
        <Segmented
          label="Setup method"
          value={way}
          onChange={setWay}
          options={[
            { value: "agent", label: "Ask your coding agent" },
            { value: "manual", label: "Edit config yourself" },
          ]}
        />
        {way === "agent" ? (
          <CodeBlock label="Agent prompt" value={agentPrompt(harness, files)} />
        ) : (
          <>
            <p className={caption}>
              Merge these into your files. Create a token on the API Tokens
              page, save it to <code>{tokenPath}</code>, and use it in place of{" "}
              <code>pool_PASTE_YOUR_TOKEN</code>. <code>{"{TOKEN_FILE}"}</code>{" "}
              is the full path to that file.
            </p>
            {files.map((file) => (
              <CodeBlock
                key={file.path}
                label={file.path}
                value={renderFile(file)}
              />
            ))}
          </>
        )}
      </div>
    </details>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        card,
        css({
          display: "grid",
          gridTemplateColumns: "36px minmax(0, 1fr)",
          gap: "0 16px",
          smDown: { gridTemplateColumns: "minmax(0, 1fr)", gap: "12px" },
        }),
      )}
    >
      <span
        aria-hidden="true"
        className={css({
          display: "grid",
          placeItems: "center",
          width: "32px",
          height: "32px",
          borderRadius: "9px",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "focus",
          background: "rgba(138,164,255,0.14)",
        })}
      >
        {number}
      </span>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "14px",
          minWidth: 0,
          alignContent: "start",
          "& p code": {
            fontSize: "13px",
            color: "fg",
            background: "raised",
            padding: "2px 6px",
            borderRadius: "6px",
          },
        })}
      >
        <h2
          className={css({
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "32px",
          })}
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}
