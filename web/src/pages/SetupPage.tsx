import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { button, field } from "../../styled-system/recipes";
import { claudeCodeSetup, installClaudeCode } from "../claude-code-setup";
import {
  CodeBlock,
  PageHeader,
  Segmented,
  caption,
  card,
  formError,
  label,
} from "../ui";

const methods = {
  save: {
    title: "Save configuration",
    description:
      "Recommended for Linux and macOS. Requires Python 3. Prompts for your token privately, backs up existing settings, and merges Pool into ~/.claude/settings.json. Stores your token locally with file permissions 600. Other settings are preserved.",
    label: "Save config",
  },
  session: {
    title: "Try one terminal session",
    description:
      "Works from Bash or Zsh on Linux and macOS. Prompts for your token privately and opens Claude Code for this session. Existing gateway settings in ~/.claude/settings.json can override these variables; use Save config if /status shows a different gateway.",
    label: "Terminal",
  },
  config: {
    title: "Merge settings manually",
    description:
      "Merge this env object into ~/.claude/settings.json, keeping your other settings. Replace the token placeholder with your Pool API token. Keep the token in your user settings, outside your project repository.",
    label: "Settings JSON",
  },
  agent: {
    title: "Ask your coding agent",
    description:
      "Paste this prompt into your coding agent. It explains the configuration and asks you to enter the token privately on your computer.",
    label: "Agent prompt",
  },
};
type Method = keyof typeof methods;

const validModel = /^[a-zA-Z0-9][a-zA-Z0-9._:/()-]{0,199}$/;
const link = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  color: "fg",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  textDecorationColor: "token(colors.faint)",
  fontSize: "14px",
});
const inlineCode = css({
  "& p code": {
    fontSize: "13px",
    color: "fg",
    background: "raised",
    padding: "2px 6px",
    borderRadius: "6px",
    overflowWrap: "anywhere",
  },
});

export default function SetupPage() {
  const [method, setMethod] = useState<Method>("save");
  const [opusModel, setOpusModel] = useState("claude-opus-5-5");
  const [sonnetModel, setSonnetModel] = useState("claude-sonnet-5-5");
  const panel = useId();
  const baseURL = window.location.origin;
  const valid =
    validModel.test(opusModel.trim()) && validModel.test(sonnetModel.trim());
  const snippets = claudeCodeSetup(
    baseURL,
    opusModel.trim(),
    sonnetModel.trim(),
  );

  return (
    <>
      <PageHeader title="Quick Start" meta="Claude Code · Linux / macOS" />
      <div
        className={cx(
          inlineCode,
          css({
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: "20px",
            maxWidth: "1100px",
          }),
        )}
      >
        <Step number={1} title="Create your API token">
          <p className={caption}>
            Create a named token and save the key. Use your Pool token for
            client setup; the shared Claude and Codex accounts are managed by
            administrators. GitHub login is only needed for this dashboard;
            Claude Code authenticates with your Pool token.
          </p>
          <div
            className={css({
              display: "flex",
              gap: "18px",
              alignItems: "center",
              flexWrap: "wrap",
            })}
          >
            <a href="#/tokens" className={button({ variant: "primary" })}>
              <KeyRound size={16} />
              API tokens
            </a>
            <details
              className={css({
                "& summary": { color: "dim", fontSize: "14px" },
                "&[open] summary": { mb: "12px" },
              })}
            >
              <summary>Need to install Claude Code?</summary>
              <p className={cx(caption, css({ mb: "12px" }))}>
                Run the official installer, then open a new terminal and check{" "}
                <code>claude --version</code>.
              </p>
              <CodeBlock
                label="Claude Code installer"
                value={installClaudeCode}
              />
              <a
                className={link}
                href="https://code.claude.com/docs/en/quickstart"
                target="_blank"
                rel="noreferrer"
              >
                Official installation guide <ArrowUpRight size={14} />
              </a>
            </details>
          </div>
        </Step>

        <Step number={2} title="Connect to Pool">
          <p className={caption}>
            Run these commands on your own computer. The gateway is{" "}
            <code>{baseURL}</code>; Claude Code adds <code>/v1/messages</code>.
          </p>
          <div
            className={css({
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "14px",
              smDown: { gridTemplateColumns: "minmax(0, 1fr)" },
            })}
          >
            <label className={label}>
              Opus model · default
              <input
                className={field()}
                value={opusModel}
                onChange={(event) => setOpusModel(event.target.value)}
                maxLength={200}
                spellCheck={false}
              />
            </label>
            <label className={label}>
              Sonnet model · Sonnet and Haiku aliases
              <input
                className={field()}
                value={sonnetModel}
                onChange={(event) => setSonnetModel(event.target.value)}
                maxLength={200}
                spellCheck={false}
              />
            </label>
          </div>
          <p className={cx(caption, css({ color: "faint" }))}>
            Opus 5.5 is the default model. Sonnet 5.5 handles the Sonnet and
            Haiku aliases. Your pool needs a connected Claude account to serve
            these models. Adjust the IDs if your administrator uses other
            models.
          </p>
          {!valid && (
            <p role="alert" className={formError}>
              Enter model IDs without spaces, quotes, or line breaks.
            </p>
          )}
          <Segmented
            label="Claude Code setup method"
            value={method}
            onChange={setMethod}
            panel={panel}
            options={(Object.keys(methods) as Method[]).map((key) => ({
              value: key,
              label: methods[key].label,
            }))}
          />
          <div
            id={panel}
            role="tabpanel"
            aria-labelledby={panel + "-" + method}
            className={css({
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: "14px",
              minWidth: 0,
            })}
          >
            <div>
              <h3
                className={css({
                  fontSize: "16px",
                  fontWeight: 500,
                  mb: "4px",
                })}
              >
                {methods[method].title}
              </h3>
              <p className={caption}>{methods[method].description}</p>
            </div>
            {valid ? (
              <CodeBlock
                key={method}
                label={methods[method].title}
                value={snippets[method]}
              />
            ) : (
              <p role="status" className={caption}>
                Choose valid model IDs to generate the setup instructions.
              </p>
            )}
          </div>
        </Step>

        <Step number={3} title="Start a fresh session and verify">
          <p className={caption}>
            Run <code>claude</code>, then <code>/status</code>. Check that the
            Anthropic base URL is <code>{baseURL}</code> and authentication uses{" "}
            <code>ANTHROPIC_AUTH_TOKEN</code>. Send a short message to confirm
            the connection. Your named token&apos;s activity will appear in
            Pool.
          </p>
          <p className={cx(caption, css({ color: "faint" }))}>
            If you see a login screen, check that the token reached Claude Code.
            For a 401, check the token&apos;s expiry, revocation, and daily
            limit. For an unknown model, update the model IDs above. If the
            gateway is wrong, check existing shell exports and managed settings.
          </p>
          <a
            className={link}
            href="https://code.claude.com/docs/en/llm-gateway-connect"
            target="_blank"
            rel="noreferrer"
          >
            Claude Code gateway documentation <ArrowUpRight size={14} />
          </a>
        </Step>
      </div>
    </>
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
          gridTemplateColumns: "44px minmax(0, 1fr)",
          gap: "0 18px",
          smDown: { gridTemplateColumns: "minmax(0, 1fr)", gap: "12px" },
        }),
      )}
    >
      <span
        aria-hidden="true"
        className={css({
          display: "grid",
          placeItems: "center",
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          background: "raised",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        })}
      >
        {number}
      </span>
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "16px",
          minWidth: 0,
          alignContent: "start",
        })}
      >
        <h2
          className={css({
            fontSize: "19px",
            fontWeight: 600,
            lineHeight: "36px",
          })}
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}
