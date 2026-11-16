// Format engine: works out how *this repo* formats a file, the way an editor or commit hook would.
//
// Sources, strongest first:
//   hook    lint-staged / nano-staged config: the exact commands the team runs before commit
//   editor  .vscode/settings.json: editor.defaultFormatter (per language) + codeActionsOnSave fixes
//   config  formatter/linter config files in the repo + what's installed (node_modules/.bin, PATH)
// Always available on top: built-in JSON formatting and .editorconfig whitespace cleanup.
import { exec, readTextFile, writeTextFile } from "herdr";

const NODE_TOOLS = ["prettier", "oxfmt", "biome", "dprint", "eslint", "oxlint", "stylelint"];
const PATH_TOOLS = ["ruff", "black", "gofmt", "rustfmt", "mix", "bundle", "uv", "node", "rubocop"];

// File extension → VS Code language id (for "[typescript]": {...} overrides).
const LANG_ID = { ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "jsonc", css: "css", scss: "scss", less: "less", html: "html", htm: "html", md: "markdown", mdx: "mdx", yml: "yaml", yaml: "yaml",
  py: "python", rb: "ruby", rake: "ruby", go: "go", rs: "rust", vue: "vue", svelte: "svelte", graphql: "graphql", gql: "graphql", ex: "elixir", exs: "elixir" };

const WEB = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "jsonc", "css", "scss", "less", "html", "vue", "md", "mdx", "yml", "yaml", "graphql", "gql"];
const JS = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte"];

// Which tools are linters (their step is a "fix"); everything else that we know is a formatter.
const FIXERS = /^(eslint|oxlint|stylelint)\b|^ruff check\b|^rubocop\b|^biome (check|lint)\b/;
const FORMATTERS = /^(prettier|oxfmt|dprint|black|gofmt|rustfmt|autopep8)\b|^ruff format\b|^biome format\b|^mix format\b/;

// VS Code extension → command (formatter) / code action → command (fix).
const EXT_FORMATTER = {
  "esbenp.prettier-vscode": "prettier --write", "biomejs.biome": "biome format --write", "oxc.oxc-vscode": "oxfmt --write",
  "dprint.dprint": "dprint fmt", "charliermarsh.ruff": "ruff format", "ms-python.black-formatter": "black", "ms-python.autopep8": "autopep8 -i",
  "rubocop.vscode-rubocop": "rubocop -a", "shopify.ruby-lsp": "rubocop -a", "misogi.ruby-rubocop": "rubocop -a",
  "golang.go": "gofmt -w", "rust-lang.rust-analyzer": "rustfmt", "jakebecker.elixir-ls": "mix format",
};
const CODE_ACTION = {
  "source.fixAll.eslint": "eslint --fix", "source.fixAll.oxc": "oxlint --fix", "source.fixAll.biome": "biome check --write",
  "source.fixAll.ruff": "ruff check --fix", "source.fixAll.stylelint": "stylelint --fix", "source.organizeImports.biome": "biome check --write",
};

export const ext = p => (p.includes(".") ? p.split(".").pop().toLowerCase() : "");
const base = p => p.slice(p.lastIndexOf("/") + 1);

// ── small parsers ────────────────────────────────────────────────────────────
export function parseJsonc(text) {
  // Strips // and /* */ comments outside strings, then trailing commas.
  let out = "", i = 0, str = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (str) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function globToRegex(glob) {
  let re = "", i = 0, brace = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { i += 2; if (glob[i] === "/") { i++; re += "(?:.*/)?"; } else re += ".*"; continue; }
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") { brace++; re += "(?:"; }
    else if (c === "}" && brace) { brace--; re += ")"; }
    else if (c === "," && brace) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${re}$`);
}

// lint-staged / micromatch matchBase: a pattern without "/" matches the file name anywhere.
export const globMatch = (glob, rel) => globToRegex(glob).test(glob.includes("/") ? rel : base(rel));

function split(cmd) {
  const out = []; let cur = "", q = null;
  for (const c of cmd.trim()) {
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ""; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function kindOf(cmd) {
  const c = cmd.replace(/^(npx|pnpm( exec)?|yarn|bunx|bundle exec|uv run)\s+/, "");
  return FIXERS.test(c) ? "fix" : FORMATTERS.test(c) ? "format" : "other";
}

// ── .editorconfig ────────────────────────────────────────────────────────────
function parseEditorconfig(text) {
  const sections = []; let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^\[(.*)\]$/);
    if (m) { cur = { glob: m[1], props: {} }; sections.push(cur); continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && cur) cur.props[kv[1].trim().toLowerCase()] = kv[2].trim().toLowerCase();
  }
  return sections;
}

export function editorconfigFor(sections, rel) {
  const props = {};
  for (const s of sections ?? []) {
    const g = s.glob.startsWith("/") ? s.glob.slice(1) : s.glob.includes("/") ? s.glob : `**/${s.glob}`;
    if (globToRegex(g).test(rel)) Object.assign(props, s.props);
  }
  return props;
}

// ── detection ────────────────────────────────────────────────────────────────
async function sh(script, root, on) {
  const r = await exec("sh", ["-c", script], { cwd: root, on, timeout: 20000 }).catch(() => null);
  return r?.stdout ?? "";
}

const read = (root, on, name) => readTextFile(`${root}/${name}`, { on }).catch(() => null);

async function importConfig(root, on, name) {
  // JS configs (.nano-staged.js, lint-staged.config.mjs) are loaded with the repo's node, as lint-staged itself does.
  const script = 'import { pathToFileURL } from "node:url"; const m = await import(pathToFileURL(process.argv[1]).href); let c = m.default ?? m; if (typeof c === "function") c = null; console.log(JSON.stringify(c, (k, v) => typeof v === "function" ? "<function>" : v));';
  const r = await exec("node", ["--input-type=module", "-e", script, `${root}/${name}`], { cwd: root, on, timeout: 15000 }).catch(() => null);
  if (r?.code !== 0) return null;
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return null; }
}

export async function detect(root, on) {
  const notes = [];
  const listing = await sh(`ls -a; echo '--bin'; for b in ${NODE_TOOLS.join(" ")}; do [ -x "node_modules/.bin/$b" ] && echo "$b"; done; echo '--path'; for b in ${PATH_TOOLS.join(" ")}; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done; true`, root, on);
  const [filesPart, rest = ""] = listing.split("--bin\n"), [binPart, pathPart = ""] = rest.split("--path\n");
  const files = new Set(filesPart.split("\n").filter(Boolean)), bins = new Set(binPart.split("\n").filter(Boolean)), path = new Set(pathPart.split("\n").filter(Boolean));
  const has = n => files.has(n), any = (...ns) => ns.find(has);
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : any("bun.lock", "bun.lockb") ? "bun" : has("package-lock.json") ? "npm" : null;
  const pnp = any(".pnp.cjs", ".pnp.js");
  let pkgJson = null;
  if (has("package.json")) { try { pkgJson = JSON.parse(await read(root, on, "package.json")); } catch { notes.push("package.json could not be read"); } }
  const gemfile = has("Gemfile") ? (await read(root, on, "Gemfile")) ?? "" : "";
  const pyproject = has("pyproject.toml") ? (await read(root, on, "pyproject.toml")) ?? "" : "";

  const env = { root, on, pm, pnp, bins, path, gemfile, pyproject };
  const recipes = [];

  // 1. Commit hook config.
  let hook = null, hookSource = null;
  if (pkgJson?.["lint-staged"]) { hook = pkgJson["lint-staged"]; hookSource = "package.json › lint-staged"; }
  else if (pkgJson?.["nano-staged"]) { hook = pkgJson["nano-staged"]; hookSource = "package.json › nano-staged"; }
  else {
    const name = any(".lintstagedrc", ".lintstagedrc.json", ".lintstagedrc.js", ".lintstagedrc.mjs", ".lintstagedrc.cjs", "lint-staged.config.js", "lint-staged.config.mjs", "lint-staged.config.cjs",
      ".nano-staged.json", ".nano-staged.js", ".nano-staged.mjs", ".nano-staged.cjs", "nano-staged.json", "nano-staged.js", "nano-staged.mjs");
    if (name) {
      hookSource = name;
      if (/\.(c|m)?js$/.test(name)) hook = path.has("node") ? await importConfig(root, on, name) : null;
      else { try { hook = parseJsonc(await read(root, on, name)); } catch { hook = null; } }
      if (!hook) notes.push(`Couldn't read ${name}${/\.(c|m)?js$/.test(name) && !path.has("node") ? " (needs node)" : ""}`);
    }
  }
  if (hook && typeof hook === "object" && !Array.isArray(hook)) {
    const rules = [];
    for (const [glob, val] of Object.entries(hook)) {
      const cmds = (Array.isArray(val) ? val : [val]).filter(c => typeof c === "string" && c !== "<function>");
      if (!cmds.length) continue;
      rules.push({ match: { glob }, label: glob, steps: cmds.map(c => ({ cmd: c, kind: kindOf(c) })) });
    }
    if (rules.length) recipes.push({ id: "hook", label: "Commit hook", source: hookSource, rules });
  }

  // 2. VS Code settings.
  const vsText = await read(root, on, ".vscode/settings.json");
  let vs = null;
  if (vsText != null) { try { vs = parseJsonc(vsText); } catch { notes.push(".vscode/settings.json has a syntax error"); } }
  let formatOnSave = false;
  if (vs) {
    formatOnSave = vs["editor.formatOnSave"] === true;
    const actions = vs["editor.codeActionsOnSave"] ?? {};
    const on_ = v => v === true || v === "always" || v === "explicit";
    const fixes = (Array.isArray(actions) ? actions : Object.keys(actions).filter(k => on_(actions[k]))).map(a => CODE_ACTION[a]).filter(Boolean);
    const byLang = new Map();
    const def = vs["editor.defaultFormatter"];
    for (const [k, v] of Object.entries(vs)) {
      const m = k.match(/^\[(.+)\]$/);
      if (m && v?.["editor.defaultFormatter"]) for (const lang of m[1].split("][")) byLang.set(lang, v["editor.defaultFormatter"]);
    }
    const rules = [];
    const groups = new Map(); // formatter id → exts
    for (const [e, lang] of Object.entries(LANG_ID)) {
      const f = (byLang.get(lang) ?? def)?.toLowerCase();
      if (f && EXT_FORMATTER[f]) { if (!groups.has(f)) groups.set(f, []); groups.get(f).push(e); }
    }
    for (const [f, exts] of groups) {
      const fixSteps = fixes.filter(c => (c.startsWith("eslint") || c.startsWith("oxlint") || c.startsWith("biome")) ? exts.some(e => JS.includes(e)) : c.startsWith("ruff") ? exts.includes("py") : c.startsWith("stylelint") ? exts.some(e => ["css", "scss", "less"].includes(e)) : true);
      rules.push({ match: { exts }, label: exts.map(e => `.${e}`).join(" "), steps: [...fixSteps.map(c => ({ cmd: c, kind: "fix" })), { cmd: EXT_FORMATTER[f], kind: "format" }] });
    }
    if (!groups.size && fixes.length) rules.push({ match: { exts: JS }, label: "JS/TS", steps: fixes.map(c => ({ cmd: c, kind: "fix" })) });
    const unmapped = [...new Set([def, ...byLang.values()].filter(f => f && !EXT_FORMATTER[f.toLowerCase()]))];
    if (unmapped.length) notes.push(`VS Code formatter${unmapped.length > 1 ? "s" : ""} with no command line: ${unmapped.join(", ")}`);
    if (rules.length) recipes.push({ id: "editor", label: "VS Code", source: ".vscode/settings.json", rules });
  }

  // 3. Config files + installed tools.
  {
    const rules = [];
    const nodeHas = b => bins.has(b) || Boolean(pnp);
    const jsFix = [];
    if (any(".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlintrc.json") && nodeHas("oxlint")) jsFix.push("oxlint --fix");
    if ((any("eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml") || pkgJson?.eslintConfig) && nodeHas("eslint")) jsFix.push("eslint --fix");
    let webFmt = null;
    if (any(".oxfmtrc.json", ".oxfmtrc.jsonc") && nodeHas("oxfmt")) webFmt = "oxfmt --write";
    else if (any("biome.json", "biome.jsonc") && nodeHas("biome")) webFmt = "biome format --write";
    else if ((any(".prettierrc", ".prettierrc.json", ".prettierrc.json5", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.toml", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs", "prettier.config.ts") || pkgJson?.prettier) && nodeHas("prettier")) webFmt = "prettier --write";
    else if (any("dprint.json", ".dprint.json", "dprint.jsonc") && nodeHas("dprint")) webFmt = "dprint fmt";
    else if (bins.has("prettier")) webFmt = "prettier --write";
    if (jsFix.length) rules.push({ match: { exts: JS }, label: "JS/TS", steps: [...jsFix.map(c => ({ cmd: c, kind: "fix" })), ...(webFmt ? [{ cmd: webFmt, kind: "format" }] : [])] });
    if (webFmt) rules.push({ match: { exts: jsFix.length ? WEB.filter(e => !JS.includes(e)) : WEB }, label: jsFix.length ? "JSON, CSS, HTML, Markdown, YAML" : "JS/TS, JSON, CSS, HTML, Markdown, YAML", steps: [{ cmd: webFmt, kind: "format" }] });
    if (any(".stylelintrc", ".stylelintrc.json", ".stylelintrc.js", "stylelint.config.js", "stylelint.config.mjs") && nodeHas("stylelint")) rules.push({ match: { exts: ["css", "scss", "less"] }, label: "CSS", steps: [{ cmd: "stylelint --fix", kind: "fix" }] });
    if (has(".rubocop.yml") || /\brubocop\b/.test(gemfile)) rules.push({ match: { exts: ["rb", "rake", "gemspec", "ru", "jbuilder"] }, label: "Ruby", steps: [{ cmd: "rubocop -a --force-exclusion", kind: "fix", formatCmd: "rubocop -x --force-exclusion" }] });
    const ruff = has("ruff.toml") || has(".ruff.toml") || /\[tool\.ruff/.test(pyproject), black = /\[tool\.black/.test(pyproject);
    if (ruff || (path.has("ruff") && (pyproject || files.has("setup.py")))) rules.push({ match: { exts: ["py", "pyi"] }, label: "Python", steps: [{ cmd: "ruff check --fix", kind: "fix" }, { cmd: "ruff format", kind: "format" }] });
    else if (black) rules.push({ match: { exts: ["py", "pyi"] }, label: "Python", steps: [{ cmd: "black", kind: "format" }] });
    if (has("go.mod")) rules.push({ match: { exts: ["go"] }, label: "Go", steps: [{ cmd: "gofmt -w", kind: "format" }] });
    if (has("Cargo.toml")) rules.push({ match: { exts: ["rs"] }, label: "Rust", steps: [{ cmd: "rustfmt", kind: "format" }] });
    if (has("mix.exs")) rules.push({ match: { exts: ["ex", "exs", "heex"] }, label: "Elixir", steps: [{ cmd: "mix format", kind: "format" }] });
    if (rules.length) recipes.push({ id: "config", label: "Repo tools", source: "config files + installed tools", rules });
  }

  // 4. .editorconfig (used for built-ins and as the fallback cleanup).
  const ecText = has(".editorconfig") ? await read(root, on, ".editorconfig") : null;
  const editorconfig = ecText ? parseEditorconfig(ecText) : [];

  const scripts = pkgJson?.scripts ?? {};
  const script = ["format", "fmt", "format:fix", "lint:fix"].find(s => scripts[s]);

  return { recipes, env, notes, formatOnSave, editorconfig, hasEditorconfig: Boolean(ecText), script: script ? { name: script, cmd: scripts[script], run: [pm ?? "npm", "run", script] } : null };
}

export function rulesFor(recipe, rel) {
  if (!recipe) return [];
  return recipe.rules.filter(r => r.match.glob ? globMatch(r.match.glob, rel) : r.match.exts.includes(ext(rel)));
}

// Turns "eslint --fix" into an argv that runs the repo's own copy.
export function resolve(cmd, env) {
  const argv = split(cmd);
  const tool = argv[0];
  if (["npx", "pnpm", "yarn", "npm", "bun", "bunx", "node", "bundle", "uv", "sh", "bash"].includes(tool)) return argv;
  if (NODE_TOOLS.includes(tool) || env.bins.has(tool)) {
    if (env.bins.has(tool)) return [`${env.root}/node_modules/.bin/${tool}`, ...argv.slice(1)];
    if (env.pnp || env.pm === "yarn") return ["yarn", ...argv];
    if (env.pm === "pnpm") return ["pnpm", "exec", ...argv];
    return ["npx", "--no-install", ...argv];
  }
  if (tool === "rubocop" && /\brubocop\b/.test(env.gemfile) && env.path.has("bundle")) return ["bundle", "exec", ...argv];
  if ((tool === "ruff" || tool === "black") && !env.path.has(tool) && env.path.has("uv")) return ["uv", "run", ...argv];
  if (tool === "rustfmt") return [...argv, "--edition", "2021"];
  return argv;
}

// ── built-ins ────────────────────────────────────────────────────────────────
export const BUILTIN_EXTS = ["json", "jsonc"];

function indentFor(props) {
  if (props.indent_style === "tab") return "\t";
  const n = parseInt(props.indent_size, 10);
  return " ".repeat(Number.isFinite(n) ? n : 2);
}

// Pure-JS formatting for the always-available file types. Returns null if it can't.
export function builtinFormat(rel, text, editorconfig) {
  const e = ext(rel), props = editorconfigFor(editorconfig, rel);
  if (e === "json" || e === "jsonc" || /^\.?(babelrc|eslintrc|prettierrc|swcrc)$/.test(base(rel))) {
    let value;
    try { value = JSON.parse(text); } catch { return { error: e === "jsonc" || /\/\/|\/\*/.test(text) ? "has comments — built-in JSON formatting would drop them" : "not valid JSON" }; }
    return { text: JSON.stringify(value, null, indentFor(props)) + (props.insert_final_newline === "false" ? "" : "\n") };
  }
  return null;
}

// .editorconfig whitespace rules (trailing whitespace, final newline, line endings).
export function editorconfigClean(rel, text, editorconfig) {
  const p = editorconfigFor(editorconfig, rel);
  let out = text;
  if (p.end_of_line === "lf") out = out.replace(/\r\n/g, "\n");
  if (p.trim_trailing_whitespace === "true") out = out.replace(/[ \t]+(\r?\n)/g, "$1").replace(/[ \t]+$/, "");
  if (p.insert_final_newline === "true" && out && !out.endsWith("\n")) out += "\n";
  if (p.insert_final_newline === "false") out = out.replace(/\n+$/, "");
  return out;
}

// ── running ──────────────────────────────────────────────────────────────────
// files: repo-relative paths. Returns {steps:[{label, files, ok, output}], changed:[paths], undo:[{abs, path, before, after}]}
export async function runPipeline({ det, recipe, files, fixes, builtins, onProgress }) {
  const { env, editorconfig } = det, { root, on } = env;
  const local = !on;
  const steps = [];

  // Snapshot contents (local, bounded) for change detection + undo.
  const snap = new Map();
  const snapshot = async () => {
    const m = new Map();
    if (local && files.length <= 300) for (const f of files) { try { m.set(f, await readTextFile(`${root}/${f}`)); } catch { m.set(f, undefined); } }
    return m;
  };
  const hashes = async () => {
    if (files.length > 300 || local) return null;
    const r = await exec("git", ["hash-object", "--", ...files], { cwd: root, on }).catch(() => null);
    return r?.code === 0 ? r.stdout.trim().split("\n") : null;
  };
  const before = await snapshot(), beforeHash = await hashes();
  for (const [k, v] of before) snap.set(k, v);

  // Group files by the exact command they need, keeping step order (fix before format).
  const plan = []; // {cmd, kind, files}
  const uncovered = [];
  for (const f of files) {
    const rules = rulesFor(recipe, f);
    let formatted = false;
    for (const r of rules) for (const s of r.steps) {
      if (s.kind === "other") continue;
      let cmd = s.cmd;
      if (s.kind === "fix" && !fixes) { if (s.formatCmd) cmd = s.formatCmd; else continue; }
      if (s.kind === "format" || s.formatCmd) formatted = true;
      let p = plan.find(x => x.cmd === cmd);
      if (!p) { p = { cmd, kind: s.kind, files: [] }; plan.push(p); }
      if (!p.files.includes(f)) p.files.push(f);
    }
    if (!formatted) uncovered.push(f);
  }
  plan.sort((a, b) => (a.kind === "fix" ? 0 : 1) - (b.kind === "fix" ? 0 : 1));

  let i = 0;
  for (const p of plan) {
    i++;
    onProgress?.(`${i}/${plan.length}: ${p.cmd} (${p.files.length} file${p.files.length === 1 ? "" : "s"})`);
    const argv = resolve(p.cmd, env);
    let ok = true, output = "";
    for (let c = 0; c < p.files.length; c += 150) {
      const chunk = p.files.slice(c, c + 150);
      try {
        const r = await exec(argv[0], [...argv.slice(1), ...chunk], { cwd: root, on, timeout: 300000 });
        // Linters exit non-zero when problems remain after fixing; that's a report, not a failure to run.
        if (r.code !== 0 && !(p.kind === "fix" && r.code === 1)) ok = false;
        output += `${r.stdout}\n${r.stderr}`;
      } catch (e) { ok = false; output += String(e); }
    }
    steps.push({ label: p.cmd, kind: p.kind, files: p.files.length, ok, output: output.trim() });
  }

  // Built-ins + .editorconfig cleanup for files no repo formatter covered (local only: writes).
  if (local && (builtins || det.hasEditorconfig)) {
    let n = 0, errors = [];
    for (const f of uncovered) {
      let text; try { text = await readTextFile(`${root}/${f}`); } catch { continue; }
      if (text == null || text.includes("\0")) continue;
      let next = text;
      if (builtins) { const b = builtinFormat(f, text, editorconfig); if (b?.error) errors.push(`${f}: ${b.error}`); else if (b) next = b.text; }
      next = editorconfigClean(f, next, editorconfig);
      if (next !== text) { try { await writeTextFile(`${root}/${f}`, next, text); n++; } catch { errors.push(`${f}: changed while formatting`); } }
    }
    if (uncovered.length) steps.push({ label: "Built-in (JSON + .editorconfig whitespace)", kind: "format", files: uncovered.length, ok: errors.length === 0, output: errors.join("\n") });
  }

  // What changed.
  const changed = [], undo = [];
  if (local && before.size) {
    for (const f of files) {
      const b = before.get(f); if (b == null) continue;
      let a; try { a = await readTextFile(`${root}/${f}`); } catch { continue; }
      if (a != null && a !== b) { changed.push(f); undo.push({ abs: `${root}/${f}`, path: f, before: b, after: a }); }
    }
  } else if (beforeHash) {
    const after = await hashes();
    if (after) files.forEach((f, k) => { if (after[k] !== beforeHash[k]) changed.push(f); });
  }
  return { steps, changed, undo, counted: Boolean(before.size || beforeHash), uncovered: uncovered.length };
}
