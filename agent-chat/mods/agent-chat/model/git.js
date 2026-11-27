/**
 * Git and GitHub actions in a shell step, read from its command and its output, so the chat can show them as coloured
 * chips (rows.js, gitChips): a new branch, a commit, a push, a pull request opened or merged. Each event is
 * `{ type, verb, detail, tip?, failed? }`; `type` picks the chip's colour and icon.
 *
 * A pattern only counts when the command ran that git/gh subcommand, so `cat`-ing a file that looks like git output
 * shows nothing.
 */

const CACHE = new WeakMap();

// `git <sub>`, allowing `git -C dir <sub>` and `git -c k=v <sub>`.
const ran = (cmd, sub) => new RegExp(`\\bgit(?:\\s+-[Cc]\\s+(?:"[^"]*"|'[^']*'|\\S+))*\\s+${sub}\\b`).test(cmd);
const ranGh = (cmd, sub) => new RegExp(`\\bgh\\s+pr\\s+${sub}\\b`).test(cmd);
const short = (s, n = 72) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The repo a push went to, "owner/repo", from git's "To <remote>" line. */
function pushRepo(out) {
  const m = out.match(/^To\s+(?:\S+@)?(?:https?:\/\/)?[^\s:/]+[:/]([^\s]+?)(?:\.git)?\s*$/m);
  return m ? m[1] : "";
}

export function gitEvents(c) {
  if (!c || c.k !== "shell") return [];
  let ev = CACHE.get(c);
  if (ev && ev.o === c.o) return ev.list;
  const list = parse(String(c.d || ""), String(c.o || ""));
  CACHE.set(c, { o: c.o, list });
  return list;
}

function parse(cmd, out) {
  if (!/\b(git|gh)\b/.test(cmd)) return [];
  const ev = [];
  const fatal = (/^(fatal|error):/m.test(out) || /\[rejected\]/.test(out));

  // Branches: made, switched to, deleted.
  if (ran(cmd, "(?:checkout|switch|branch|worktree)")) {
    for (const m of out.matchAll(/Switched to a new branch '([^']+)'/g)) ev.push({ type: "branch", verb: "New branch", detail: m[1] });
    if (!ev.length) {
      const m = cmd.match(/\bgit(?:\s+-C\s+\S+)?\s+(?:checkout\s+-[bB]|switch\s+-[cC]|worktree\s+add\b[^\n]*?\s-[bB])\s+['"]?([\w./-]+)/);
      if (m && !fatal) ev.push({ type: "branch", verb: "New branch", detail: m[1] });
    }
    for (const m of out.matchAll(/Switched to branch '([^']+)'/g)) ev.push({ type: "branch", verb: "Switched to", detail: m[1] });
    for (const m of out.matchAll(/Deleted branch (\S+) \(was ([0-9a-f]+)\)/g)) ev.push({ type: "deleted", verb: "Deleted branch", detail: m[1], tip: `was ${m[2]}` });
  }

  // Commits: "[branch sha] message" (also what cherry-pick and revert print).
  const committing = ran(cmd, "commit"), picking = ran(cmd, "cherry-pick"), reverting = ran(cmd, "revert");
  if (committing || picking || reverting) {
    const verb = picking ? "Cherry-picked" : reverting ? "Reverted" : /--amend\b/.test(cmd) ? "Amended" : "Committed";
    for (const m of out.matchAll(/^\[([^\s\]]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/gm)) {
      const stat = out.slice(m.index).match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
      ev.push({
        type: "commit", verb, detail: `${m[2].slice(0, 7)}  ${short(m[3], 60)}`,
        tip: `${m[3]}\non ${m[1]}${stat ? ` · ${stat[1]} file${stat[1] === "1" ? "" : "s"}, +${stat[2] ?? 0} −${stat[3] ?? 0}` : ""}`,
      });
    }
    if (committing && !ev.some(e => e.type === "commit") && fatal) ev.push({ type: "failed", verb: "Commit failed", detail: firstError(out) });
    if (committing && /nothing to commit|no changes added to commit/.test(out)) ev.push({ type: "muted", verb: "Nothing to commit", detail: "" });
  }

  // Merges and resets.
  if (ran(cmd, "merge")) {
    if (/Already up to date/.test(out)) ev.push({ type: "muted", verb: "Already up to date", detail: "" });
    else if (/^Fast-forward$/m.test(out) || /Merge made by/.test(out)) {
      const src = cmd.match(/\bgit\s+merge\s+(?:--?\S+\s+)*['"]?([\w./-]+)/);
      ev.push({ type: "merged", verb: "Merged", detail: src ? src[1] : "" });
    } else if (/CONFLICT/.test(out)) ev.push({ type: "failed", verb: "Merge conflict", detail: firstMatch(out, /CONFLICT[^\n]*in (\S+)/) });
  }
  if (ran(cmd, "rebase")) {
    if (/Successfully rebased/.test(out)) ev.push({ type: "merged", verb: "Rebased", detail: firstMatch(out, /Successfully rebased and updated (\S+)/).replace(/^refs\/heads\//, "") });
    else if (/CONFLICT/.test(out)) ev.push({ type: "failed", verb: "Rebase conflict", detail: firstMatch(out, /CONFLICT[^\n]*in (\S+)/) });
  }
  if (ran(cmd, "reset")) {
    const m = out.match(/HEAD is now at ([0-9a-f]+) (.*)/);
    if (m) ev.push({ type: "muted", verb: "Reset to", detail: `${m[1].slice(0, 7)}  ${short(m[2], 50)}`, tip: m[2] });
  }
  if (ran(cmd, "tag") && !/\s-[dl]\b|--list|--delete/.test(cmd)) {
    const m = cmd.match(/\bgit\s+tag\s+(?:-[as]\s+)?(?:-m\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?['"]?([\w./-]+)/);
    if (m && !fatal) ev.push({ type: "tag", verb: "Tagged", detail: m[1] });
  }

  // Pushes: one chip per ref line, or the rejection.
  if (ran(cmd, "push")) {
    const repo = pushRepo(out);
    let any = false;
    for (const m of out.matchAll(/^\s*([ +*\-!=])\s+(\S+(?:\.\.\.?\S+)?|\[[^\]]+\])\s+(\S+)\s+->\s+(\S+)(?:\s+\(([^)]+)\))?$/gm)) {
      const [, flag, what, , to, note] = m;
      any = true;
      if (flag === "!") { ev.push({ type: "failed", verb: "Push rejected", detail: to, tip: note || "" }); continue; }
      if (flag === "-") { ev.push({ type: "deleted", verb: "Deleted remote", detail: to, tip: repo }); continue; }
      if (flag === "=") continue;
      const fresh = /new branch/.test(what), tag = /new tag/.test(what), force = flag === "+";
      ev.push({
        type: tag ? "tag" : "push",
        verb: tag ? "Pushed tag" : force ? "Force-pushed" : fresh ? "Pushed new branch" : "Pushed",
        detail: to, tip: [repo, /\.\./.test(what) ? what : ""].filter(Boolean).join("  "),
      });
    }
    if (!any && /Everything up-to-date/.test(out)) ev.push({ type: "muted", verb: "Already pushed", detail: "" });
    else if (!any && fatal) ev.push({ type: "failed", verb: "Push failed", detail: firstError(out) });
  }

  // GitHub pull requests.
  const prUrl = out.match(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/);
  const prArg = (sub) => firstMatch(cmd, new RegExp(`\\bgh\\s+pr\\s+${sub}\\s+(?:[^\\n]*?\\s)?#?(\\d+)\\b`));
  if (ranGh(cmd, "create")) {
    if (prUrl) ev.push({ type: "pr", verb: "Opened PR", detail: `#${prUrl[2]}`, tip: prUrl[0] });
    else if (fatal || /already exists/.test(out)) ev.push({ type: "failed", verb: "PR not opened", detail: firstError(out) || short(out.trim().split("\n").pop() || "", 60) });
  }
  if (ranGh(cmd, "merge")) {
    const m = out.match(/(?:Squashed and merged|Rebased and merged|Merged) pull request (?:\S+)?#(\d+)/);
    if (m) ev.push({ type: "merged", verb: "Merged PR", detail: `#${m[1]}`, tip: firstMatch(out, /pull request [^\n]*/) });
    else if (/[Ff]ailed|not mergeable|error/.test(out)) ev.push({ type: "failed", verb: "PR merge failed", detail: prArg("merge") ? `#${prArg("merge")}` : "" });
    else if (/auto-merge/i.test(out)) ev.push({ type: "pr", verb: "Auto-merge on", detail: prArg("merge") ? `#${prArg("merge")}` : "" });
  }
  for (const [sub, verb] of [["edit", "Edited PR"], ["comment", "Commented on PR"], ["close", "Closed PR"], ["ready", "Marked PR ready"], ["reopen", "Reopened PR"]]) {
    if (!ranGh(cmd, sub)) continue;
    const n = prUrl?.[2] || prArg(sub) || firstMatch(out, /#(\d+)/);
    if (fatal || /^(GraphQL|HTTP \d)/m.test(out)) ev.push({ type: "failed", verb: `${verb.replace(/ PR$/, "")} failed`, detail: n ? `#${n}` : "" });
    else ev.push({ type: sub === "close" ? "deleted" : "pr", verb, detail: n ? `#${n}` : "", tip: prUrl?.[0] });
  }
  if (ranGh(cmd, "checkout")) {
    const m = out.match(/Switched to (?:a new )?branch '([^']+)'/);
    if (m) ev.push({ type: "branch", verb: "Checked out PR", detail: m[1] });
  }
  return ev;
}

function firstMatch(s, re) {
  const m = s.match(re);
  return m ? m[1] : "";
}

function firstError(out) {
  const m = out.match(/^(?:fatal|error|remote: error):\s*(.+)$/m);
  return m ? short(m[1], 60) : "";
}
