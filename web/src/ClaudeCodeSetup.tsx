import { useId, useRef, useState, type KeyboardEvent } from "react";
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
const methodKeys = Object.keys(methods) as Method[];

export function ClaudeCodeSetup() {
  const [method, setMethod] = useState<Method>("save");
  const [opusModel, setOpusModel] = useState("claude-opus-5-5");
  const [sonnetModel, setSonnetModel] = useState("claude-sonnet-5-5");
  const setupId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseURL = window.location.origin;
  const validModel = /^[a-zA-Z0-9][a-zA-Z0-9._:/()-]{0,199}$/;
  const valid =
    validModel.test(opusModel.trim()) && validModel.test(sonnetModel.trim());
  const snippets = claudeCodeSetup(
    baseURL,
    opusModel.trim(),
    sonnetModel.trim(),
  );

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % methodKeys.length;
        break;
      case "ArrowLeft":
        next = (index + methodKeys.length - 1) % methodKeys.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = methodKeys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setMethod(methodKeys[next]);
    tabRefs.current[next]?.focus();
  }

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
          <summary>Models · Opus 5.5 / Sonnet 5.5</summary>
          <p>
            Opus 5.5 is the default model. Sonnet 5.5 handles the Sonnet and
            Haiku aliases. Your pool needs a connected Claude account to serve
            these models. Adjust the IDs if your administrator uses other
            models.
          </p>
          <div className={styles.clientModelFields}>
            <label className={styles.field}>
              Opus model ID
              <input
                value={opusModel}
                onChange={(event) => setOpusModel(event.target.value)}
                maxLength={200}
                spellCheck={false}
              />
            </label>
            <label className={styles.field}>
              Sonnet model ID
              <input
                value={sonnetModel}
                onChange={(event) => setSonnetModel(event.target.value)}
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
        <div
          className={styles.setupTabs}
          role="tablist"
          aria-label="Claude Code setup method"
        >
          {methodKeys.map((key, index) => (
            <button
              key={key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${setupId}-${key}`}
              aria-selected={method === key}
              aria-controls={`${setupId}-panel`}
              tabIndex={method === key ? 0 : -1}
              onClick={() => setMethod(key)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {methods[key].label}
            </button>
          ))}
        </div>
        <div
          className={styles.setupPanel}
          role="tabpanel"
          id={`${setupId}-panel`}
          aria-labelledby={`${setupId}-${method}`}
          tabIndex={0}
        >
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
        </div>
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
