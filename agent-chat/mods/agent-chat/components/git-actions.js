import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, checking } from "herdr";
import { icon } from "../ui/primitives.js";
import { onWindows } from "../platform.js";

/**
 * Buttons for the usual git chores, beside the status line over the reply box: Commit, Commit & push, Push, Open PR,
 * New branch & PR, and a link to the branch's open pull request. Which ones show follows the agent's folder: changed
 * files, commits not pushed yet, whether the branch is the repo's default one and whether it has a PR. A button sends
 * its request to the agent as a message (so the agent writes the commit message and the PR text), as if typed.
 *
 * Runs `git status` in the agent's folder every few seconds while the agent is idle, and `gh pr view` (which reaches
 * GitHub) at most once a minute per branch, only for a pushed branch that isn't the default one.
 */

const STATUS_EVERY = 4000, PR_EVERY = 60000;

const hex2 = n => (n < 16 ? "0" : "") + n.toString(16);
const alpha = (color, a) => (typeof color === "string" && /^#[0-9a-fA-F]{6}/.test(color)
  ? color.slice(0, 7) + hex2(Math.round(a * 255)) : color);

const PROMPTS = {
  commit: "Commit the current changes with a clear commit message. Don't push.",
  commitPush: "Commit the current changes with a clear commit message and push the branch.",
  commitPushPr: "Commit the current changes, push the branch and open a pull request for it.",
  push: "Push the branch.",
  pushPr: "Push the branch and open a pull request for it.",
  pr: "Open a pull request for this branch.",
  newBranchPr: "Make a new branch for the current changes, commit them, push the branch and open a pull request.",
};

export class GitActions {
  constructor(host) {
    this.host = host;
    this.state = null;       // { cwd, branch, upstream, ahead, behind, changed, base }
    this.prs = new Map();    // "cwd\0branch" -> { at, pr: { number, url, state } | null }
    this.bases = new Map();  // cwd -> default branch name
    this.repos = new Map();  // cwd -> "owner/repo" on GitHub, or ""
    this.at = 0; this.busy = false; this.wasWorking = false;
  }

  /** Called from the view's 100 ms tick: re-reads the repo every few seconds, and as soon as a turn ends. */
  tick(t, cx) {
    if (checking() || !t?.cwd || this.busy) return;
    const working = t.status === "working";
    const ended = this.wasWorking && !working;
    this.wasWorking = working;
    if (working) return;
    const moved = this.state?.cwd !== t.cwd || this.state?.machine !== t.machine;
    if (!ended && !moved && Date.now() - this.at < STATUS_EVERY) return;
    this.at = Date.now(); this.busy = true;
    if (moved) this.state = null;
    cx.spawn(async cx => {
      try {
        const next = await this.read(t, ended);
        if (JSON.stringify(next) !== JSON.stringify(this.state)) { this.state = next; cx.notify(); }
      } catch { /* not a repo, or git missing: no buttons */ }
      finally { this.busy = false; }
    });
  }

  async read(t, fresh) {
    const on = t.machine || undefined, cwd = t.cwd;
    const r = await exec("git", ["status", "--porcelain=v2", "--branch"], { cwd, on, timeout: 8000 });
    if (r.code !== 0) return null;
    const s = { cwd, machine: t.machine, branch: "", upstream: "", ahead: 0, behind: 0, changed: 0, untracked: 0, base: "" };
    for (const line of r.stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) s.branch = line.slice(14).trim();
      else if (line.startsWith("# branch.upstream ")) s.upstream = line.slice(18).trim();
      else if (line.startsWith("# branch.ab ")) { const m = line.match(/\+(\d+) -(\d+)/); if (m) { s.ahead = +m[1]; s.behind = +m[2]; } }
      // Untracked files ("? path") aren't changes git would commit: counted apart, so a folder of scratch files
      // doesn't offer Commit on a branch that is otherwise clean and pushed.
      else if (line.startsWith("? ")) s.untracked++;
      else if (line && !line.startsWith("#")) s.changed++;
    }
    if (!this.repos.has(cwd)) {
      const u = await exec("git", ["remote", "get-url", "origin"], { cwd, on, timeout: 8000 }).catch(() => null);
      const m = u?.code === 0 ? u.stdout.trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/) : null;
      this.repos.set(cwd, m ? m[1] : "");
    }
    if (!s.branch || s.branch === "(detached)") return null;
    if (!this.bases.has(cwd)) {
      const b = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd, on, timeout: 8000 }).catch(() => null);
      this.bases.set(cwd, b?.code === 0 ? b.stdout.trim().replace(/^origin\//, "") : "");
    }
    s.base = this.bases.get(cwd);
    if (s.upstream && !this.onBase(s)) {
      const key = `${on ?? ""}\0${cwd}\0${s.branch}`, known = this.prs.get(key);
      if (fresh || !known || Date.now() - known.at > PR_EVERY) {
        const p = await exec("gh", ["pr", "view", "--json", "number,url,state"], { cwd, on, timeout: 15000 }).catch(() => null);
        let pr = null;
        if (p?.code === 0) { try { pr = JSON.parse(p.stdout); } catch { pr = null; } }
        this.prs.set(key, { at: Date.now(), pr });
      }
      s.pr = this.prs.get(key)?.pr ?? null;
    }
    return s;
  }

  /** The GitHub repo ("owner/repo") of an agent's folder, once read; "" when it isn't one. */
  repoFor(cwd) {
    return (cwd && this.repos.get(cwd)) || "";
  }

  onBase(s) {
    return s.base ? s.branch === s.base : s.branch === "main" || s.branch === "master";
  }

  /** The buttons for the shown agent's repo, or null when there's nothing to do (or the agent is busy). */
  render(t, active) {
    const s = this.state;
    if (!s || !active || active.status === "working" || active.status === "blocked" || this.host.sending) return null;
    if (s.cwd !== active.cwd) return null;
    const onBase = this.onBase(s), open = s.pr?.state === "OPEN";
    const files = `${s.changed} changed file${s.changed === 1 ? "" : "s"}`;
    const ahead = s.ahead ? `${s.ahead} commit${s.ahead === 1 ? "" : "s"} not pushed` : "Branch not on GitHub yet";
    const unpushed = s.ahead > 0 || !s.upstream;
    const b = [];
    if (s.changed) {
      b.push(["commit", "Commit", "git-commit", t.ansi3, `${files} on ${s.branch}`]);
      if (onBase) b.push(["newBranchPr", "New branch & PR", "git-pull-request", t.ansi4, `${files} on ${s.branch}: move them to a new branch, commit, push and open a PR`]);
      else {
        b.push(["commitPush", "Commit & push", "cloud-upload", t.ansi2, `${files} on ${s.branch}`]);
        if (!open) b.push(["commitPushPr", "Commit, push & PR", "git-pull-request", t.ansi4, `${files}: commit, push ${s.branch} and open a PR`]);
      }
    } else if (unpushed && !onBase) {
      b.push(["push", "Push", "cloud-upload", t.ansi2, ahead]);
      if (!open) b.push(["pushPr", "Push & open PR", "git-pull-request", t.ansi4, `${ahead}: push ${s.branch} and open a PR`]);
    } else if (unpushed && onBase && s.ahead) {
      b.push(["push", `Push ${s.branch}`, "cloud-upload", t.ansi2, ahead]);
    } else if (!onBase && s.upstream && !s.pr) {
      b.push(["pr", "Open PR", "git-pull-request", t.ansi4, `Open a pull request for ${s.branch}`]);
    }
    const prChip = s.pr ? this.prLink(t, s.pr) : null;
    if (!b.length && !prChip) return null;
    return h_flex().flex_none().gap(6).items_center()
      .children(b.map(([id, label, glyph, col, tip]) => this.button(t, id, label, glyph, col || t.muted, tip)))
      .when(Boolean(prChip), el => el.child(prChip));
  }

  button(t, id, label, glyph, col, tip) {
    return h_flex().id(`git-act-${id}`).h(24).px(9).gap(5).flex_none().items_center().rounded(7).cursor_pointer()
      .bg(alpha(col, 0.1)).border_1().border_color(alpha(col, 0.35)).hover(s => s.bg(alpha(col, 0.22)))
      .tooltip(`${tip}\nAsks the agent: "${PROMPTS[id]}"`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.host.composer.sendPreset(PROMPTS[id], cx); })
      .child(icon(glyph, 12, col))
      .child(div().text_size(12).font_semibold().text_color(col).child(label));
  }

  /** The branch's pull request: its number and state, opening it in the browser. */
  prLink(t, pr) {
    const col = pr.state === "MERGED" ? t.ansi5 : pr.state === "CLOSED" ? t.ansi1 : t.ansi4;
    const state = pr.state === "MERGED" ? " merged" : pr.state === "CLOSED" ? " closed" : "";
    return h_flex().id("git-act-pr-link").h(24).px(9).gap(5).flex_none().items_center().rounded(7).cursor_pointer()
      .hover(s => s.bg(t.hover)).tooltip(`${pr.url}\nOpen in the browser`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (onWindows()) { exec("cmd", ["/c", "start", "", pr.url]).catch(() => {}); return; }
        exec("open", [pr.url]).then(r => { if (r.code !== 0) throw 0; }).catch(() => exec("xdg-open", [pr.url]).catch(() => {}));
      })
      .child(icon(pr.state === "MERGED" ? "git-merge" : "git-pull-request", 12, col))
      .child(div().text_size(12).text_color(col).child(`PR #${pr.number}${state}`))
      .child(icon("pop-out", 11, t.dim));
  }
}
