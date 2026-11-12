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
  palette,
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

export default function SetupPage() {
  const [path, setPath] = useState<"use" | "share">("use");
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
      <PageHeader title="Quick Start">
        <Segmented
          label="What do you want to do"
          value={path}
          onChange={setPath}
          options={[
            { value: "use", label: "Use the pool" },
            { value: "share", label: "Share an account" },
          ]}
        />
      </PageHeader>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "16px",
          maxWidth: "980px",
        })}
      >
        {path === "share" && (
          <Step number={0} title="Connect your Claude or Codex account">
            <p className={caption}>
              The pool uses it for everyone. You sign in on the provider's page,
              and the credentials stay on the server.
            </p>
            <ConnectAccount />
          </Step>
        )}
        <Step number={1} title="Pick your tool">
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
            Uses <code>{modelLabels[model] ?? model}</code> by default. Switch
            models any time inside {harness.label}.
          </p>
        </Step>
        <Install
          key={tool + model}
          tool={tool}
          model={model}
          harness={harness}
        />
        <OtherWays harness={harness} model={model} />
      </div>
    </>
  );
}

function Install({
  tool,
  model,
  harness,
}: {
  tool: HarnessID;
  model: string;
  harness: Harness;
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
      query.state.data?.first || query.state.data?.status === "expired"
        ? false
        : 2000,
  });
  const state = status.data;

  return (
    <>
      <Step number={2} title="Run this on your computer">
        {create.data ? (
          <>
            <CodeBlock label="Setup command" value={create.data.command} />
            <p className={caption}>
              Works once, for 10 minutes, in bash, zsh, or fish. It saves a new
              token to <code>~/.config/pool/token</code> and backs up any config
              it changes. Needs Python 3.
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
      <Step number={3} title="Send your first message">
        <Progress
          done={state?.status === "installed"}
          active={!!code && state?.status !== "expired"}
        >
          {state?.status === "expired"
            ? "That command expired. Get a new one."
            : state?.status === "installed"
              ? "Config written."
              : "Waiting for the setup command to run."}
        </Progress>
        <Progress done={!!state?.first} active={state?.status === "installed"}>
          {state?.first ? (
            <>
              Connected. {modelLabels[state.first.model] ?? state.first.model}{" "}
              answered in {number.format(state.first.latency_ms / 1000)}s.
            </>
          ) : (
            <>
              Start <code>{harness.run}</code> and say hi.
            </>
          )}
        </Progress>
      </Step>
    </>
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
6. Tell me to restart ${harness.label} and send a message. Setup is done when that message gets an answer.

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

const stepColors = [palette.claude, palette.blue, palette.violet, palette.ok];

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
        })}
        style={{
          color: stepColors[number],
          background: `color-mix(in srgb, ${stepColors[number]} 16%, transparent)`,
        }}
      >
        {number || "+"}
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
