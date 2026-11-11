export const installClaudeCode =
  "curl -fsSL https://claude.ai/install.sh | bash";

export function claudeCodeSetup(
  baseURL: string,
  opusModel: string,
  sonnetModel: string,
) {
  const env = {
    ANTHROPIC_BASE_URL: baseURL,
    ANTHROPIC_MODEL: opusModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: sonnetModel,
  };
  const conflictingKeys = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ];
  const config = JSON.stringify(
    { env: { ...env, ANTHROPIC_AUTH_TOKEN: "pool_REPLACE_WITH_YOUR_TOKEN" } },
    null,
    2,
  );

  return {
    save: `python3 <<'POOL_SETUP'
import getpass
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

path = Path.home() / ".claude" / "settings.json"
settings = json.loads(path.read_text()) if path.exists() else {}
if not isinstance(settings, dict) or not isinstance(settings.get("env", {}), dict):
    raise SystemExit("Expected a JSON object with an env object. Settings were not changed.")
token = getpass.getpass("Pool API token (hidden): ").strip()
if not token.startswith("pool_"):
    raise SystemExit("Enter the API token created in Pool. Settings were not changed.")

path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
if path.exists():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = path.with_name("settings.json.pool-backup-" + stamp)
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(path.read_bytes())
    print("Previous settings backed up to", backup)

env = settings.setdefault("env", {})
for key in ${JSON.stringify(conflictingKeys)}:
    env.pop(key, None)
env.update(${JSON.stringify(env, null, 2)})
env["ANTHROPIC_AUTH_TOKEN"] = token
fd, temporary = tempfile.mkstemp(prefix=".pool-settings-", dir=path.parent)
try:
    with os.fdopen(fd, "w") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\\n")
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print("Pool configuration saved to", path)
print("Restart Claude Code, then run /status to check the gateway.")
POOL_SETUP`,
    session: `bash <<'POOL_SESSION'
set -e
read -r -s -p 'Pool API token (hidden): ' ANTHROPIC_AUTH_TOKEN </dev/tty
printf '\\n'
case "$ANTHROPIC_AUTH_TOKEN" in
  pool_*) ;;
  *) printf 'Enter the API token created in Pool.\\n' >&2; exit 1 ;;
esac
export ANTHROPIC_AUTH_TOKEN
unset ${conflictingKeys.join(" ")}
${Object.entries(env)
  .map(([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'`)
  .join("\n")}
exec claude --model "$ANTHROPIC_MODEL" </dev/tty
POOL_SESSION`,
    config,
    agent: `Set up Claude Code on my Linux/macOS computer to use Pool.

Gateway: ${baseURL}
Default / Opus model: ${opusModel}
Sonnet / lightweight model: ${sonnetModel}

1. Check whether Claude Code is installed. If needed, use the official installer:
   ${installClaudeCode}
2. Read ~/.claude/settings.json, back it up, and merge the env settings below. Preserve unrelated settings, permissions, hooks, MCP servers, and plugins.
3. Let me enter my Pool API token through a hidden prompt in my local terminal. Do not ask for the token in chat or include it in logs, commands, or commits.
4. Replace only the token placeholder. Remove conflicting provider/auth variables from the settings env: ${conflictingKeys.join(", ")}.
5. Save valid JSON with file permissions 600. Show a redacted configuration summary and the backup location.
6. Help me restart Claude Code and run /status. The Anthropic base URL should be ${baseURL} and authentication should use ANTHROPIC_AUTH_TOKEN. Send a short message to confirm connectivity.

Merge these settings:
${config}

This is member client setup. Pool administrators already supply the shared upstream accounts. I only need a named Pool API token; no separate Claude login or Cloudflare service credentials are required.
If managed settings or existing shell variables conflict, explain the conflict before changing them.`,
  };
}
