// "Send to Notes" for this machine's Notes mod: an Obsidian vault whose feature notes are
// <vault>/<folder>/<repo>/<branch>.md (mods/notes/vault.js holds the same rules; a mod can't
// import another mod's files, so the small pieces are repeated here).
//
// The chat writes into the branch's feature note, under "## Notes", and makes that note (and
// the repo's) when they're missing — the same notes the Notes panel shows.

import { appHome, home, exec, readTextFile, writeTextFile, openOverlay } from "herdr";

const NOTES_REPO = "https://github.com/SimonBystromTableCheck/herdr-mods";

/**
 * Send to Notes without the Notes mod installed: asks, then starts Claude in the Herdr home to install it
 * (the `notes` item from herdr-mods), as Pond settings starts updates.
 */
export function offerNotes() {
  const task = [
    `Install the "notes" mod from ${NOTES_REPO} (item "notes": its files are notes/mods/notes, its brief notes/RECIPE.md).`,
    `Follow AGENTS.md's "Layouts and mods other people made" steps for a mod: read the recipe and every file first, tell me`,
    `what it reaches outside its folder, copy it to mods/notes keeping its mod.json "source" (so updates find it), never`,
    `overwrite an existing folder, and run herdr-app check. Then tell me to open the Notes panel and pick my Obsidian vault,`,
    `so the chat's Send to Notes button can save there. I already confirmed the install, so don't ask again whether to install.`,
  ].join(" ");
  openOverlay({ mod: "confirm", kind: "dialog", width: 440, props: {
    title: "Install Notes to use Send to Notes?",
    detail: "Send to Notes saves a message into your Obsidian vault, in the branch's note. That vault comes from the Notes panel (the notes mod from herdr-mods), which isn't installed. A new Claude tab will install it and check it.",
    command: { name: "tab.new", args: { name: "Install Notes", folder: appHome(), argv: ["claude"], task } },
  } });
}

const expand = (p) => (p === "~" || p.startsWith("~/") ? home() + p.slice(1) : p);
export const slug = (s) => String(s ?? "").replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "");
const abs = (cfg, rel) => `${cfg.root}/${rel}`;
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const today = () => new Date().toISOString().slice(0, 10);

/** The Notes mod's settings (notes.json): its vault and the folder notes live under in it, or null without a vault. */
export async function notesConfig() {
  let own = {};
  try { own = JSON.parse(await readTextFile(`${appHome()}/notes.json`)) ?? {}; } catch { /* none yet */ }
  const vault = typeof own.vault === "string" && own.vault.trim() ? expand(own.vault.trim()) : null;
  if (!vault) return null;
  return {
    root: vault.replace(/\/+$/, ""),
    folder: String(own.folder ?? "Herdr").replace(/^\/+|\/+$/g, "") || "Herdr",
  };
}

/** The repo (its main checkout's folder name, so worktrees share it) and branch at `folder`. */
export async function gitContext(folder, machine) {
  if (!folder) return null;
  const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--abbrev-ref", "HEAD"],
    { cwd: folder, on: machine ?? undefined }).catch(() => null);
  if (!r || r.code) return null;
  const [common, branch] = r.stdout.trim().split("\n");
  const repo = common.replace(/\/\.git\/?$/, "").replace(/\.git$/, "").split("/").filter(Boolean).pop();
  return repo ? { repo, branch: branch && branch !== "HEAD" ? branch : null } : null;
}

const repoNote = (cfg, repo) => `${cfg.folder}/${slug(repo)}/${slug(repo)}.md`;
const featureNote = (cfg, repo, branch) => `${cfg.folder}/${slug(repo)}/${slug(branch)}.md`;

const repoTemplate = (repo) =>
  `---\ntags: [repo]\nrepo: ${repo}\n---\n# ${repo}\n\nWhat this repo is, how it's run, decisions that outlive a branch.\n\n## Features\n\n`;

const featureTemplate = (repo, branch) =>
  `---\ntags: [feature]\nrepo: ${repo}\nbranch: ${branch}\nstatus: active\ncreated: ${today()}\n---\n# ${branch}\n\nRepo: [[${slug(repo)}]]\n\n## Todos\n\n## Notes\n\n## Log\n`;

const noteTemplate = (title) => `# ${title}\n\n`;

/** Creates the note if it isn't there; true when it made it. */
async function ensure(cfg, rel, text) {
  if ((await readTextFile(abs(cfg, rel)).catch(() => null)) !== null) return false;
  await exec("mkdir", ["-p", `${cfg.root}/${dirOf(rel)}`]).catch(() => null);
  await writeTextFile(abs(cfg, rel), text, null);
  return true;
}

/** Adds `- [[branch]]` under the repo note's "## Features" (or at its end). */
async function linkFeature(cfg, repo, branch) {
  const rel = repoNote(cfg, repo), before = await readTextFile(abs(cfg, rel)).catch(() => null);
  if (before === null || before.includes(`[[${slug(branch)}]]`)) return;
  const lines = before.replace(/\n+$/, "").split("\n"), i = lines.findIndex((l) => /^##\s+Features/i.test(l));
  if (i < 0) lines.push("", `- [[${slug(branch)}]]`);
  else {
    let j = i + 1;
    while (j < lines.length && !/^#{1,2}\s/.test(lines[j])) j++;
    while (j > i + 1 && !lines[j - 1].trim()) j--;
    lines.splice(j, 0, ...(j === i + 1 ? [""] : []), `- [[${slug(branch)}]]`);
  }
  await writeTextFile(abs(cfg, rel), lines.join("\n") + "\n", before).catch(() => null);
}

/** `block` at the end of `## <heading>`, adding the heading when the note has none. */
function appendUnder(raw, heading, block) {
  const lines = raw.replace(/\n+$/, "").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l));
  if (start < 0) return `${lines.join("\n")}\n\n## ${heading}\n\n${block}\n`;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, "", block);
  return lines.join("\n") + "\n";
}

/** The message as a note block: its title, its body (first line left out when it is the title), and where it came from. */
function blockFor(text, label) {
  const title = noteTitle(text) || "Note";
  const lines = String(text ?? "").split("\n");
  const first = lines.findIndex((l) => l.trim());
  const body = (first >= 0 && noteTitle(lines.slice(first).join("\n")) === title
    ? [...lines.slice(0, first), ...lines.slice(first + 1)]
    : lines).join("\n").trim();
  return `### ${title}\n\n${body}\n\n*From ${label || "the chat"} · ${today()}*\n`;
}

/** A message's title: its first non-empty line, without Markdown marks (as the Notes panel names a note). */
export function noteTitle(text) {
  for (const line of String(text ?? "").split("\n")) {
    const t = line
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (t) return t;
  }
  return "";
}

/**
 * Saves `text` into the vault: the branch's feature note under "## Notes" when `cwd` is in a git
 * repo, else a note of its own at the vault's root (as the Notes panel's New note does).
 * Resolves with the note's path, or null when Notes has no vault configured.
 */
export async function sendToVault({ text, cwd, machine, label }) {
  const cfg = await notesConfig();
  if (!cfg) return null;
  const ctx = await gitContext(cwd, machine).catch(() => null);
  if (ctx?.branch) {
    const rel = featureNote(cfg, ctx.repo, ctx.branch);
    await ensure(cfg, repoNote(cfg, ctx.repo), repoTemplate(ctx.repo));
    const made = await ensure(cfg, rel, featureTemplate(ctx.repo, ctx.branch));
    if (made) await linkFeature(cfg, ctx.repo, ctx.branch);
    const before = (await readTextFile(abs(cfg, rel)).catch(() => null)) ?? featureTemplate(ctx.repo, ctx.branch);
    await writeTextFile(abs(cfg, rel), appendUnder(before, "Notes", blockFor(text, label)), before);
    return abs(cfg, rel);
  }
  const title = noteTitle(text) || "Note";
  const rel = `${title.replace(/[\\/:]/g, "-")}.md`;
  const before = await readTextFile(abs(cfg, rel)).catch(() => null);
  if (before === null) await writeTextFile(abs(cfg, rel), `${noteTemplate(title)}${blockFor(text, label)}`, null);
  else await writeTextFile(abs(cfg, rel), `${before.replace(/\n+$/, "")}\n\n${blockFor(text, label)}`, before);
  return abs(cfg, rel);
}
