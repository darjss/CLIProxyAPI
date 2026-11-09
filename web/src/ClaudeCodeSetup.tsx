import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "../styled-system/css";
import { button, panel } from "../styled-system/recipes";
import { claudeCodeSetup, installClaudeCode } from "./claude-code-setup";
import { styles } from "./styles";

const methods = {
  save: {
    title: "Save configuration",
    description:
      "Recommended for Linux and macOS. Requires Python 3. Prompts for your token privately, backs up existing settings, and merges Pool into ~/.claude/settings.json. Stores your token locally with file permissions 600. Other settings are preserved.",
    label: "Save config (recommended)",
  },
  session: {
    title: "Try one terminal session",
    description:
      "Works from Bash or Zsh on Linux and macOS. Prompts for your token privately and opens Claude Code for this session. Existing gateway settings in ~/.claude/settings.json can override these variables; use Save config if /status shows a different gateway.",
    label: "One terminal session",
  },
  config: {
    title: "Merge settings manually",
    description:
      "Merge this env object into ~/.claude/settings.json, keeping your other settings. Replace the token placeholder with your Pool API token. Keep the token in your user settings, outside your project repository.",
    label: "Manual settings JSON",
  },
  agent: {
    title: "Ask your coding agent",
    description:
      "Paste this prompt into your coding agent. It explains the configuration and asks you to enter the token privately on your computer.",
    label: "Agent setup prompt",
  },
};

export function ClaudeCodeSetup() {
  const [method, setMethod] = useState<keyof typeof methods>("save");
  const [model, setModel] = useState("gpt-6.1-sol");
  const [fastModel, setFastModel] = useState("gpt-6-luna");
  const baseURL = window.location.origin;
  const validModel = /^[a-zA-Z0-9][a-zA-Z0-9._:/()-]{0,199}$/;
  const valid =
    validModel.test(model.trim()) && validModel.test(fastModel.trim());
  const snippets = claudeCodeSetup(baseURL, model.trim(), fastModel.trim());

  return (
    <section className={panel()} aria-labelledby="claude-code-setup">
      <div className={styles.panelHeading}>
        <h2 id="claude-code-setup">Set up Claude Code</h2>
        <span className={styles.subtleBadge}>Linux / macOS</span>
      </div>
      <div className={styles.clientSetup}>
        <div>
          <h3>1. Create your API token</h3>
          <p>
            Create a named token above and save the key. Use your Pool token for
            client setup; the shared Claude and Codex accounts are managed by
            administrators. GitHub login is only needed for this dashboard;
            Claude Code authenticates with your Pool token.
          </p>
        </div>
        <details>
          <summary>Need to install Claude Code?</summary>
          <p>
            Run the official installer, then open a new terminal and check
            <code> claude --version</code>.
          </p>
          <CopySnippet
            label="Claude Code installer"
            value={installClaudeCode}
          />
          <a
            href="https://code.claude.com/docs/en/quickstart"
            target="_blank"
            rel="noreferrer"
          >
            Official installation guide ↗
          </a>
        </details>
        <div>
          <h3>2. Connect to Pool</h3>
          <p>
            Run these commands on your own computer. The gateway is
            <code> {baseURL}</code>; Claude Code adds <code>/v1/messages</code>.
          </p>
        </div>
        <details>
          <summary>
            Model settings · {model || "main"} / {fastModel || "fast"}
          </summary>
          <p>
            Defaults use the Codex pool. Enter model IDs served by your pool if
            your administrator configures other models. Sonnet and Opus use the
            main model; Haiku uses the fast model.
          </p>
          <div className={styles.clientModelFields}>
            <label className={styles.field}>
              Main model ID
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={200}
                spellCheck={false}
              />
            </label>
            <label className={styles.field}>
              Fast model ID
              <input
                value={fastModel}
                onChange={(event) => setFastModel(event.target.value)}
                maxLength={200}
                spellCheck={false}
              />
            </label>
          </div>
          {!valid && (
            <p role="alert" className={styles.formError}>
              Enter model IDs without spaces, quotes, or line breaks.
            </p>
          )}
        </details>
        <label className={cx(styles.field, styles.setupMethod)}>
          Setup method
          <select
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as keyof typeof methods)
            }
          >
            {Object.entries(methods).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p>{methods[method].description}</p>
        {valid ? (
          <CopySnippet
            key={method}
            label={methods[method].title}
            value={snippets[method]}
          />
        ) : (
          <p role="status">
            Choose valid model IDs to generate the setup instructions.
          </p>
        )}
        <div>
          <h3>3. Start a fresh session and verify</h3>
          <p>
            Run <code>claude</code>, then <code>/status</code>. Check that the
            Anthropic base URL is <code>{baseURL}</code> and authentication uses
            <code> ANTHROPIC_AUTH_TOKEN</code>. Send a short message to confirm
            the connection. Your named token&apos;s activity will appear in
            Pool.
          </p>
        </div>
        <p>
          If you see a login screen, check that the token reached Claude Code.
          For a 401, check the token&apos;s expiry, revocation, and daily limit.
          For an unknown model, update the model IDs above. If the gateway is
          wrong, check existing shell exports and managed settings.
        </p>
        <a
          href="https://code.claude.com/docs/en/llm-gateway-connect"
          target="_blank"
          rel="noreferrer"
        >
          Claude Code gateway documentation ↗
        </a>
      </div>
    </section>
  );
}

function CopySnippet({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setError("");
    } catch {
      setError("Copy is unavailable. Select the text and copy it manually.");
    }
  }
  return (
    <div>
      <div className={styles.snippetHeading}>
        <strong>{label}</strong>
        <button
          type="button"
          className={button()}
          aria-label={`Copy ${label}`}
          onClick={() => void copy()}
        >
          {copied === value ? <Check size={14} /> : <Copy size={14} />}
          {copied === value ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={cx(styles.loginCommand, styles.setupSnippet)}
        tabIndex={0}
        aria-label={label}
      >
        <code>{value}</code>
      </pre>
      <p className={styles.footnote} role="status">
        {error || (copied === value ? "Copied to clipboard." : "")}
      </p>
    </div>
  );
}
