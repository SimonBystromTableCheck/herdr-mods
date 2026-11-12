#!/usr/bin/env python3
"""Backend for Herdr's Claude panel: cvm (versions), cvp (profiles), agent-router/keepalive.

Every command prints one JSON object: {"ok": true, ...} or {"ok": false, "error": "..."}.
Secrets never leave this script: profiles report only whether a key is set.
Everything personal lives on this machine, under ~/.cvm (never in the mod folder):
  ~/.cvm/herdr/pond-profiles.json display names, usage settings, setup state
  ~/.cvm/herdr/tokens/            gateway sign-in tokens (0600)

  status <dir>                    local state (no network)
  doctor                          what setup still needs (asks the login shell)
  setup <cvm|path|claude|cvp|router|done|reopen>
  remote                          latest versions upstream (network)
  use <profile>                   global profile (cvm profile use)
  profile-add <file>              create/replace a profile from a JSON file (then deleted; holds the key)
  profile-remove <profile>        delete a profile (not the active one)
  profile-label <profile> <label> display name ("" resets it)
  pin-profile <dir> <name|->      .claude-profile in <dir> (- removes it)
  pin-version <dir> <ver|->       .claude-version in <dir> (- removes it)
  install <ver|latest> [--use]    cvm install (and make it the global version)
  use-version <ver>               cvm use
  uninstall <ver>                 cvm uninstall
  update <claude|cvm|cvp|agent-router|keepalive>
  set-key <profile> <file>        read the key from <file> (then deleted) into the profile
  models <profile>                the profile's gateway catalog (GET /v1/models)
  router                          agent-router + keepalive options (claude plugin configure --json)
  router-set <plugin> <json>      save options (claude plugin configure --values-stdin)
  install-hook                    (re)install the terminal-labelling env.d hook
  usage <profile>                 this profile's usage, as set up with usage-setup
  usage-detect <profile>          suggest a usage setup (claude.ai plan, or the gateway's API)
  usage-setup <profile> <json>    {"kind": "plan"} or {"kind": "gateway", "url", "budgetUrl"?, "auth": "device"|"key", "device"?}
  usage-remove <profile>
  gateway-login <profile>         start the gateway's device sign-in (RFC 8628): user code + URL
  gateway-poll <profile>          finish it once approved in the browser (pending / done / expired)
  gateway-logout <profile>        forget the gateway token
"""
import base64, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HOME = os.path.expanduser("~")
CVM_DIR = os.environ.get("CVM_DIR", f"{HOME}/.cvm")
CVM = f"{CVM_DIR}/bin/cvm"
CLAUDE = f"{CVM_DIR}/bin/claude"
PROFILES = f"{CVM_DIR}/profiles"
CVP_DIR = f"{CVM_DIR}/plugins/cvp"
HOOK = f"{CVM_DIR}/env.d/zz-herdr.sh"
HOOK_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "herdr-label.sh")
LOCAL = f"{CVM_DIR}/herdr"
CONFIG = f"{LOCAL}/pond-profiles.json"
OLD_CONFIG = f"{LOCAL}/claude-panel.json"
TOKENS = f"{LOCAL}/tokens"
OLD_TOKENS = f"{CVM_DIR}/herdr-tokens"
MARKET = "agent-router-tools"
MARKET_REPO = "alexandernicholson/agent-router"
PLUGINS = ["agent-router", "keepalive"]
RAW = "https://raw.githubusercontent.com/alexandernicholson"
SECRET_KEYS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN")
PLACEHOLDER = re.compile(r"^(|PASTE.*|<.*>)$")
NAME_RE = r"[A-Za-z0-9._-]+"
SETTINGS = f"{HOME}/.claude/settings.json"
PATH_MARK = "# Added by Herdr's Claude panel: cvm's claude first on PATH"

# Herdr's exec may start without the login shell's PATH: cvm and its claude wrapper go first.
ENV = dict(os.environ)
ENV["PATH"] = f"{CVM_DIR}/bin:" + ENV.get("PATH", "/usr/bin:/bin")
for k in ("CVM_PROFILE", "CVM_VERSION", "CLAUDECODE"):
    ENV.pop(k, None)
# cvp would copy the global profile into ~/.claude/settings.json, and Claude applies that file
# to RUNNING sessions (new URL, old key) and never drops removed vars. Profiles reach each
# session only at launch instead (the env.d shim), so a switch leaves running sessions alone.
ENV["CVP_NO_SETTINGS_SYNC"] = "1"
SETTINGS_LEDGER = f"{PROFILES}/.settings-managed"
OWN_SETTINGS = ("DISABLE_AUTOUPDATER", "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS")  # set by this panel's setup


def out(**kw):
    print(json.dumps({"ok": True, **kw}))
    sys.exit(0)


def fail(msg, **kw):
    print(json.dumps({"ok": False, "error": str(msg).strip()[-600:], **kw}))
    sys.exit(0)


def read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


def read_json(path):
    try:
        return json.loads(read(path) or "null")
    except ValueError:
        return None


def write_private(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    old = os.umask(0o077)
    try:
        with open(path + ".tmp", "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data, indent=1))
        os.replace(path + ".tmp", path)
    finally:
        os.umask(old)


def take_file(src):
    """Read a hand-off file the panel wrote (it may hold a secret) and delete it."""
    try:
        return read(src)
    finally:
        if os.path.isfile(src):
            os.remove(src)


def strip_ansi(s):
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", s or "")


def sh(args, cwd=None, stdin=None, timeout=600):
    try:
        r = subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True, env=ENV, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, f"{args[0]} timed out"
    except OSError as e:
        return 127, str(e)
    return r.returncode, strip_ansi((r.stdout or "") + (r.stderr or "")).strip()


def run_or_fail(args, cwd=None, stdin=None, timeout=600):
    code, text = sh(args, cwd, stdin, timeout)
    if code != 0:
        fail(text or f"{os.path.basename(args[0])} exited {code}")
    return text


def semver_key(v):
    return [int(x) if x.isdigit() else 0 for x in re.split(r"[.\-+]", v)]


def var_in(text, name):
    m = re.search(rf'^{name}="?([^"\n]+)"?', text or "", re.M)
    return m.group(1).strip() if m else None


def parse_env(path):
    vals = {}
    for line in (read(path) or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        vals[k.strip()] = v
    return vals


def walk_up(start, name):
    d = os.path.abspath(start or HOME)
    while True:
        p = os.path.join(d, name)
        if os.path.isfile(p):
            v = (read(p) or "").strip()
            if v:
                return {"value": v, "file": p, "dir": d}
        if d == "/":
            return None
        d = os.path.dirname(d)


def repo_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return d
        if d in ("/", HOME):
            return os.path.abspath(start)
        d = os.path.dirname(d)


# ---- Local panel settings ---------------------------------------------------------

def config():
    if os.path.isdir(OLD_TOKENS):  # tokens moved under ~/.cvm/herdr/
        os.makedirs(TOKENS, mode=0o700, exist_ok=True)
        for f in os.listdir(OLD_TOKENS):
            os.replace(f"{OLD_TOKENS}/{f}", f"{TOKENS}/{f}")
        os.rmdir(OLD_TOKENS)
    if os.path.isfile(OLD_CONFIG) and not os.path.isfile(CONFIG):  # the mod was called "claude"
        os.replace(OLD_CONFIG, CONFIG)
    c = read_json(CONFIG)
    c = c if isinstance(c, dict) else {}
    for k in ("labels", "usage", "setup", "accounts"):
        c.setdefault(k, {})
    return c


def save_config(c):
    write_private(CONFIG, c)
    os.chmod(LOCAL, 0o700)


def label_of(c, name):
    return c["labels"].get(name) or (name[:1].upper() + name[1:] if name else "?")


# ---- State -----------------------------------------------------------------------

def need_profile(name):
    if not re.fullmatch(NAME_RE, name or "") or not os.path.isfile(f"{PROFILES}/{name}.env"):
        fail(f"No profile named {name!r}")


def profiles(c=None):
    c = c or config()
    res = []
    for f in sorted(os.listdir(PROFILES)) if os.path.isdir(PROFILES) else []:
        if not f.endswith(".env") or f.startswith("."):
            continue
        name, vals = f[:-4], parse_env(f"{PROFILES}/{f}")
        key = next((vals[k] for k in SECRET_KEYS if k in vals), None)
        res.append({
            "name": name, "label": label_of(c, name),
            "gateway": vals.get("ANTHROPIC_BASE_URL"),
            "keyVar": next((k for k in SECRET_KEYS if k in vals), None),
            "hasKey": key is not None and not PLACEHOLDER.match(key),
            "vars": sorted(k for k in vals if k not in SECRET_KEYS and k != "ANTHROPIC_BASE_URL"),
            "usage": (c["usage"].get(name) or {}).get("kind"),
        })
    return res


def global_profile():
    return (read(f"{CVM_DIR}/active-profile") or "").strip() or None


def plugin_state():
    installed = (read_json(f"{HOME}/.claude/plugins/installed_plugins.json") or {}).get("plugins", {})
    enabled = (read_json(SETTINGS) or {}).get("enabledPlugins", {})
    res = {}
    for name in PLUGINS:
        pid = f"{name}@{MARKET}"
        rec = (installed.get(pid) or [{}])[0]
        res[name] = {"id": pid, "version": rec.get("version"), "enabled": bool(enabled.get(pid))}
    return res


def installed_versions():
    d = f"{CVM_DIR}/versions"
    return sorted((v for v in os.listdir(d) if os.path.isfile(f"{d}/{v}/claude")), key=semver_key, reverse=True) \
        if os.path.isdir(d) else []


def unsync_settings():
    """Take back what cvp copied into ~/.claude/settings.json (it does again when someone runs
    `cvm profile use` in a terminal), keeping the vars this panel's setup owns. Running sessions
    keep what they already loaded; new ones get their profile from the launch shim alone."""
    managed = [l.strip() for l in (read(SETTINGS_LEDGER) or "").splitlines() if l.strip()]
    if not managed:
        return
    s = read_json(SETTINGS)
    if isinstance(s, dict) and isinstance(s.get("env"), dict):
        router = all(v["version"] for v in plugin_state().values())
        keep = {k for k in OWN_SETTINGS if k != "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS" or router}
        env = {k: v for k, v in s["env"].items() if k not in managed or k in keep}
        if env != s["env"]:
            if env:
                s["env"] = env
            else:
                s.pop("env")
            with open(SETTINGS + ".tmp", "w") as f:
                json.dump(s, f, indent=2)
                f.write("\n")
            os.replace(SETTINGS + ".tmp", SETTINGS)
    os.remove(SETTINGS_LEDGER)


def settings_gateway():
    """A gateway URL in ~/.claude/settings.json overrides every session's launch profile."""
    return ((read_json(SETTINGS) or {}).get("env") or {}).get("ANTHROPIC_BASE_URL")


def cmd_status(cwd=None):
    unsync_settings()
    c = config()
    cvm_text = read(CVM)
    gprof = global_profile()
    lprof = walk_up(cwd, ".claude-profile") if cwd else None
    lver = walk_up(cwd, ".claude-version") if cwd else None
    profs = profiles(c)
    gw = {p["name"]: bool(p["gateway"]) for p in profs}
    # Other mods (the tab bar, the agents list) read names and kinds from here.
    accounts = {p["name"]: {"label": p["label"], "gateway": bool(p["gateway"])} for p in profs}
    if accounts != c["accounts"]:
        c["accounts"] = accounts
        save_config(c)
    # A gateway URL left in ~/.claude/settings.json wins over the launch environment, so a
    # folder pin to a gateway-less profile is ignored while one is there.
    pin_ignored = bool(lprof and not gw.get(lprof["value"]) and settings_gateway())
    versions = installed_versions()
    out(
        cvm={"installed": cvm_text is not None, "version": var_in(cvm_text, "CVM_SELF_VERSION")},
        cvp={"installed": os.path.isfile(f"{CVP_DIR}/plugin.sh"),
             "version": var_in(read(f"{CVP_DIR}/plugin.sh"), "CVM_PLUGIN_VERSION")},
        claude={"global": (read(f"{CVM_DIR}/version") or "").strip() or None, "installed": versions, "local": lver},
        profiles=profs, active=gprof, local=lprof, pinIgnored=pin_ignored,
        root=repo_root(cwd) if cwd else None,
        localMissing=bool(lprof and lprof["value"] not in gw),
        effective=(gprof if pin_ignored else (lprof or {}).get("value") or gprof),
        plugins=plugin_state(),
        hook=os.path.isfile(HOOK) and read(HOOK) == read(HOOK_SRC),
        setup={"done": bool(c["setup"].get("done")), "routerSkipped": bool(c["setup"].get("routerSkipped")),
               "basics": bool(cvm_text and versions and (read(f"{CVM_DIR}/version") or "").strip()
                              and os.path.isfile(f"{CVP_DIR}/plugin.sh"))},
    )


# ---- Setup ------------------------------------------------------------------------

def user_shell():
    return os.environ.get("SHELL") or "/bin/zsh"


def rc_file():
    s = os.path.basename(user_shell())
    return {"zsh": f"{HOME}/.zshrc", "bash": f"{HOME}/.bashrc",
            "fish": f"{HOME}/.config/fish/config.fish"}.get(s, f"{HOME}/.profile")


def shell_line(cmd):
    """What `cmd` prints in an interactive login shell (where agents start), ignoring the
    noise shell startup files print: the answer is marked."""
    mark = "__herdr__"
    # A clean environment, as a new terminal starts: this script's own PATH must not leak in.
    clean = {k: os.environ[k] for k in ("HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR") if k in os.environ}
    clean.update(PATH="/usr/bin:/bin:/usr/sbin:/sbin", TERM="xterm-256color")
    try:
        r = subprocess.run([user_shell(), "-lic", f'printf "{mark}%s\\n" "$({cmd})"'], capture_output=True,
                           text=True, env=clean, timeout=20, stdin=subprocess.DEVNULL)
    except (subprocess.TimeoutExpired, OSError):
        return None
    hits = [l[len(mark):].strip() for l in (r.stdout or "").splitlines() if l.startswith(mark)]
    return hits[-1] or None if hits else None


def cmd_doctor():
    c = config()
    claude_path = shell_line("command -v claude")
    node = shell_line("node --version")
    node_major = int(m.group(1)) if node and (m := re.match(r"v(\d+)", node)) else None
    versions = installed_versions()
    profs = profiles(c)
    out(
        shell=user_shell(), rc=rc_file(),
        cvm=os.path.isfile(CVM),
        path={"ok": claude_path == CLAUDE, "claude": claude_path},
        claude={"ok": bool(versions) and bool((read(f"{CVM_DIR}/version") or "").strip()), "installed": versions},
        cvp=os.path.isfile(f"{CVP_DIR}/plugin.sh"),
        profiles=[{"name": p["name"], "label": p["label"], "gateway": p["gateway"], "hasKey": p["hasKey"]} for p in profs],
        router={"installed": all(v["version"] for v in plugin_state().values()), "node": node,
                "nodeOk": bool(node_major and node_major >= 22), "git": shutil.which("git") is not None},
        setup=c["setup"],
    )


def merge_settings_env(values):
    s = read_json(SETTINGS)
    s = s if isinstance(s, dict) else {}
    if os.path.isfile(SETTINGS) and not os.path.isfile(SETTINGS + ".herdr-backup"):
        shutil.copy2(SETTINGS, SETTINGS + ".herdr-backup")
    s.setdefault("env", {}).update(values)
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    with open(SETTINGS + ".tmp", "w") as f:
        json.dump(s, f, indent=2)
        f.write("\n")
    os.replace(SETTINGS + ".tmp", SETTINGS)


def setup_cvm():
    # What cvm's install.sh does, minus its interactive prompt (PATH is the next step).
    try:
        text = fetch(f"{RAW}/cvm/main/cvm.sh", timeout=30)
    except Exception as e:  # noqa: BLE001
        fail(f"Download failed: {e}")
    if not text.startswith("#!") or "bash" not in text.splitlines()[0] or "CVM_SELF_VERSION" not in text:
        fail("The download doesn't look like cvm")
    os.makedirs(os.path.dirname(CVM), exist_ok=True)
    with open(CVM + ".tmp", "w") as f:
        f.write(text)
    os.chmod(CVM + ".tmp", 0o755)
    os.replace(CVM + ".tmp", CVM)
    out(version=var_in(text, "CVM_SELF_VERSION"))


def setup_path():
    rc = rc_file()
    fish = rc.endswith("config.fish")
    line = "fish_add_path -m $HOME/.cvm/bin" if fish else 'export PATH="$HOME/.cvm/bin:$PATH"'
    text = read(rc) or ""
    # Appended last, so it is prepended last: ahead of any other claude on PATH.
    if not text.rstrip().endswith(line):
        os.makedirs(os.path.dirname(rc), exist_ok=True)
        with open(rc, "a") as f:
            f.write(f"\n{PATH_MARK}\n{line}\n")
    found = shell_line("command -v claude")
    out(rc=rc, claude=found, ok=found == CLAUDE)


def setup_claude():
    if not os.path.isfile(CVM):
        fail("Install cvm first")
    v = resolved("latest")
    run_or_fail([CVM, "install", v])
    run_or_fail([CVM, "use", v])
    # Claude's own updater would keep updating a separate install; cvm handles versions now.
    merge_settings_env({"DISABLE_AUTOUPDATER": "1"})
    out(version=v)


def setup_cvp():
    if not os.path.isfile(CVM):
        fail("Install cvm first")
    if not os.path.isfile(f"{CVP_DIR}/plugin.sh"):
        run_or_fail([CVM, "plugin", "install", "alexandernicholson/cvp"])
    run_or_fail([CVM, "profile", "apply"])
    cmd_install_hook(quiet=True)
    out(profiles=[p["name"] for p in profiles()])


def setup_router():
    if not installed_versions():
        fail("Install a Claude version first")
    code, known = sh([CLAUDE, "plugin", "marketplace", "list"], timeout=60)
    if MARKET not in known:
        run_or_fail([CLAUDE, "plugin", "marketplace", "add", MARKET_REPO])
    for p in PLUGINS:
        if not plugin_state()[p]["version"]:
            run_or_fail([CLAUDE, "plugin", "install", f"{p}@{MARKET}"])
    merge_settings_env({"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"})  # both plugins need function hooks
    c = config()
    c["setup"].pop("routerSkipped", None)
    save_config(c)
    out()


def cmd_setup(step):
    if step == "cvm":
        setup_cvm()
    if step == "path":
        setup_path()
    if step == "claude":
        setup_claude()
    if step == "cvp":
        setup_cvp()
    if step == "router":
        setup_router()
    if step in ("done", "reopen", "skip-router"):
        c = config()
        if step == "skip-router":
            c["setup"]["routerSkipped"] = True
        else:
            c["setup"]["done"] = step == "done"
        save_config(c)
        out()
    fail(f"Unknown setup step {step!r}")


# ---- Profiles ---------------------------------------------------------------------

def env_line(k, v):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) or "\n" in v or "'" in v:
        fail(f"Can't store {k}")
    return f"{k}='{v}'"


def cmd_profile_add(src):
    raw = take_file(src)
    try:
        spec = json.loads(raw or "")
    except ValueError:
        fail("Unreadable profile")
    name = (spec.get("name") or "").strip()
    if not re.fullmatch(NAME_RE, name):
        fail("Name: letters, digits, . _ - only")
    path = f"{PROFILES}/{name}.env"
    if os.path.isfile(path) and not spec.get("replace"):
        fail(f"A profile named {name} already exists")
    base = (spec.get("base") or "").strip().rstrip("/")
    if base and not re.match(r"^https://|^http://(localhost|127\.0\.0\.1|\[::1\])", base):
        fail("The gateway URL must be https:// (or http://localhost)")
    key = (spec.get("key") or "").strip()
    if base and not key:
        fail("A gateway profile needs a key")
    key_var = spec.get("keyVar") if spec.get("keyVar") in SECRET_KEYS else "ANTHROPIC_API_KEY"
    lines = [f"# Profile: {name}", "# Made in Herdr's Claude panel; edit with: cvm profile edit " + name]
    if base:
        lines.append(env_line("ANTHROPIC_BASE_URL", base))
        lines.append(env_line(key_var, key))
        # The gateway's key outranks the claude.ai login, so claude.ai connectors can't load;
        # this skips the notice Claude shows about that on every start.
        lines.append(env_line("ENABLE_CLAUDEAI_MCP_SERVERS", "0"))
    for k, v in (spec.get("vars") or {}).items():
        lines.append(env_line(k, str(v)))
    write_private(path, "\n".join(lines) + "\n")
    os.chmod(path, 0o600)
    run_or_fail([CVM, "profile", "apply"])  # records the vars cvp manages
    c = config()
    if spec.get("label"):
        c["labels"][name] = spec["label"].strip()[:40]
    save_config(c)
    out(name=name)


def cmd_profile_remove(name):
    need_profile(name)
    if name == global_profile():
        fail("Switch to another account before removing this one")
    run_or_fail([CVM, "profile", "remove", name])
    c = config()
    for k in ("labels", "usage", "accounts"):
        c[k].pop(name, None)
    save_config(c)
    for suffix in (".json", ".device.json"):
        if os.path.isfile(f"{TOKENS}/{name}{suffix}"):
            os.remove(f"{TOKENS}/{name}{suffix}")
    out()


def cmd_profile_label(name, label):
    need_profile(name)
    c = config()
    if label.strip():
        c["labels"][name] = label.strip()[:40]
    else:
        c["labels"].pop(name, None)
    save_config(c)
    out()


def cmd_use(name):
    need_profile(name)
    run_or_fail([CVM, "profile", "use", name])
    out(active=global_profile())


def cmd_pin_profile(d, name):
    if name == "-":
        run_or_fail([CVM, "profile", "local", "--unset"], cwd=d)
    else:
        need_profile(name)
        run_or_fail([CVM, "profile", "local", name], cwd=d)
    out()


def cmd_set_key(name, src):
    need_profile(name)
    key = (take_file(src) or "").strip()
    if not key or "\n" in key or "'" in key:
        fail("That doesn't look like a key")
    path = f"{PROFILES}/{name}.env"
    text = read(path) or ""
    var = next((k for k in SECRET_KEYS if re.search(rf"^{k}=", text, re.M)), "ANTHROPIC_API_KEY")
    line = f"{var}='{key}'"
    text = re.sub(rf"^{var}=.*$", lambda _m: line, text, flags=re.M) if re.search(rf"^{var}=", text, re.M) \
        else text.rstrip("\n") + "\n" + line + "\n"
    write_private(path, text)
    os.chmod(path, 0o600)
    out()


# ---- Versions and updates ---------------------------------------------------------

def fetch(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "herdr-pond-profiles", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()


def dist_base():
    return var_in(read(CVM), "CVM_DIST_BASE")


def cmd_remote():
    dist = dist_base()
    jobs = {
        "cvm": lambda: var_in(fetch(f"{RAW}/cvm/main/cvm.sh"), "CVM_SELF_VERSION"),
        "cvp": lambda: var_in(fetch(f"{RAW}/cvp/main/plugin.sh"), "CVM_PLUGIN_VERSION"),
        **{p: (lambda p=p: json.loads(fetch(f"{RAW}/agent-router/main/{p}/.claude-plugin/plugin.json"))["version"])
           for p in PLUGINS},
    }
    if dist:
        jobs["claude"] = lambda: fetch(f"{dist}/latest").strip()
        jobs["claudeStable"] = lambda: fetch(f"{dist}/stable").strip()
    latest, errors = {}, {}
    with ThreadPoolExecutor(len(jobs)) as pool:
        futures = {k: pool.submit(f) for k, f in jobs.items()}
        for k, fut in futures.items():
            try:
                latest[k] = fut.result()
            except Exception as e:  # noqa: BLE001 - reported per item
                latest[k], errors[k] = None, str(e)
    out(latest=latest, errors=errors)


def need_version(v):
    if not re.fullmatch(r"v?\d+\.\d+\.\d+([.\-+][0-9A-Za-z.\-]+)?|latest|stable", v or ""):
        fail(f"Not a version: {v!r}")


def cmd_pin_version(d, v):
    if v == "-":
        p = os.path.join(d, ".claude-version")
        if os.path.isfile(p):
            os.remove(p)
    else:
        need_version(v)
        run_or_fail([CVM, "local", v], cwd=d)
    out()


def resolved(spec):
    if spec in ("latest", "stable"):
        try:
            return fetch(f"{dist_base()}/{spec}").strip()
        except Exception as e:  # noqa: BLE001
            fail(f"Could not resolve {spec}: {e}")
    return spec.lstrip("v")


def cmd_install(spec, use=False):
    need_version(spec)
    v = resolved(spec)
    log = run_or_fail([CVM, "install", v])
    if use:
        log += "\n" + run_or_fail([CVM, "use", v])
    out(version=v, log=log[-800:])


def cmd_use_version(v):
    need_version(v)
    run_or_fail([CVM, "use", v.lstrip("v")])
    out()


def cmd_uninstall(v):
    need_version(v)
    run_or_fail([CVM, "uninstall", v.lstrip("v")])
    out()


def cmd_update(target):
    if target == "claude":
        cmd_install("latest", use=True)
    if target == "cvm":
        out(log=run_or_fail([CVM, "self-update"])[-800:])
    if target == "cvp":
        out(log=run_or_fail([CVM, "plugin", "update", "cvp"])[-800:])
    if target in PLUGINS:
        log = run_or_fail([CLAUDE, "plugin", "marketplace", "update", MARKET])
        log += "\n" + run_or_fail([CLAUDE, "plugin", "update", f"{target}@{MARKET}"])
        out(log=log[-800:])
    fail(f"Unknown update target {target!r}")


# ---- Agent router -----------------------------------------------------------------

def cmd_models(name):
    need_profile(name)
    vals = parse_env(f"{PROFILES}/{name}.env")
    base = vals.get("ANTHROPIC_BASE_URL")
    if not base:
        fail(f"{name} has no gateway URL")
    try:
        data = json.loads(fetch(f"{base.rstrip('/')}/v1/models?limit=1000", key_headers(vals), timeout=15))
    except Exception as e:  # noqa: BLE001
        fail(f"Model list failed: {e}")
    out(models=[{"id": m["id"], "name": m.get("display_name") or m["id"], "context": m.get("max_input_tokens")}
                for m in data.get("data", [])])


def key_headers(vals):
    h = {"anthropic-version": "2023-06-01"}
    if vals.get("ANTHROPIC_API_KEY"):
        h["x-api-key"] = vals["ANTHROPIC_API_KEY"]
    elif vals.get("ANTHROPIC_AUTH_TOKEN"):
        h["Authorization"] = f"Bearer {vals['ANTHROPIC_AUTH_TOKEN']}"
    return h


def configure(plugin):
    code, text = sh([CLAUDE, "plugin", "configure", f"{plugin}@{MARKET}", "--json"], timeout=60)
    if code != 0:
        return {"error": text or f"exit {code}"}
    try:
        d = json.loads(text[text.index("{"):])
    except ValueError:
        return {"error": "Unreadable plugin options"}
    opts = {k: {"title": s.get("title", k), "options": s.get("options"), "default": s.get("default")}
            for k, s in d.get("schema", {}).items()}
    return {"values": d.get("inputs", {}), "schema": opts}


def cmd_router():
    if not all(v["version"] for v in plugin_state().values()):
        out(installed=False)
    with ThreadPoolExecutor(2) as pool:
        res = dict(zip(PLUGINS, pool.map(configure, PLUGINS)))
    out(installed=True, **{p.replace("-", "_"): r for p, r in res.items()})


def cmd_router_set(plugin, values):
    if plugin not in PLUGINS:
        fail(f"Unknown plugin {plugin!r}")
    try:
        vals = json.loads(values)
        assert isinstance(vals, dict) and all(isinstance(v, str) and "\n" not in v for v in vals.values())
    except (ValueError, AssertionError):
        fail("Options must be a JSON object of single-line strings")
    run_or_fail([CLAUDE, "plugin", "configure", f"{plugin}@{MARKET}", "--values-stdin"], stdin=json.dumps(vals))
    out()


# ---- Usage ------------------------------------------------------------------------

KEYCHAIN_ITEM = "Claude Code-credentials"
PLAN_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"


def limit_label(lim):
    scope = lim.get("scope") or {}
    model = (scope.get("model") or {}).get("display_name")
    surface = scope.get("surface")
    if lim.get("kind") == "session":
        return "Current session"
    if lim.get("kind") == "weekly_all":
        return "All models"
    return " · ".join(x for x in (model, surface if isinstance(surface, str) else None) if x) or lim.get("kind", "Limit")


def claude_login_token():
    if sys.platform == "darwin":
        code, raw = sh(["security", "find-generic-password", "-s", KEYCHAIN_ITEM, "-w"], timeout=15)
        raw = raw if code == 0 else None
    else:
        raw = read(f"{HOME}/.claude/.credentials.json")
    try:
        return json.loads(raw)["claudeAiOauth"] if raw else None
    except (ValueError, KeyError):
        return None


def plan_usage():
    # Claude Code's own claude.ai login. Read only: refreshing would rotate the token Claude uses.
    oauth = claude_login_token()
    if not oauth:
        fail("No claude.ai login found: run claude and /login.", kind="plan")
    req = urllib.request.Request(PLAN_USAGE_URL, headers={
        "Authorization": f"Bearer {oauth['accessToken']}", "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "herdr-pond-profiles"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            fail("The claude.ai login has expired: start claude once to refresh it.", kind="plan", expired=True)
        fail(f"Usage request failed (HTTP {e.code})", kind="plan")
    except Exception as e:  # noqa: BLE001
        fail(f"Usage request failed: {e}", kind="plan", timedOut="timed out" in str(e))
    limits = d.get("limits")
    if not isinstance(limits, list):  # older shape
        limits = [{"kind": "session" if k == "five_hour" else "weekly_all", "group": g,
                   "percent": (d.get(k) or {}).get("utilization"), "resets_at": (d.get(k) or {}).get("resets_at")}
                  for k, g in (("five_hour", "session"), ("seven_day", "weekly")) if d.get(k)]
    extra = d.get("extra_usage") or {}
    out(kind="plan", configured=True, subscription=oauth.get("subscriptionType"), limits=[{
        "label": limit_label(x), "group": x.get("group"), "percent": x.get("percent"),
        "severity": x.get("severity") or "normal", "resetsAt": x.get("resets_at"), "active": bool(x.get("is_active")),
    } for x in limits if x.get("percent") is not None],
        extra={"enabled": bool(extra.get("is_enabled")), "used": extra.get("used_credits"), "limit": extra.get("monthly_limit"),
               "currency": extra.get("currency"), "utilization": extra.get("utilization")})


def origin_of(url):
    m = re.match(r"^(https?://[^/]+)", url or "")
    return m.group(1) if m else None


def get_json(url, headers):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "herdr-pond-profiles", **headers})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def usage_headers(name, u):
    if u.get("auth") == "device":
        tok = read_json(f"{TOKENS}/{name}.json")
        if not tok or (tok.get("expires") and time.time() > tok["expires"]):
            return None, bool(tok)
        return {"Authorization": f"Bearer {tok['access_token']}"}, False
    vals = parse_env(f"{PROFILES}/{name}.env")
    key = next((vals[k] for k in SECRET_KEYS if vals.get(k)), None)
    return ({"Authorization": f"Bearer {key}", "x-api-key": key} if key else None), False


def gateway_usage(name, u):
    headers, expired = usage_headers(name, u)
    if headers is None:
        out(kind="gateway", configured=True, auth=u.get("auth"), signedIn=False, expired=expired)
    try:
        usage = get_json(u["url"], headers)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and u.get("auth") == "device":
            out(kind="gateway", configured=True, auth="device", signedIn=False, expired=True)
        fail(f"Usage request failed (HTTP {e.code})", kind="gateway", configured=True, auth=u.get("auth"))
    except Exception as e:  # noqa: BLE001
        fail(f"Usage request failed: {e}", kind="gateway", configured=True, auth=u.get("auth"),
             timedOut="timed out" in str(e))
    budget = None
    if u.get("budgetUrl"):
        try:
            budget = get_json(u["budgetUrl"], headers)
        except Exception:  # noqa: BLE001 - optional
            budget = None
    out(kind="gateway", configured=True, auth=u.get("auth"), signedIn=True, usage=usage, budget=budget)


def cmd_usage(name):
    need_profile(name)
    u = config()["usage"].get(name)
    if not u:
        out(kind="none", configured=False)
    if u.get("kind") == "plan":
        plan_usage()
    gateway_usage(name, u)


def cmd_usage_detect(name):
    need_profile(name)
    base = parse_env(f"{PROFILES}/{name}.env").get("ANTHROPIC_BASE_URL")
    if not base:
        out(suggest={"kind": "plan"}, login=claude_login_token() is not None)
    origin = origin_of(base)
    paths, found = {}, []
    # A gateway that publishes an OpenAPI description shows where its usage API is.
    for url in (f"{origin}/openapi.json", f"{base.rstrip('/')}/openapi.json"):
        try:
            paths = json.loads(fetch(url, timeout=10)).get("paths", {})
            found.append(url)
            break
        except Exception:  # noqa: BLE001
            continue
    get_paths = [p for p, ops in paths.items() if isinstance(ops, dict) and "get" in ops and "{" not in p]
    pick = lambda pats: next((p for pat in pats for p in get_paths if re.search(pat, p)), None)  # noqa: E731
    usage = pick([r"/me/usage$", r"/usage/me$", r"/me/.*usage"])
    budget = pick([r"/me/budget$", r"/me/spend$"])
    device = next((p for p in paths if re.search(r"/oauth/device$", p)), None)
    try:  # or an OIDC/OAuth discovery document that names it
        meta = json.loads(fetch(f"{origin}/.well-known/openid-configuration", timeout=10))
        device = device or meta.get("device_authorization_endpoint")
    except Exception:  # noqa: BLE001
        pass
    out(suggest={"kind": "gateway", "url": f"{origin}{usage}" if usage else "",
                 "budgetUrl": f"{origin}{budget}" if budget else "",
                 "auth": "device" if device else "key",
                 "device": (device if str(device).startswith("http") else f"{origin}{device}") if device else ""},
        apiDescription=found[0] if found else None)


def cmd_usage_setup(name, spec):
    need_profile(name)
    try:
        u = json.loads(spec)
    except ValueError:
        fail("Unreadable usage settings")
    if u.get("kind") == "plan":
        u = {"kind": "plan"}
    elif u.get("kind") == "gateway":
        for k in ("url", "budgetUrl", "device"):
            if u.get(k) and not re.match(r"^https?://", u[k]):
                fail(f"{k} must be a full URL")
        if not u.get("url"):
            fail("The usage URL is required")
        if u.get("auth") not in ("device", "key"):
            fail("Sign-in must be device or key")
        if u["auth"] == "device" and not u.get("device"):
            u["device"] = f"{origin_of(u['url'])}/oauth/device"
        u = {k: u.get(k) or "" for k in ("kind", "url", "budgetUrl", "auth", "device")}
    else:
        fail("kind must be plan or gateway")
    c = config()
    c["usage"][name] = u
    save_config(c)
    out()


def cmd_usage_remove(name):
    c = config()
    c["usage"].pop(name, None)
    save_config(c)
    out()


def jwt_exp(token):
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))).get("exp")
    except (IndexError, ValueError):
        return None


def post_form(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST",
                                 headers={"User-Agent": "herdr-pond-profiles", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def device_settings(name):
    need_profile(name)
    u = config()["usage"].get(name) or {}
    if u.get("auth") != "device" or not u.get("device"):
        fail("This profile's usage doesn't use a device sign-in")
    return u["device"]


def cmd_gateway_login(name):
    url = device_settings(name)
    status, d = post_form(url, {"scope": "openid profile email", "client_id": "herdr"})
    if status != 200 or "device_code" not in d:
        fail(d.get("detail") or d.get("error") or f"Sign-in request failed (HTTP {status})")
    write_private(f"{TOKENS}/{name}.device.json", {"device_code": d["device_code"], "token": url.rstrip("/") + "/token",
                                                   "expires": time.time() + int(d.get("expires_in", 600))})
    out(userCode=d.get("user_code"), url=d.get("verification_uri_complete") or d.get("verification_uri"),
        expiresIn=d.get("expires_in"), interval=d.get("interval", 5))


def cmd_gateway_poll(name):
    path = f"{TOKENS}/{name}.device.json"
    dev = read_json(path)
    if not dev:
        out(status="none")
    if time.time() > dev.get("expires", 0):
        os.remove(path)
        out(status="expired")
    status, d = post_form(dev["token"], {"grant_type": DEVICE_GRANT, "device_code": dev["device_code"], "client_id": "herdr"})
    if status == 200 and d.get("access_token"):
        tok = d["access_token"]
        exp = jwt_exp(tok) or (time.time() + int(d["expires_in"]) if d.get("expires_in") else None)
        write_private(f"{TOKENS}/{name}.json", {"access_token": tok, "refresh_token": d.get("refresh_token"),
                                                "expires": exp, "at": time.time()})
        os.remove(path)
        out(status="done", expires=exp)
    err = d.get("error") or d.get("detail") or ""
    if err in ("authorization_pending", "slow_down"):
        out(status="pending", slowDown=err == "slow_down")
    os.remove(path)
    out(status="denied" if err == "access_denied" else "expired" if err == "expired_token" else "failed", error=str(err)[:200])


def cmd_gateway_logout(name):
    for suffix in (".json", ".device.json"):
        p = f"{TOKENS}/{name}{suffix}"
        if os.path.isfile(p):
            os.remove(p)
    out()


def cmd_install_hook(quiet=False):
    src = read(HOOK_SRC)
    if src is None:
        fail(f"Missing {HOOK_SRC}")
    os.makedirs(os.path.dirname(HOOK), exist_ok=True)
    with open(HOOK, "w") as f:
        f.write(src)
    if not quiet:
        out()


def main(argv):
    cmds = {
        "status": (cmd_status, 0, 1), "doctor": (cmd_doctor, 0, 0), "setup": (cmd_setup, 1, 1),
        "remote": (cmd_remote, 0, 0), "use": (cmd_use, 1, 1),
        "profile-add": (cmd_profile_add, 1, 1), "profile-remove": (cmd_profile_remove, 1, 1),
        "profile-label": (cmd_profile_label, 2, 2),
        "pin-profile": (cmd_pin_profile, 2, 2), "pin-version": (cmd_pin_version, 2, 2),
        "install": (lambda v, u=None: cmd_install(v, u == "--use"), 1, 2), "use-version": (cmd_use_version, 1, 1),
        "uninstall": (cmd_uninstall, 1, 1), "update": (cmd_update, 1, 1), "set-key": (cmd_set_key, 2, 2),
        "models": (cmd_models, 1, 1), "router": (cmd_router, 0, 0), "router-set": (cmd_router_set, 2, 2),
        "install-hook": (cmd_install_hook, 0, 0), "usage": (cmd_usage, 1, 1),
        "usage-detect": (cmd_usage_detect, 1, 1), "usage-setup": (cmd_usage_setup, 2, 2),
        "usage-remove": (cmd_usage_remove, 1, 1),
        "gateway-login": (cmd_gateway_login, 1, 1), "gateway-poll": (cmd_gateway_poll, 1, 1),
        "gateway-logout": (cmd_gateway_logout, 1, 1),
    }
    if not argv or argv[0] not in cmds:
        fail(__doc__)
    fn, lo, hi = cmds[argv[0]]
    args = argv[1:]
    if not lo <= len(args) <= hi:
        fail(f"{argv[0]} takes {lo}-{hi} arguments")
    if not os.path.isfile(CVM) and argv[0] not in ("remote", "status", "doctor", "setup"):
        fail("cvm is not installed yet: finish setup first")
    fn(*args)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - always answer in JSON
        fail(f"{type(e).__name__}: {e}")
