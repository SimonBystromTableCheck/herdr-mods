// The vault on disk: where it is, its notes, links between them, and the feature note of a repo/branch.
// Paths inside the vault are relative ("Herdr/my-repo/fix-login.md"); `abs()` makes them absolute.
import { appHome, exec, home, readTextFile, writeTextFile, window } from "herdr";

export const expand = p => (p === "~" || p.startsWith("~/") ? home() + p.slice(1) : p);
export const tilde = p => (p && p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const json = async path => { try { return JSON.parse(await readTextFile(path)); } catch { return null; } };

export const macos = () => (window()?.platform ?? "macos") === "macos";
export const SETTINGS = () => `${appHome()}/notes.json`;

// A URL or file in the system's default app (obsidian://, https://, an attachment).
export const openUrl = url => exec(macos() ? "open" : "xdg-open", [url]).catch(() => null);

// A command in the person's login shell, so Homebrew and their PATH are there.
export const sh = (cmd, timeout = 30000) => exec(macos() ? "/bin/zsh" : "/bin/sh", ["-lc", cmd], { timeout });

// The vaults Obsidian knows: [{ path, open, ts }], the open one first, then most recent.
export async function knownVaults() {
  const h = home();
  const files = macos() ? [`${h}/Library/Application Support/obsidian/obsidian.json`]
    : [`${h}/.config/obsidian/obsidian.json`, `${h}/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json`, `${h}/snap/obsidian/current/.config/obsidian/obsidian.json`];
  for (const f of files) {
    const reg = await json(f);
    const vaults = Object.values(reg?.vaults ?? {}).filter(v => typeof v?.path === "string");
    if (vaults.length) return vaults.sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || (b.ts ?? 0) - (a.ts ?? 0));
  }
  return [];
}

// The person's settings in ~/.config/herdr-app/notes.json (outside the mod folder, kept on updates):
//   { "vault": "~/Notes", "folder": "Herdr", "editor": ["nvim"], "setupDone": true }
export async function readSettings() {
  const raw = await readTextFile(SETTINGS()).catch(() => null);
  let own = {};
  try { own = raw ? JSON.parse(raw) : {}; } catch {}
  return { own, raw };
}

export async function saveSettings(patch) {
  const { own, raw } = await readSettings();
  const next = { ...own, ...patch };
  await writeTextFile(SETTINGS(), JSON.stringify(next, null, 2) + "\n", raw);
  return next;
}

// The vault in use: notes.json's "vault", else the one Obsidian has open, else the one it opened last.
// `setupDone` is false until the setup screen was finished once.
export async function loadConfig() {
  const { own } = await readSettings();
  let root = own.vault ? expand(own.vault) : (await knownVaults())[0]?.path ?? null;
  if (!root) return { root: null, setupDone: Boolean(own.setupDone) };
  root = root.replace(/\/+$/, "");
  const exists = await exec("test", ["-d", root]).then(r => r.code === 0).catch(() => false);
  return {
    root: exists ? root : null, missing: exists ? null : root, name: root.split("/").pop(),
    folder: String(own.folder ?? "Herdr").replace(/^\/+|\/+$/g, "") || "Herdr",
    editor: Array.isArray(own.editor) && own.editor.length ? own.editor : ["nvim"],
    setupDone: Boolean(own.setupDone),
  };
}

// Makes `path` a vault Obsidian recognises (an .obsidian folder), with a first note when it's empty.
export async function makeVault(path) {
  const r = await exec("mkdir", ["-p", `${path}/.obsidian`]);
  if (r.code) throw new Error(r.stderr.trim() || `Couldn't create ${path}`);
  if (await readTextFile(`${path}/.obsidian/app.json`).catch(() => null) === null) await writeTextFile(`${path}/.obsidian/app.json`, "{}\n", null).catch(() => null);
  const any = await exec("rg", ["--files", "-g", "*.md", "--max-depth", "2"], { cwd: path }).catch(() => null);
  if (!any?.stdout?.trim()) await writeTextFile(`${path}/Welcome.md`, "# Welcome\n\nNotes for your work in Herdr. Each repo and branch gets a note under `Herdr/`.\n", null).catch(() => null);
}

export const abs = (cfg, rel) => `${cfg.root}/${rel}`;
export const nameOf = rel => rel.split("/").pop().replace(/\.md$/i, "");
export const dirOf = rel => rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";

// Every note, newest first. Hidden folders (.obsidian, .trash) are skipped by ripgrep.
export async function listNotes(cfg) {
  const r = await exec("rg", ["--files", "--sortr", "modified", "-g", "*.md"], { cwd: cfg.root }).catch(() => null);
  if (r && r.code <= 1) return r.stdout.split("\n").filter(Boolean);
  const f = await exec("find", [".", "-name", "*.md", "-not", "-path", "*/.*"], { cwd: cfg.root }).catch(() => null);
  return (f?.stdout ?? "").split("\n").filter(Boolean).map(p => p.replace(/^\.\//, ""));
}

// Lines matching `text` (case-insensitive, literal) across the vault: [{ rel, line, text }].
export async function grep(cfg, text) {
  const r = await exec("rg", ["-n", "-i", "-F", "--max-count", "3", "--max-columns", "200", "-g", "*.md", "--", text, "."], { cwd: cfg.root }).catch(() => null);
  return (r?.stdout ?? "").split("\n").filter(Boolean).slice(0, 300).map(l => {
    const m = l.match(/^\.\/(.*?):(\d+):(.*)$/);
    return m && { rel: m[1], line: +m[2], text: m[3].trim() };
  }).filter(Boolean);
}

// Fuzzy name match: every character of the query in order. Lower is better; null is no match.
export function fuzzy(query, rel) {
  const q = query.toLowerCase(), name = nameOf(rel).toLowerCase(), path = rel.toLowerCase();
  if (!q) return 0;
  if (name === q) return -3;
  if (name.startsWith(q)) return -2;
  if (name.includes(q)) return -1;
  for (const hay of [name, path]) {
    let i = 0, gaps = 0, last = -1;
    for (const ch of hay) { if (ch === q[i]) { if (last >= 0) gaps += hay.indexOf(ch, last + 1) - last - 1; last = hay.indexOf(ch, last + 1); i++; if (i === q.length) break; } }
    if (i === q.length) return gaps + (hay === path ? 50 : 0);
  }
  return null;
}

// ---- Links -----------------------------------------------------------------------

const WIKI = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;

// The targets of a note's [[links]], as written.
export const linksIn = raw => [...new Set([...raw.matchAll(WIKI)].map(m => m[1].trim()))];

// Resolves a link target as Obsidian does: an exact path, else the shortest path with that name.
export function resolve(target, notes) {
  const t = target.replace(/\.md$/i, "").toLowerCase();
  const exact = notes.find(n => n.replace(/\.md$/i, "").toLowerCase() === t);
  if (exact) return exact;
  const base = t.split("/").pop();
  return notes.filter(n => nameOf(n).toLowerCase() === base).sort((a, b) => a.length - b.length)[0] ?? null;
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Notes whose [[links]] reach `rel` (by name or by path).
export async function backlinks(cfg, rel) {
  const name = nameOf(rel), path = rel.replace(/\.md$/i, "");
  const re = `\\[\\[(${esc(name)}|${esc(path)})(\\||#|\\^|\\]\\])`;
  const r = await exec("rg", ["-l", "-i", "-g", "*.md", "--", re, "."], { cwd: cfg.root }).catch(() => null);
  return (r?.stdout ?? "").split("\n").filter(Boolean).map(p => p.replace(/^\.\//, "")).filter(p => p !== rel);
}

// Renames a note and rewrites [[links]] to it across the vault. Returns the new relative path.
export async function rename(cfg, rel, newName) {
  const to = `${dirOf(rel) ? dirOf(rel) + "/" : ""}${newName.replace(/[\\/:]/g, "-")}.md`;
  if (to === rel) return rel;
  if (await readTextFile(abs(cfg, to)).catch(() => null) !== null) throw new Error(`"${nameOf(to)}" already exists`);
  const oldName = nameOf(rel), oldPath = rel.replace(/\.md$/i, ""), newPath = to.replace(/\.md$/i, "");
  const re = new RegExp(`\\[\\[(${esc(oldName)}|${esc(oldPath)})(?=[|#^\\]])`, "gi");
  for (const n of await backlinks(cfg, rel)) {
    const before = await readTextFile(abs(cfg, n)).catch(() => null);
    if (before === null) continue;
    const after = before.replace(re, (_m, hit) => `[[${hit.includes("/") ? newPath : nameOf(to)}`);
    if (after !== before) await writeTextFile(abs(cfg, n), after, before).catch(() => null);
  }
  const r = await exec("mv", ["-n", abs(cfg, rel), abs(cfg, to)]);
  if (r.code) throw new Error(r.stderr.trim() || "mv failed");
  return to;
}

// Moves a note to Obsidian's own trash folder in the vault (.trash), as Obsidian's "Move to Obsidian trash".
export async function trash(cfg, rel) {
  await exec("mkdir", ["-p", `${cfg.root}/.trash`]);
  const r = await exec("mv", [abs(cfg, rel), `${cfg.root}/.trash/${nameOf(rel)}-${Date.now()}.md`]);
  if (r.code) throw new Error(r.stderr.trim() || "mv failed");
}

// ---- Notes for repos and branches ------------------------------------------------

// The repo (main checkout's folder name, so worktrees share it) and branch at `folder`.
export async function gitContext(folder, machine) {
  if (!folder) return null;
  const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--abbrev-ref", "HEAD"], { cwd: folder, on: machine ?? undefined }).catch(() => null);
  if (!r || r.code) return null;
  const [common, branch] = r.stdout.trim().split("\n");
  const repo = common.replace(/\/\.git\/?$/, "").replace(/\.git$/, "").split("/").filter(Boolean).pop();
  return repo ? { repo, branch: branch && branch !== "HEAD" ? branch : null } : null;
}

export const slug = s => s.replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "");
export const repoNote = (cfg, repo) => `${cfg.folder}/${slug(repo)}/${slug(repo)}.md`;
export const featureNote = (cfg, repo, branch) => `${cfg.folder}/${slug(repo)}/${slug(branch)}.md`;

const today = () => new Date().toISOString().slice(0, 10);

// Creates the note if it isn't there. Returns true when it made it.
export async function ensure(cfg, rel, text) {
  if (await readTextFile(abs(cfg, rel)).catch(() => null) !== null) return false;
  await exec("mkdir", ["-p", `${cfg.root}/${dirOf(rel)}`]);
  await writeTextFile(abs(cfg, rel), text, null);
  return true;
}

export const repoTemplate = repo =>
  `---\ntags: [repo]\nrepo: ${repo}\n---\n# ${repo}\n\nWhat this repo is, how it's run, decisions that outlive a branch.\n\n## Features\n\n`;

export const featureTemplate = (repo, branch) =>
  `---\ntags: [feature]\nrepo: ${repo}\nbranch: ${branch}\nstatus: active\ncreated: ${today()}\n---\n# ${branch}\n\nRepo: [[${slug(repo)}]]\n\n## Todos\n\n## Notes\n\n## Log\n`;

export const noteTemplate = title => `# ${title}\n\n`;

// Adds `- [[feature]]` under the repo note's "## Features" (or at the end).
export async function linkFeature(cfg, repo, branch) {
  const rel = repoNote(cfg, repo), before = await readTextFile(abs(cfg, rel)).catch(() => null);
  if (before === null || before.includes(`[[${slug(branch)}]]`)) return;
  const lines = before.replace(/\n+$/, "").split("\n"), i = lines.findIndex(l => /^##\s+Features/i.test(l));
  if (i < 0) lines.push("", `- [[${slug(branch)}]]`);
  else { let j = i + 1; while (j < lines.length && !/^#{1,2}\s/.test(lines[j])) j++; while (j > i + 1 && !lines[j - 1].trim()) j--; lines.splice(j, 0, ...(j === i + 1 ? [""] : []), `- [[${slug(branch)}]]`); }
  await writeTextFile(abs(cfg, rel), lines.join("\n") + "\n", before).catch(() => null);
}
