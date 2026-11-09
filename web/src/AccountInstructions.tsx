import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { button } from "../styled-system/recipes";
import { styles } from "./styles";

const providers = {
  claude: {
    name: "Claude",
    flag: "--claude-login",
    steps: [
      "Open the login URL printed in the terminal, sign in to the Claude account you want to share, and authorize access.",
      "If the localhost callback page fails to load, copy its full URL from the address bar and paste it into the terminal when prompted.",
      "Wait for authentication to be saved. Complete the login within five minutes; rerun the command if it expires.",
    ],
  },
  codex: {
    name: "Codex",
    flag: "--codex-device-login",
    steps: [
      "Open the device login URL printed in the terminal and enter the device code shown alongside it.",
      "Sign in to the OpenAI account you want to share and authorize access.",
      "Keep the terminal open until authentication is saved. Complete the login within 15 minutes; rerun the command if it expires.",
    ],
  },
};

export function AccountInstructions() {
  const [provider, setProvider] = useState<keyof typeof providers>("claude");
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const login = providers[provider];
  const command = `go run ./cmd/server \\\n  --config ~/.config/pool/config.yaml \\\n  ${login.flag} \\\n  --no-browser`;

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy is unavailable. Select the command and copy it manually.",
      );
    }
  }

  return (
    <details className={styles.accountInstructions}>
      <summary>Connect an account</summary>
      <p className={styles.sectionDescription}>
        Add a Claude or Codex account to the shared pool. Run the command on the
        Pool server as the service user, from the Pool source checkout.
      </p>
      <div className={styles.accountLoginControls}>
        <label className={styles.field}>
          Account provider
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as keyof typeof providers);
              setCopyError("");
            }}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <button
          type="button"
          className={button()}
          aria-label={`Copy ${login.name} login command`}
          onClick={() => void copyCommand()}
        >
          {copied === command ? <Check size={14} /> : <Copy size={14} />}
          {copied === command ? "Copied" : "Copy command"}
        </button>
      </div>
      <pre
        className={styles.loginCommand}
        tabIndex={0}
        aria-label={`${login.name} login command`}
      >
        <code>{command}</code>
      </pre>
      <p role="status" className={styles.footnote}>
        {copyError ||
          (copied === command
            ? "Command copied to clipboard."
            : "Uses the production config at ~/.config/pool/config.yaml. Adjust the path if your deployment uses another config.")}
      </p>
      <ol className={styles.accountLoginSteps}>
        {login.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className={styles.footnote}>
        Pool loads saved accounts automatically. Refresh this page to see the
        account. Quota refreshes every two minutes. These logins connect shared
        upstream accounts. Members use their own Pool API tokens in clients.
      </p>
    </details>
  );
}
