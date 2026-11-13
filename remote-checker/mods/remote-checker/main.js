// Remote Checker: the pull request for the focused terminal's branch (its upstream on GitHub):
// CI checks, reviewers, review threads and comments, diff size, commits. Refetches every 10 s
// while the panel shows, and on `r` / the refresh button.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, settings, run, nextCommand, focused, panes, spaces, setShared, home } from "herdr";
import { keybar, keysCard } from "./keybar.js";
import { SelfUpdate } from "./update.js";
import { closePanel, panelOnScreen } from "./panel.js";

const ICON = "mods/remote-checker", CHROME = "mods/workspace-chrome";
const POLL_MS = 10_000, LOOKUP_MS = 60_000;

const QUERY = `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
  number title url state isDraft createdAt publishedAt updatedAt mergedAt closedAt
  author{login} baseRefName headRefName headRefOid additions deletions changedFiles
  reviewDecision mergeable mergeStateStatus
  commits(last:1){totalCount nodes{commit{oid committedDate messageHeadline statusCheckRollup{state contexts(first:100){totalCount nodes{
    __typename
    ... on CheckRun{name status conclusion detailsUrl isRequired(pullRequestNumber:$n) checkSuite{workflowRun{workflow{name}}}}
    ... on StatusContext{context state targetUrl isRequired(pullRequestNumber:$n)}
  }}}}}}
  reviewRequests(first:30){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name} ... on Bot{login} ... on Mannequin{login}}}}
  latestReviews(first:30){nodes{state submittedAt url author{login}}}
  comments(last:20){totalCount nodes{url createdAt body author{login}}}
  reviewThreads(first:100){totalCount nodes{isResolved isOutdated path comments(first:1){totalCount nodes{url createdAt body author{login}}}}}
}}}`;

const KEYS = {
  moving: [
    { caps: ["j", "k"], label: "move" }, { caps: ["g", "G"], label: "top / bottom" },
    { caps: ["ctrl-d", "ctrl-u"], label: "half page" }, { caps: ["]", "["], label: "next / prev section" },
  ],
  acting: [
    { caps: ["enter"], label: "open in browser" }, { caps: ["O"], label: "open the pull request" },
    { caps: ["y"], label: "copy link" }, { caps: ["r"], label: "refetch now" }, { caps: ["h"], label: "back to the terminal" }, { caps: ["escape"], label: "back to the terminal" }, { caps: ["q"], label: "close the panel" },
  ],
};
const FOOTER = [
  { caps: ["enter"], label: "open" }, { caps: ["r"], label: "refetch" }, { caps: ["j", "k"], label: "move" },
  { caps: ["O"], label: "PR" }, { caps: ["y"], label: "copy" }, { caps: ["]", "["], label: "section" },
];

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const num = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
const tilde = (p) => p && p.startsWith(home()) ? "~" + p.slice(home().length) : p;

// The first line of a comment worth reading: no HTML, markdown headings, badges or blank lines.
function snippet(body) {
  const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  for (let line of text.split("\n")) {
    line = line.replace(/^[#>*\-\s]+/, "").replace(/\*\*|__|`/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if (line.length > 1) return line;
  }
  return "(no text)";
}

// A check's outcome: "fail" | "pending" | "pass" | "skip".
function checkOutcome(c) {
  if (c.__typename === "StatusContext") {
    return c.state === "SUCCESS" ? "pass" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "fail";
  }
  if (c.status !== "COMPLETED") return "pending";
  if (c.conclusion === "SUCCESS") return "pass";
  if (c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED" || c.conclusion === "STALE") return "skip";
  return "fail";
}
const OUTCOME_ORDER = { fail: 0, pending: 1, pass: 2, skip: 3 };

function shape(pr) {
  const commit = pr.commits.nodes[0]?.commit;
  const checks = (commit?.statusCheckRollup?.contexts.nodes ?? []).filter(Boolean).map((c) => ({
    name: c.__typename === "CheckRun" ? c.name : c.context,
    workflow: c.checkSuite?.workflowRun?.workflow?.name ?? null,
    url: c.detailsUrl ?? c.targetUrl ?? null,
    required: Boolean(c.isRequired),
    outcome: checkOutcome(c),
  })).sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));

  const me = pr.author?.login;
  const reviewers = new Map();
  for (const r of pr.latestReviews.nodes) {
    const login = r.author?.login;
    if (!login || login === me) continue;
    reviewers.set(login, { name: login, state: r.state, at: r.submittedAt, url: r.url });
  }
  for (const n of pr.reviewRequests.nodes) {
    const rr = n.requestedReviewer;
    const name = rr?.login ?? (rr?.name ? `team: ${rr.name}` : null);
    if (!name) continue;
    const had = reviewers.get(name);
    reviewers.set(name, { name, state: "PENDING", at: null, url: pr.url, rerequested: Boolean(had) });
  }
  const REVIEW_ORDER = { CHANGES_REQUESTED: 0, PENDING: 1, APPROVED: 2, COMMENTED: 3, DISMISSED: 4 };
  const reviewerList = [...reviewers.values()].sort((a, b) => (REVIEW_ORDER[a.state] ?? 9) - (REVIEW_ORDER[b.state] ?? 9) || a.name.localeCompare(b.name));

  const threads = pr.reviewThreads.nodes.map((t) => {
    const c = t.comments.nodes[0];
    return { kind: "thread", resolved: t.isResolved, outdated: t.isOutdated, path: t.path, replies: t.comments.totalCount - 1,
      author: c?.author?.login ?? "ghost", at: c?.createdAt, url: c?.url ?? pr.url, text: snippet(c?.body) };
  });
  const conversation = pr.comments.nodes.map((c) => ({ kind: "comment", author: c.author?.login ?? "ghost", at: c.createdAt, url: c.url, text: snippet(c.body) }));
  // Unresolved threads first (what needs an answer), then the conversation, newest first.
  const comments = [
    ...threads.filter((t) => !t.resolved).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    ...conversation.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    ...threads.filter((t) => t.resolved).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  ];

  return {
    number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft,
    author: me, base: pr.baseRefName, head: pr.headRefName, headOid: pr.headRefOid,
    published: pr.publishedAt ?? pr.createdAt, updated: pr.updatedAt, merged: pr.mergedAt, closed: pr.closedAt,
    additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles,
    commits: pr.commits.totalCount, lastCommit: commit ? { oid: commit.oid, at: commit.committedDate, headline: commit.messageHeadline } : null,
    decision: pr.reviewDecision, mergeable: pr.mergeable, mergeState: pr.mergeStateStatus,
    checks, reviewers: reviewerList, comments,
    threads: { total: threads.length, resolved: threads.filter((t) => t.resolved).length },
    conversationCount: pr.comments.totalCount,
  };
}

export default class RemoteChecker extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("remote-checker", "Remote Checker"); this.selfUpdate.start(cx);
    this.handle = cx.focus_handle();
    this.scrollY = 0;
    this.sel = 0;
    this.data = null;      // { key, git, pr, error, at }
    this.lookups = {};     // context key -> { owner, repo, number | null, at }
    this.fetching = false;
    this.lastCtx = null;

    cx.timer.every(POLL_MS, (cx) => { if (this.visible()) this.refresh(cx); });
    // Follow the focused terminal: fetch at once when its repo/branch changes or the panel comes into view.
    // (Never from render: notifying while rendering throws.)
    cx.timer.every(400, (cx) => {
      const shown = this.visible(), key = this.ctxKey(this.context());
      if (shown && key && ((key !== this.data?.key && key !== this.fetchingKey) || !this.wasShown)) this.refresh(cx);
      if (key !== this.seenKey) { this.seenKey = key; cx.notify(); }
      this.wasShown = shown;
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          // One retry in case the first focus didn't land; leaving the panel meanwhile cancels it.
          const token = this.focusToken = (this.focusToken ?? 0) + 1;
          this.handle.focus();
          // Focus that landed and then moved (a click, the leader popup) is the person's choice: no retry.
          cx.timer.after(40, () => { if (this.handle.is_focused()) this.leave(); });
          cx.timer.after(150, (cx) => { if (this.focusToken === token && !this.handle.is_focused()) { this.handle.focus(); cx.notify(); } });
        }
        else if (c.startsWith("go:")) this.go(c.slice(3));
        else if (c.startsWith("key:")) this.press(c.slice(4), cx);
        else if (c === "refresh") this.refresh(cx, true);
        cx.notify();
      }
    });
    // No blur event for a focus handle: poll it, redraw only on change, and share it for the leader.
    cx.timer.every(300, (cx) => {
      const k = this.handle.is_focused();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("remote-checker.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
  }

  // ---- Where to look ---------------------------------------------------------

  // Shown in the right panel (or anywhere else it's placed, e.g. as a pane).
  visible() {
    return panelOnScreen("remote-checker") ?? true;
  }

  // The active space's focused terminal folder (else the space's own folder).
  context() {
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
    if (!space) return this.lastCtx;
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const cwd = (pane?.terminal ? pane.cwd : null) ?? f?.cwd ?? space.folder ?? null;
    const branch = pane?.terminal ? pane.branch : space.branch;
    if (cwd) this.lastCtx = { cwd, branch: branch ?? null, machine: space.machine ?? null };
    return this.lastCtx;
  }

  ctxKey(ctx) { return ctx ? `${ctx.machine ?? ""}|${ctx.cwd}|${ctx.branch ?? ""}` : ""; }

  // ---- Fetching ---------------------------------------------------------------

  refresh(cx, force = false) {
    const ctx = this.context();
    if (!ctx) return;
    if (this.fetching) { this.again = true; return; }
    const key = this.ctxKey(ctx);
    this.fetching = true; this.fetchingKey = key;
    cx.notify();
    cx.spawn(async (cx) => {
      let result;
      try { result = await this.load(ctx, force); }
      catch (e) { result = { error: String(e?.message ?? e) }; }
      finally { this.fetching = false; this.fetchingKey = null; }
      // The focus moved to another repo meanwhile: that one's fetch is next.
      if (key === this.ctxKey(this.context())) {
        const prevKey = this.data?.key;
        // A failed refetch keeps the last good pull request on screen, marked stale.
        if (result.error && prevKey === key && this.data?.pr) result = { ...this.data, error: result.error };
        this.data = { ...result, key, at: Date.now() };
        if (prevKey !== key) { this.sel = 0; this.scrollY = 0; }
      }
      cx.notify();
      if (this.again || key !== this.ctxKey(this.context())) { this.again = false; this.refresh(cx); }
    });
  }

  async load(ctx, force) {
    const on = ctx.machine ?? undefined;
    const script = 'cd "$1" 2>/dev/null || exit 2; git rev-parse --git-dir >/dev/null 2>&1 || exit 3; '
      + 'b=$(git branch --show-current); h=$(git rev-parse HEAD 2>/dev/null); '
      + 'u=$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null); c=""; url=""; '
      + 'if [ -n "$u" ]; then c=$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null); r=$(git config "branch.$b.remote"); url=$(git remote get-url "$r" 2>/dev/null); fi; '
      + 'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$b" "$u" "$c" "$url" "$h"';
    const r = await exec("sh", ["-c", script, "remote-checker", ctx.cwd], { on, timeout: 15_000 });
    if (r.code === 2 || r.code === 3) return { git: null, notRepo: true };
    const [branch, upstream, counts, remoteUrl, head] = r.stdout.split("\n");
    const [ahead, behind] = (counts || "0\t0").split(/\s+/).map(Number);
    const git = { cwd: ctx.cwd, branch: branch || null, upstream: upstream || null, ahead, behind, remoteUrl: remoteUrl || null, head: head || null };
    if (!git.branch) return { git, detached: true };
    if (!git.upstream) return { git, unpushed: true };

    const lk = this.ctxKey(ctx) + "|" + git.upstream;
    let found = this.lookups[lk];
    if (force || !found || found.number === null || Date.now() - found.at > LOOKUP_MS) {
      const v = await exec("gh", ["pr", "view", "--json", "number,url"], { cwd: ctx.cwd, on, timeout: 20_000 });
      if (v.code !== 0) {
        const err = (v.stderr || v.stdout).trim();
        if (/no (open )?pull requests? found/i.test(err)) found = { number: null, at: Date.now() };
        else return { git, error: err || "gh pr view failed" };
      } else {
        const j = JSON.parse(v.stdout), m = j.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);
        found = { number: j.number, owner: m?.[1], repo: m?.[2], at: Date.now() };
      }
      this.lookups[lk] = found;
    }
    if (found.number === null) return { git, noPr: true };

    const q = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${found.owner}`, "-f", `repo=${found.repo}`, "-F", `n=${found.number}`],
      { cwd: ctx.cwd, on, timeout: 20_000 });
    if (q.code !== 0) return { git, error: (q.stderr || q.stdout).trim() || "gh api failed" };
    const json = JSON.parse(q.stdout);
    const pr = json.data?.repository?.pullRequest;
    if (!pr) return { git, error: json.errors?.[0]?.message ?? "Pull request not found" };
    return { git, pr: shape(pr), repo: `${found.owner}/${found.repo}` };
  }

  // ---- Rows -------------------------------------------------------------------

  // Every row of the list with its exact height; `url` makes it selectable.
  rows() {
    const d = this.data, out = [];
    if (!d?.pr) return out;
    const pr = d.pr;
    out.push({ key: "pr", h: 140, url: pr.url, kind: "pr" });
    out.push({ key: "summary", h: 146, url: `${pr.url}/checks`, kind: "summary" });
    const section = (id, title, count, items, empty, kind, h) => {
      out.push({ key: `h-${id}`, h: 30, kind: "section", title, count, section: id });
      if (!items.length) out.push({ key: `e-${id}`, h: 28, kind: "empty", text: empty, section: id });
      items.forEach((it, i) => out.push({ key: `${id}-${i}`, h, kind, item: it, url: it.url, section: id }));
    };
    const passed = pr.checks.filter((c) => c.outcome === "pass" || c.outcome === "skip").length;
    section("checks", "Checks", pr.checks.length ? `${passed}/${pr.checks.length}` : "", pr.checks, "No checks on the last commit", "check", 30);
    section("reviewers", "Reviewers", pr.reviewers.length ? String(pr.reviewers.length) : "", pr.reviewers, "No reviewers yet", "reviewer", 30);
    const open = pr.threads.total - pr.threads.resolved;
    section("comments", "Comments", open ? `${open} unresolved` : pr.comments.length ? String(pr.comments.length) : "", pr.comments, "No comments", "comment", 50);
    return out;
  }

  selectable(rows) { return rows.map((r, i) => (r.url ? i : -1)).filter((i) => i >= 0); }

  selectedRow(rows = this.rows()) {
    const s = this.selectable(rows);
    return s.length ? rows[s[Math.min(this.sel, s.length - 1)]] : null;
  }

  // ---- Keys -------------------------------------------------------------------

  key(e, cx) {
    const m = e.modifiers ?? {};
    // cmd-alt-arrows (keys.json pane.go) handled here, so leaving the panel never depends on
    // pane.go knowing this panel holds the keyboard.
    if (m.platform && m.alt && !m.control && ["left", "right", "up", "down"].includes(e.key)) { cx.stop_propagation(); this.go(e.key); return; }
    if (this.press(keyOf(e), cx)) cx.stop_propagation();
  }

  // Cancels a pending focus retry, so leaving quickly isn't undone.
  leave() { this.focusToken = (this.focusToken ?? 0) + 1; }

  // The panel is the rightmost column: left goes back to the terminal the keyboard came from
  // (the focused pane); other directions are pane.go's.
  go(dir) {
    this.leave();
    const pane = focused()?.pane;
    if (dir === "left" && pane) return run("pane.focus", { pane });
    this.handle.focus();
    run("pane.go", { direction: dir });
  }

  press(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") this.keysOpen = false;
      cx.notify(); return true;
    }
    const rows = this.rows(), sel = this.selectable(rows), n = sel.length;
    const move = (i) => {
      if (!n) return;
      this.sel = Math.max(0, Math.min(n - 1, i));
      this.reveal(rows, sel[this.sel]);
      cx.notify();
    };
    const prevG = this.pendingG; this.pendingG = false;
    const sectionJump = (dir) => {
      const cur = rows[sel[Math.min(this.sel, n - 1)]]?.section ?? null;
      const order = sel.map((i) => rows[i]);
      if (dir > 0) { const j = order.findIndex((r, i) => i > this.sel && r.section && r.section !== cur); if (j >= 0) move(j); }
      else {
        // Start of this section, else start of the previous one.
        let j = this.sel;
        while (j > 0 && order[j - 1].section === cur && cur) j--;
        if (j === this.sel && j > 0) { const prev = order[j - 1].section; j--; while (j > 0 && order[j - 1].section === prev) j--; }
        move(j);
      }
    };
    switch (k) {
      case "?": this.keysOpen = true; cx.notify(); return true;
      case "j": case "down": move(this.sel + 1); return true;
      case "k": case "up": move(this.sel - 1); return true;
      case "g": if (prevG) move(0); else this.pendingG = true; return true;
      case "<": case "home": move(0); return true;
      case "G": case ">": case "end": move(n - 1); return true;
      case "ctrl-d": case "pagedown": move(this.sel + 6); return true;
      case "ctrl-u": case "pageup": move(this.sel - 6); return true;
      case "]": sectionJump(1); return true;
      case "[": sectionJump(-1); return true;
      case "h": case "left": this.go("left"); return true;
      case "enter": case "o": case "l": { const r = this.selectedRow(rows); if (r?.url) exec("open", [r.url]); return true; }
      case "O": if (this.data?.pr) exec("open", [this.data.pr.url]); return true;
      case "y": {
        const r = this.selectedRow(rows), url = r?.url ?? this.data?.pr?.url;
        if (url) { exec("sh", ["-c", 'printf %s "$1" | pbcopy', "copy", url]); this.flash("Copied " + url.replace(/^https:\/\/github\.com\//, ""), cx); }
        return true;
      }
      case "r": this.refresh(cx, true); return true;
      // Escape gives the keyboard back to the terminal; q also closes the panel.
      case "escape": this.leave(); if (focused()?.pane) run("pane.focus", { pane: focused().pane }); return true;
      case "q":
        this.leave();
        closePanel("remote-checker");
        return true;
    }
    return false;
  }

  // Rows are drawn in a clipped box shifted up by scrollY; heights are known, so scrolling is arithmetic.
  maxScroll(rows = this.rows()) { return Math.max(0, rows.reduce((h, r) => h + r.h, 0) + 8 - (this.bodyH ?? 0)); }
  scrollTo(y, rows) { this.scrollY = Math.max(0, Math.min(this.maxScroll(rows), y)); }
  reveal(rows, idx) {
    let top = 0;
    for (let i = 0; i < idx; i++) top += rows[i].h;
    // Keep the section header above the first item of a section in view too.
    const head = idx > 0 && rows[idx - 1].kind === "section" ? rows[idx - 1].h : 0;
    const view = this.bodyH ?? 0, bottom = top + rows[idx].h;
    if (top - head < this.scrollY) this.scrollTo(top - head, rows);
    else if (bottom > this.scrollY + view) this.scrollTo(bottom - view + 8, rows);
  }

  flash(text, cx) {
    this.flashText = text; cx.notify();
    const mine = text;
    cx.timer.after(1600, (cx) => { if (this.flashText === mine) { this.flashText = null; cx.notify(); } });
  }

  // ---- Rendering ----------------------------------------------------------------

  colors(t) {
    return { pass: t.ansi2, fail: t.ansi1, pending: t.ansi3, skip: t.dim, track: t.raised };
  }

  iconButton(id, icon, tip, action, t, { spin = false } = {}) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(spin ? svg(`${CHROME}/spinner.svg`).size(14).spin(900) : svg(icon).size(14));
  }

  pill(text, bg, fg) {
    return div().flex_none().h(20).px(8).flex().items_center().rounded_full().bg(bg).text_color(fg).text_size(11).font_semibold().child(text);
  }

  // A segmented bar: [{ n, color }]; nothing to show draws an empty track.
  bar(t, parts) {
    const total = parts.reduce((s, p) => s + p.n, 0);
    if (!total) return div().h(8).w_full().rounded_full().bg(t.raised).border_1().border_color(t.border);
    const shown = parts.filter((p) => p.n > 0);
    return h_flex().h(8).w_full().rounded_full().overflow_hidden().gap(2).bg(t.background)
      .children(shown.map((p, i) => div().h_full().flex_grow(p.n).flex_shrink(1).flex_basis(0).bg(p.color)
        .when(Boolean(p.pulse), (e) => e.loop("opacity", { from: 0.55, to: 1, period: 1400 }))));
  }

  stateLook(pr, t) {
    if (pr.state === "MERGED") return { label: "Merged", bg: t.ansi5, fg: t.background };
    if (pr.state === "CLOSED") return { label: "Closed", bg: t.ansi1, fg: t.background };
    if (pr.draft) return { label: "Draft", bg: t.raised, fg: t.muted };
    return { label: "Open", bg: t.ansi2, fg: t.background };
  }

  prCard(pr, t, mono) {
    const st = this.stateLook(pr, t), git = this.data.git;
    const stat = (text, color) => div().flex_none().text_color(color).child(text);
    return v_flex().size_full().p(12).gap(5).rounded(9).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().gap(7).items_center()
        .child(this.pill(st.label, st.bg, st.fg))
        .child(div().flex_none().text_color(t.dim).font_family(mono).text_size(12).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${pr.base} ← ${pr.head}`)))
      .child(div().truncate().font_semibold().text_size(13.5).child(pr.title))
      .child(div().truncate().text_size(11.5).text_color(t.dim)
        .child(`@${pr.author ?? "ghost"} · ${pr.state === "MERGED" ? `merged ${ago(pr.merged)}` : `published ${ago(pr.published)}`} · updated ${ago(pr.updated)}`))
      .child(h_flex().pt(3).gap(10).items_center().text_size(12).font_family(mono)
        .child(stat(`+${num(pr.additions)}`, t.ansi2))
        .child(stat(`−${num(pr.deletions)}`, t.ansi1))
        .child(stat(plural(pr.files, "file"), t.muted))
        .child(stat(plural(pr.commits, "commit"), t.muted))
        .child(div().flex_1())
        .when(git && (git.ahead > 0 || git.behind > 0), (el) => el.child(h_flex().gap(6).flex_none()
          .when(git.ahead > 0, (e) => e.child(stat(`↑${git.ahead} unpushed`, t.ansi3)))
          .when(git.behind > 0, (e) => e.child(stat(`↓${git.behind} behind`, t.ansi4))))));
  }

  summaryCard(pr, t) {
    const c = this.colors(t);
    const count = (o) => pr.checks.filter((x) => x.outcome === o).length;
    const fail = count("fail"), pending = count("pending"), pass = count("pass"), skip = count("skip");
    const reqPending = pr.checks.filter((x) => x.required && x.outcome === "pending").length;
    const reqFail = pr.checks.filter((x) => x.required && x.outcome === "fail").length;

    let title, color, icon;
    if (!pr.checks.length) { title = "No checks reported"; color = t.dim; icon = "minus"; }
    else if (fail) { title = "Some checks were not successful"; color = c.fail; icon = "x"; }
    else if (pending) { title = "Some checks haven't completed yet"; color = c.pending; icon = "ring"; }
    else { title = "All checks have passed"; color = c.pass; icon = "check"; }
    const sub = [fail && `${fail} failing`, pending && `${pending} pending`, pass && `${pass} successful`, skip && `${skip} skipped`].filter(Boolean).join(", ");

    const MERGE = { CLEAN: "Ready to merge", BLOCKED: "Merging is blocked", BEHIND: "Branch is out of date", DIRTY: "Has merge conflicts",
      UNSTABLE: "Mergeable, some checks failing", DRAFT: "Draft", HAS_HOOKS: "Mergeable (hooks)", UNKNOWN: "Merge state unknown" };
    const DECISION = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };
    const mergeText = pr.state === "OPEN" ? [MERGE[pr.mergeState] ?? pr.mergeState, DECISION[pr.decision]].filter(Boolean).join(" · ") : "";

    const approved = pr.reviewers.filter((r) => r.state === "APPROVED").length;
    const changes = pr.reviewers.filter((r) => r.state === "CHANGES_REQUESTED").length;
    const waiting = pr.reviewers.filter((r) => r.state === "PENDING").length;
    const open = pr.threads.total - pr.threads.resolved;

    const col = (label, note, noteColor, parts, last) => v_flex().flex_1().min_w(0).px(10).py(9).gap(7)
      .when(!last, (e) => e.border_r(1).border_color(t.border))
      .child(h_flex().gap(5).items_baseline().min_w(0)
        .child(div().flex_none().font_semibold().text_size(12).child(label))
        .child(div().min_w(0).truncate().text_size(11).text_color(noteColor ?? t.dim).child(note)))
      .child(this.bar(t, parts));

    const checkNote = reqFail ? `${reqFail} req. failing` : reqPending ? `${reqPending} req. pending` : pr.checks.length ? `${pass + skip}/${pr.checks.length}` : "";
    const commentNote = open ? `${open} open` : pr.threads.total ? "resolved" : pr.conversationCount ? `${pr.conversationCount}` : "";
    const reviewNote = changes ? `${changes} changes` : waiting ? `${waiting} pending` : approved ? `${approved} approved` : "";

    return v_flex().size_full().rounded(9).bg(t.surface).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().flex_1().px(12).gap(11).items_center().border_b(1).border_color(t.border)
        .child(div().size(34).flex_none().rounded_full().flex().items_center().justify_center().bg(t.raised)
          .child(icon === "ring" ? svg(`${ICON}/ring.svg`).size(20).text_color(color).spin(1400) : svg(`${ICON}/${icon}.svg`).size(18).text_color(color)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().font_semibold().text_size(13).child(title))
          .child(div().truncate().text_size(11.5).text_color(t.muted).child(sub ? `${sub} check${pass + fail + pending + skip === 1 ? "" : "s"}.` : "Nothing ran on the last commit."))
          .when(Boolean(mergeText), (e) => e.child(div().truncate().text_size(11).text_color(t.dim).child(mergeText)))))
      .child(h_flex().flex_none().h(54)
        .child(col("Checks", checkNote, reqFail ? c.fail : null, [
          { n: pass + skip, color: c.pass }, { n: pending, color: c.pending, pulse: true }, { n: fail, color: c.fail }]))
        .child(col("Comments", commentNote, open ? c.pending : null, [
          { n: pr.threads.resolved, color: c.pass }, { n: open, color: c.pending }]))
        .child(col("Approvals", reviewNote, changes ? c.fail : null, [
          { n: approved, color: c.pass }, { n: changes, color: c.fail }, { n: waiting, color: t.dim }], true)));
  }

  checkRow(ch, t) {
    const c = this.colors(t)[ch.outcome];
    const icon = ch.outcome === "pass" ? svg(`${ICON}/check.svg`).size(13).text_color(c)
      : ch.outcome === "fail" ? svg(`${ICON}/x.svg`).size(13).text_color(c)
      : ch.outcome === "pending" ? svg(`${ICON}/ring.svg`).size(13).text_color(c).spin(1400)
      : svg(`${ICON}/minus.svg`).size(13).text_color(c);
    return [icon,
      div().flex_1().min_w(0).truncate().text_color(ch.outcome === "skip" ? t.dim : t.foreground)
        .child(ch.workflow && ch.workflow !== ch.name ? `${ch.workflow} / ${ch.name}` : ch.name),
      ch.required ? div().flex_none().text_size(10.5).text_color(t.dim).child("required") : null];
  }

  reviewerRow(r, t) {
    const LOOK = {
      APPROVED: ["approved", t.ansi2, "check"], CHANGES_REQUESTED: ["changes requested", t.ansi1, "x"],
      COMMENTED: ["commented", t.muted, "comment"], DISMISSED: ["dismissed", t.dim, "minus"],
      PENDING: [r.rerequested ? "re-requested" : "awaiting review", t.ansi3, "dot"],
    };
    const [label, color, icon] = LOOK[r.state] ?? [r.state.toLowerCase(), t.dim, "dot"];
    return [svg(`${ICON}/${icon}.svg`).size(13).text_color(color),
      div().flex_1().min_w(0).truncate().child(r.name),
      div().flex_none().text_size(11).text_color(color).child(r.at ? `${label} · ${ago(r.at)}` : label)];
  }

  commentRow(cm, t) {
    const where = cm.kind === "thread" ? (cm.path ? cm.path.split("/").slice(-2).join("/") : "review") : "conversation";
    const tag = cm.kind === "thread" ? (cm.resolved ? "resolved" : cm.outdated ? "outdated" : "unresolved") : null;
    const tagColor = cm.resolved ? t.ansi2 : cm.outdated ? t.dim : t.ansi3;
    return v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(div().flex_none().font_semibold().text_color(cm.resolved ? t.muted : t.foreground).child(cm.author))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${where}${cm.replies > 0 ? ` · ${plural(cm.replies, "reply", "replies")}` : ""}`))
        .when(Boolean(tag), (e) => e.child(div().flex_none().text_color(tagColor).child(tag)))
        .child(div().flex_none().text_color(t.dim).child(ago(cm.at))))
      .child(div().truncate().text_size(12).text_color(cm.resolved ? t.dim : t.muted).child(cm.text));
  }

  row(r, idx, rows, selIdx, t, mono) {
    const on = idx === selIdx;
    const outer = div().w_full().h(r.h).flex_none().px(10);
    const pick = (el) => el.id(`row-${r.key}`)
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        const s = this.selectable(rows).indexOf(idx);
        if (s >= 0) this.sel = s;
        if (e.click_count === 2 && r.url) exec("open", [r.url]);
        cx.notify();
      });
    const ring = (el) => el.border_color(on ? (this.hadKeys ? t.accent : t.input) : t.border);
    switch (r.kind) {
      case "pr": return pick(outer.pt(10).pb(6).child(ring(this.prCard(this.data.pr, t, mono))));
      case "summary": return pick(outer.py(4).child(ring(this.summaryCard(this.data.pr, t))));
      case "section":
        return outer.pt(10).flex().items_center().gap(6)
          .child(div().flex_none().text_size(11).font_semibold().text_color(t.muted).child(r.title.toUpperCase()))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(r.count))
          .child(div().flex_1().h(1).bg(t.border));
      case "empty":
        return outer.flex().items_center().px(14).text_size(12).text_color(t.dim).child(r.text);
      default: {
        const inner = h_flex().size_full().px(8).gap(8).rounded(7).items_center().text_size(12.5)
          .bg(on ? t.selected : t.background).hover((s) => s.bg(on ? t.selected : t.hover))
          .when(on && this.hadKeys, (e) => e.border_l(2).border_color(t.accent));
        if (r.kind === "check") inner.children(this.checkRow(r.item, t).filter(Boolean));
        else if (r.kind === "reviewer") inner.children(this.reviewerRow(r.item, t));
        else inner.py(5).items_start().child(svg(`${ICON}/comment.svg`).mt(2).size(13).flex_none().text_color(r.item.resolved ? t.dim : t.muted)).child(this.commentRow(r.item, t));
        return pick(outer.py(1).child(inner.cursor_pointer()));
      }
    }
  }

  message(t, title, body) {
    return v_flex().flex_1().min_h(0).p(20).gap(6).items_center().justify_center().text_center()
      .child(svg(`${ICON}/pr.svg`).size(28).text_color(t.dim))
      .child(div().pt(4).font_semibold().child(title))
      .when(Boolean(body), (e) => e.child(div().max_w(280).text_size(12).text_color(t.dim).child(body)));
  }

  body(t, mono) {
    const d = this.data, ctx = this.lastCtx;
    if (!ctx) return this.message(t, "No terminal focused", "Focus a terminal in a git repo and its pull request shows here.");
    if (!d || d.key !== this.ctxKey(ctx)) return this.message(t, "Looking for the pull request…", tilde(ctx.cwd));
    if (d.notRepo) return this.message(t, "Not a git repository", tilde(ctx.cwd));
    if (d.detached) return this.message(t, "Detached HEAD", "Check out a branch to see its pull request.");
    if (d.unpushed) return this.message(t, `${d.git.branch} isn't pushed`, "It has no upstream branch yet. Push it (git push -u) and open a pull request.");
    if (d.error && !d.pr) return this.message(t, "Couldn't reach GitHub", d.error.split("\n").slice(0, 3).join(" "));
    if (d.noPr) return this.message(t, "No pull request for this branch", `${d.git.upstream} has no pull request yet.`);
    const rows = this.rows(), sel = this.selectable(rows);
    const selIdx = sel.length ? sel[Math.min(this.sel, sel.length - 1)] : -1;
    this.scrollTo(this.scrollY, rows);
    const max = this.maxScroll(rows), view = this.bodyH ?? 0, content = view + max;
    return div().id("rc-body").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => { this.bodyH = size.height; cx.notify(); })
      .on_scroll_wheel((e, cx) => { const y = this.scrollY; this.scrollTo(y - e.delta.y, rows); if (this.scrollY !== y) { cx.stop_propagation(); cx.notify(); } })
      .child(v_flex().absolute().top(-this.scrollY).left(0).right(0).pb(8)
        .children(rows.map((r, i) => this.row(r, i, rows, selIdx, t, mono))))
      // A thin position thumb while there's more than fits.
      .when(max > 0 && view > 0, (el) => el.child(div().absolute().right(2).w(3).rounded_full().bg(t.border)
        .top(this.scrollY / content * view).h(Math.max(24, view * view / content))));
  }

  render(cx) {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    this.hadKeys = this.handle.is_focused();
    const ctx = this.context();
    const d = this.data && this.data.key === this.ctxKey(ctx) ? this.data : null, git = d?.git;
    const where = d?.repo ?? (git?.remoteUrl ? git.remoteUrl.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "") : null);
    const branch = git?.branch ?? ctx?.branch;
    const stamp = this.fetching ? "fetching…" : d?.at ? `checked ${ago(new Date(d.at).toISOString())}` : "";
    return v_flex().id("remote-checker").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(this.hadKeys ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().pl(14).pr(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(svg(`${ICON}/pr.svg`).size(15).flex_none().text_color(t.accent))
        .child(div().flex_none().font_semibold().child("Remote Checker"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(stamp))
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .when(Boolean(d?.pr), (el) => el.child(this.iconButton("rc-open", `${ICON}/external.svg`, "Open on GitHub (O)", () => exec("open", [d.pr.url]), t)))
        .child(this.iconButton("rc-refresh", "mods/remote-checker/restart.svg", "Refetch (r)", (cx) => this.refresh(cx, true), t, { spin: this.fetching })))
      .when(Boolean(branch), (el) => el.child(h_flex().h(28).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(svg(`${CHROME}/git-branch.svg`).size(12).flex_none().text_color(t.accent))
        .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(branch))
        .when(Boolean(git?.upstream), (e) => e.child(div().flex_none().text_color(t.dim).child("→")))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(where ?? git?.upstream ?? ""))
        .when(Boolean(d?.error && d?.pr), (e) => e.child(div().flex_none().text_color(t.ansi1).tooltip(d.error).child("stale")))))
      .child(this.body(t, mono))
      .child(keybar(t, { id: "remote-checker", chips: FOOTER, flash: this.flashText, width: this.size?.width,
        onKeys: (cx) => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.keysOpen), (el) => el.child(keysCard(t, { id: "remote-checker", title: "Remote Checker: all keys",
        onClose: (cx) => { this.keysOpen = false; cx.notify(); },
        groups: [{ title: "Moving", chips: KEYS.moving }, { title: "Acting", chips: KEYS.acting }] })));
  }
}
