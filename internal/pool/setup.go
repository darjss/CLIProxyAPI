package pool

import (
	"crypto/rand"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/MoeForge/moego/base64"
	"github.com/MoeForge/moego/ojson"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

const (
	setupTTL         = 10 * time.Minute
	tokenPlaceholder = "pool_PASTE_YOUR_TOKEN"
)

// configFile is one file a harness reads. JSON is deep-merged into the existing file;
// TOML replaces one table and sets top-level keys. {TOKEN_FILE} becomes the absolute token path.
type configFile struct {
	Path      string            `json:"path"`
	JSON      map[string]any    `json:"json,omitempty"`
	RemoveEnv []string          `json:"remove_env,omitempty"`
	TOMLBlock string            `json:"toml_block,omitempty"`
	TOMLTop   map[string]string `json:"toml_top,omitempty"`
	// T3 marks T3 Code's settings file: "optional" skips it when T3 Code is missing or
	// too old, "required" stops the script. The script finds the file and checks the version.
	T3 string `json:"t3,omitempty"`
}

// t3Source adds Pool as a CLIProxyAPI usage source in T3 Code. T3 Code moves the
// key into its own secret store the next time it reads the file.
func t3Source(base, token, mode string) configFile {
	return configFile{Path: "~/.t3/userdata/settings.json", T3: mode, JSON: map[string]any{
		"usageLimitSources": map[string]any{"pool": map[string]any{
			"kind": "cliproxy", "label": "Pool", "url": base + "/v1/t3", "managementKey": token, "enabled": true,
		}},
	}}
}

type harness struct {
	Label   string `json:"label"`
	Install string `json:"install"`
	Run     string `json:"run"`
	// Test is a one-shot prompt that prints a reply, so people can see setup worked.
	Test   string   `json:"test"`
	Models []string `json:"models"`
	files  func(base, model, token string) []configFile
}

var harnesses = map[string]harness{
	"claude": {Label: "Claude Code", Install: "curl -fsSL https://claude.ai/install.sh | bash", Run: "claude", Test: "claude -p 'Say hi to Pool in five words'", Models: []string{"claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5"},
		files: func(base, model, token string) []configFile {
			return []configFile{{Path: "~/.claude/settings.json",
				RemoveEnv: []string{"ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"},
				JSON: map[string]any{"env": map[string]any{
					"ANTHROPIC_BASE_URL": base, "ANTHROPIC_AUTH_TOKEN": token, "ANTHROPIC_MODEL": model,
					"ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-5-5", "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5-5", "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-5-5",
					// Compact at 400k tokens instead of near the full 1M window.
					"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000",
				}}}}
		}},
	"codex": {Label: "Codex", Install: "npm install -g @openai/codex", Run: "codex", Test: "codex exec 'Say hi to Pool in five words'", Models: []string{"gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"},
		files: func(base, model, _ string) []configFile {
			return []configFile{{Path: "~/.codex/config.toml",
				TOMLTop: map[string]string{"model_provider": "pool", "model": model},
				TOMLBlock: "[model_providers.pool]\nname = \"Pool\"\nbase_url = \"" + base + "/v1\"\nwire_api = \"responses\"\n" +
					"auth = { command = \"cat\", args = [\"{TOKEN_FILE}\"] }\n"}}
		}},
	// T3 Code only shows usage; every setup script also adds it when T3 Code is installed.
	"t3": {Label: "T3 Code", files: func(string, string, string) []configFile { return nil }},
}

type setupCode struct {
	owner            Identity
	harness, model   string
	base             string
	expires          int64
	tokenID, tokenAt string
}

// Setups hands out single-use install scripts, so nobody copies a token by hand.
// Codes live in memory and are lost on restart, like pending account logins.
type Setups struct {
	Store *Store
	mu    sync.Mutex
	codes map[string]*setupCode
}

func (s *Setups) register(r *gin.Engine, g *gin.RouterGroup) {
	g.GET("/setup/harnesses", func(c *gin.Context) {
		out := map[string]any{}
		for id, h := range harnesses {
			if len(h.Models) == 0 {
				continue
			}
			files := map[string][]configFile{}
			for _, m := range h.Models {
				files[m] = h.files(baseURL(c), m, tokenPlaceholder)
			}
			out[id] = gin.H{"label": h.Label, "install": h.Install, "run": h.Run, "test": h.Test, "models": h.Models, "files": files}
		}
		c.JSON(http.StatusOK, out)
	})
	g.POST("/setup", func(c *gin.Context) {
		var body struct {
			Harness string `json:"harness"`
			Model   string `json:"model"`
		}
		if !bind(c, &body) {
			return
		}
		h, ok := harnesses[body.Harness]
		if !ok || !(slices.Contains(h.Models, body.Model) || len(h.Models) == 0 && body.Model == "") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown tool or model"})
			return
		}
		raw := make([]byte, 9)
		if _, err := rand.Read(raw); err != nil {
			respond(c, nil, err)
			return
		}
		code := base64.RawURLEncoding.EncodeToString(raw)
		expires := time.Now().Add(setupTTL).Unix()
		s.mu.Lock()
		if s.codes == nil {
			s.codes = map[string]*setupCode{}
		}
		for key, v := range s.codes {
			if v.tokenID == "" && time.Now().Unix() > v.expires {
				delete(s.codes, key)
			}
		}
		s.codes[code] = &setupCode{owner: member(c), harness: body.Harness, model: body.Model, base: baseURL(c), expires: expires}
		s.mu.Unlock()
		c.JSON(http.StatusCreated, gin.H{"code": code, "command": "curl -fsSL " + baseURL(c) + "/setup/" + code + " | sh", "expires_at": expires})
	})
	g.GET("/setup/:code", func(c *gin.Context) {
		s.mu.Lock()
		v := s.codes[c.Param("code")]
		var tokenID string
		if v != nil && v.owner.ID == member(c).ID {
			tokenID = v.tokenID
		} else {
			v = nil
		}
		s.mu.Unlock()
		if v == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		status := gin.H{"status": "waiting", "expires_at": v.expires}
		if tokenID == "" && time.Now().Unix() > v.expires {
			status["status"] = "expired"
		}
		if tokenID != "" {
			status["status"] = "installed"
			first, err := s.Store.FirstEvent(c.Request.Context(), tokenID)
			if err != nil {
				respond(c, nil, err)
				return
			}
			status["first"] = first
			// t3 turns true once T3 Code has read Pool usage with any of the member's tokens.
			if status["t3"], err = s.Store.UsesT3(c.Request.Context(), v.owner.ID); err != nil {
				respond(c, nil, err)
				return
			}
		}
		c.JSON(http.StatusOK, status)
	})
	// Public: the script fetch consumes the code, creates the token, and embeds it.
	r.GET("/setup/:code", func(c *gin.Context) {
		s.mu.Lock()
		v := s.codes[c.Param("code")]
		if v == nil || v.tokenID != "" || time.Now().Unix() > v.expires {
			s.mu.Unlock()
			c.String(http.StatusGone, "echo 'This Pool setup command expired or was already used. Get a new one from Quick Start.' >&2; exit 1\n")
			return
		}
		v.tokenID = "pending"
		s.mu.Unlock()
		h := harnesses[v.harness]
		t, secret, err := s.Store.CreateToken(c.Request.Context(), v.owner, h.Label+" · "+time.Now().UTC().Format("Jan 2"), 0)
		s.mu.Lock()
		if err != nil {
			v.tokenID = ""
		} else {
			v.tokenID = t.ID
		}
		s.mu.Unlock()
		if err != nil {
			log.WithError(err).Error("pool: create setup token")
			c.String(http.StatusInternalServerError, "echo 'Pool could not create a token. Try again.' >&2; exit 1\n")
			return
		}
		spec := ojson.NewDoc([]byte(`{}`))
		mode := "optional"
		if h.Run == "" {
			mode = "required"
		}
		if err = spec.Set("files", append(h.files(v.base, v.model, secret), t3Source(v.base, secret, mode))); err != nil {
			respond(c, nil, err)
			return
		}
		c.Header("Content-Type", "text/x-shellscript; charset=utf-8")
		c.String(http.StatusOK, setupScript(h, secret, base64.StdEncoding.EncodeToString(spec.Bytes())))
	})
}

// baseURL is the public origin; Cloudflare reports the client scheme in X-Forwarded-Proto and Cf-Visitor.
func baseURL(c *gin.Context) string {
	scheme := "http"
	if c.GetHeader("X-Forwarded-Proto") == "https" || strings.Contains(c.GetHeader("Cf-Visitor"), `"https"`) {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}

func setupScript(h harness, secret, spec string) string {
	// The T3 Code script only adds the usage source; it leaves the shared token file alone.
	if h.Run == "" {
		return fmt.Sprintf(`#!/bin/sh
# Pool usage for %[1]s. Generated once for you; this link no longer works.
set -eu
command -v python3 >/dev/null 2>&1 || { echo "Pool setup needs python3. Install it, then get a new command from the Pool home page." >&2; exit 1; }
umask 077
POOL_SPEC='%[2]s' python3 - <<'POOL_PY'
%[3]sPOOL_PY
`, h.Label, spec, mergeProgram)
	}
	return fmt.Sprintf(`#!/bin/sh
# Pool setup for %[1]s. Generated once for you; this link no longer works.
set -eu
command -v python3 >/dev/null 2>&1 || { echo "Pool setup needs python3. Install it, then get a new command from Quick Start." >&2; exit 1; }
umask 077
mkdir -p "$HOME/.config/pool"
printf '%%s' '%[2]s' > "$HOME/.config/pool/token"
POOL_SPEC='%[3]s' python3 - <<'POOL_PY'
%[4]sPOOL_PY
command -v %[5]s >/dev/null 2>&1 || echo "%[1]s is not installed yet. Install it with: %[6]s"
echo
echo "Pool is set up for %[1]s. Check it with:"
echo
echo "  %[7]s"
echo
echo "A short reply means it works, and the Quick Start page turns green."
echo "After that, start %[1]s as usual with: %[5]s"
`, h.Label, secret, spec, mergeProgram, h.Run, strings.ReplaceAll(h.Install, `"`, `\"`), h.Test)
}

// mergeProgram applies configFile specs. It backs up each file before writing it with mode 600.
const mergeProgram = `import base64, datetime, glob, json, os, plistlib, re, shutil
spec = json.loads(base64.b64decode(os.environ["POOL_SPEC"]))
token_file = os.path.expanduser("~/.config/pool/token")
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

# T3 Code keeps a hub URL's path from 0.1.3; its nightlies and previews sort below their release.
def t3_key(version):
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)(-?)", version)
    return (int(m[1]), int(m[2]), int(m[3]), 0 if m[4] else 1) if m else (0, 0, 0, 0)

def t3_version(home):
    # A running T3 Code records its version; otherwise take the newest installed copy.
    try:
        with open(os.path.join(home, "userdata", "server-runtime.json")) as handle:
            return str(json.load(handle)["serverVersion"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    found = []
    for app in glob.glob("/Applications/T3 Code*.app") + glob.glob(os.path.expanduser("~/Applications/T3 Code*.app")):
        try:
            with open(os.path.join(app, "Contents", "Info.plist"), "rb") as handle:
                found.append(str(plistlib.load(handle)["CFBundleShortVersionString"]))
        except (OSError, ValueError, KeyError):
            pass
    versions = os.path.join(home, "runtime", "versions")
    if os.path.isdir(versions):
        found += os.listdir(versions)
    return max(found, key=t3_key, default=None)

def t3_settings(required):
    home = os.environ.get("T3CODE_HOME") or os.path.expanduser("~/.t3")
    userdata = os.path.join(home, "userdata")
    problem = None
    version = t3_version(home)
    if not os.path.isdir(userdata):
        problem = "T3 Code is not set up on this computer. Install it and open it once, then get a new command from the Pool home page."
    elif version and t3_key(version) < (0, 1, 3, 1):
        problem = "T3 Code " + version + " is too old to show Pool usage. Update T3 Code to 0.1.3 or newer, then use \"See usage in T3 Code\" on the Pool home page."
    if problem and required:
        raise SystemExit(problem)
    if problem and version:
        print(problem)
    return None if problem else os.path.join(userdata, "settings.json")

def fill(v):
    if isinstance(v, str):
        return v.replace("{TOKEN_FILE}", token_file)
    if isinstance(v, dict):
        return {k: fill(x) for k, x in v.items()}
    if isinstance(v, list):
        return [fill(x) for x in v]
    return v

def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            merge(a[k], v)
        else:
            a[k] = v

for f in spec["files"]:
    path = os.path.expanduser(f["path"])
    if "t3" in f:
        path = t3_settings(f["t3"] == "required")
        if path is None:
            continue
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    text = ""
    if os.path.exists(path):
        with open(path) as handle:
            text = handle.read()
        shutil.copy2(path, path + ".pool-backup-" + stamp)
        print("Backed up", path)
    if "json" in f:
        data = json.loads(text) if text.strip() else {}
        if not isinstance(data, dict):
            raise SystemExit(path + " is not a JSON object. Nothing was changed.")
        for key in f.get("remove_env", []):
            data.get("env", {}).pop(key, None)
        merge(data, fill(f["json"]))
        text = json.dumps(data, indent=2) + "\n"
    else:
        block = fill(f["toml_block"])
        header = block.splitlines()[0]
        text = re.sub(r"(?ms)^" + re.escape(header) + r"\s*\n.*?(?=^\[|\Z)", "", text)
        first = re.search(r"(?m)^\[", text)
        top, rest = (text[:first.start()], text[first.start():]) if first else (text, "")
        for key, value in f["toml_top"].items():
            top = re.sub(r"(?m)^" + re.escape(key) + r"\s*=.*\n?", "", top)
            top = key + " = " + json.dumps(value) + "\n" + top
        text = (top + rest).rstrip("\n") + "\n\n" + block
    temporary = path + ".pool-tmp"
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
        handle.write(text)
    os.replace(temporary, path)
    print("Wrote", path)
    if "t3" in f:
        print("T3 Code now shows Pool's accounts on its Usage page.")
`
