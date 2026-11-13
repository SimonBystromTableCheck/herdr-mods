// Remote Checker: the pull request for the focused terminal's branch (its upstream on GitHub):
// CI checks, reviewers, review threads and comments, diff size, commits. Refetches every 10 s
// while the panel shows, and on `r` / the refresh button.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, settings, run, nextCommand, focused, panes, spaces, setShared, home, appHome, readTextFile, writeTextFile } from "herdr";
import { keybar, keysCard } from "./keybar.js";
import { SelfUpdate } from "./update.js";
import { closePanel, panelOnScreen } from "./panel.js";
import { gh, checkAuth, fetchName, installGh, avatar, setupView, accountMenu } from "./accounts.js";

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

// The list tabs (gh-dash style): one GitHub search each, in the space's base repo.
const SEARCH = `query($q:String!){search(query:$q,type:ISSUE,first:50){issueCount nodes{... on PullRequest{
  number title url state isDraft updatedAt author{login} headRefName additions deletions reviewDecision
  comments{totalCount} repository{nameWithOwner} commits(last:1){nodes{commit{statusCheckRollup{state}}}}
}}}}`;
const TABS = [
  { id: "active", label: "Active", key: "1", tip: "The pull request for the focused terminal's branch" },
  { id: "mine", label: "Mine", key: "2", tip: "Your open pull requests in the base repo" },
  { id: "review", label: "Review", key: "3", tip: "Open pull requests waiting for your review in the base repo" },
  { id: "search", label: "Search", key: "4", tip: "Any pull request in the base repo (GitHub search syntax)" },
];
const LIST_MS = 30_000, REPO_MS = 60_000, AUTH_MS = 60_000, WATCH_MS = 3_000, WATCH_FOR = 10 * 60_000;
// Per space: { tab, base, query, account }; plus the repos picked lately and account names. Personal, on this computer.
const configPath = () => `${appHome()}/remote-checker.json`;

// "owner/repo" from a GitHub remote URL (https or ssh), else null.
function repoOf(url) {
  const m = (url ?? "").trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const CI = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };
function shapeItem(n) {
  return {
    number: n.number, title: n.title, url: n.url, state: n.state, draft: n.isDraft, updated: n.updatedAt,
    author: n.author?.login ?? "ghost", head: n.headRefName, additions: n.additions, deletions: n.deletions,
    decision: n.reviewDecision, comments: n.comments?.totalCount ?? 0, repo: n.repository?.nameWithOwner,
    ci: CI[n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? null,
  };
}

const KEYS = {
  moving: [
    { caps: ["j", "k"], label: "move" }, { caps: ["g", "G"], label: "top / bottom" },
    { caps: ["ctrl-d", "ctrl-u"], label: "half page" }, { caps: ["]", "["], label: "next / prev section" },
  ],
  acting: [
    { caps: ["enter"], label: "open in browser" }, { caps: ["O"], label: "open the pull request" },
    { caps: ["y"], label: "copy link" }, { caps: ["r"], label: "refetch now" }, { caps: ["h"], label: "back to the terminal" }, { caps: ["escape"], label: "back to the terminal" }, { caps: ["q"], label: "close the panel" },
  ],
  tabs: [
    { caps: ["1", "4"], label: "Active / Mine / Review / Search" }, { caps: ["tab"], label: "next tab" },
    { caps: ["b"], label: "base repo for this space" }, { caps: ["a"], label: "GitHub account for this space" }, { caps: ["/"], label: "search the base repo" },
    { caps: ["enter"], label: "open a pull request from a list" }, { caps: ["escape"], label: "back to the list" },
  ],
};
const LIST_FOOTER = [
  { caps: ["enter"], label: "open" }, { caps: ["j", "k"], label: "move" }, { caps: ["1", "4"], label: "tabs" },
  { caps: ["b"], label: "repo" }, { caps: ["/"], label: "search" }, { caps: ["r"], label: "refetch" },
];
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
    this.cfg = { spaces: {}, recent: [] }; this.cfgRaw = null;
    this.ctxRepos = {};    // context key -> { repo: "owner/repo" | null, at, pending }
    this.lists = {};       // list key -> { items, count, error, at }
    this.opened = {};      // space id -> { owner, repo, number, from }: a pull request opened from a list
    this.detail = null;    // { key, pr, repo, error, at } for the opened one
    this.picker = null;    // the base repo picker: { input, sel }
    this.searchInput = null;
    this.auth = null;      // { installed, version, accounts, brew } from checkAuth
    this.names = {};       // login -> display name, for initials
    this.accountMenuOpen = false;
    this.loadCfg(cx);
    this.loadAuth(cx);
    cx.timer.every(AUTH_MS, (cx) => { if (this.visible() && !this.authWatching) this.loadAuth(cx); });

    cx.timer.every(POLL_MS, (cx) => {
      if (!this.visible() || this.needsSetup()) return;
      if (this.tab() === "active") this.refresh(cx);
      else if (this.openedPr()) this.refreshDetail(cx);
      else if (Date.now() - (this.lists[this.listKey()]?.at ?? 0) >= LIST_MS) this.refreshList(cx);
    });
    // Follow the focused terminal: fetch at once when its repo/branch changes or the panel comes into view.
    // The list tabs follow the space (its tab, base repo and query) the same way.
    // (Never from render: notifying while rendering throws.)
    cx.timer.every(400, (cx) => {
      const shown = this.visible(), ctx = this.context(), key = this.ctxKey(ctx), space = this.spaceId();
      if (ctx) this.resolveRepo(ctx, cx);
      if (space !== this.seenSpace) { this.seenSpace = space; this.sel = 0; this.scrollY = 0; this.searchInput = null; this.picker = null; cx.notify(); }
      if (shown && !this.needsSetup()) {
        const tab = this.tab(), opened = this.openedPr();
        if (tab === "active") {
          if (key && ((key !== this.data?.key && key !== this.fetchingKey) || !this.wasShown)) this.refresh(cx);
        } else if (opened) {
          if (this.detailKey(opened) !== this.detail?.key || !this.wasShown) this.refreshDetail(cx);
        } else {
          const lk = this.listKey();
          if (lk && (!this.lists[lk] || !this.wasShown)) this.refreshList(cx);
        }
      }
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
        else if (c === "accounts") this.openAccountMenu(cx);
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

  // ---- Per space: tab, base repo, search query ----------------------------------

  spaceId() { return focused()?.space ?? spaces().find((s) => s.active)?.id ?? null; }
  prefs() { return this.cfg.spaces[this.spaceId()] ?? {}; }
  tab() { return this.prefs().tab ?? "active"; }
  query() { return this.prefs().query ?? "is:open"; }
  // The GitHub repo of the focused terminal's folder (its branch's remote, else origin).
  ctxRepo() { const c = this.context(); return c ? this.ctxRepos[this.ctxKey(c)]?.repo ?? null : null; }
  // The repo the list tabs search: the space's own pick, else the focused terminal's.
  base() { return this.prefs().base ?? this.ctxRepo(); }

  setPrefs(patch, cx) {
    const id = this.spaceId();
    if (!id) return;
    const next = { ...this.prefs(), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    this.cfg.spaces = { ...this.cfg.spaces, [id]: next };
    if (patch.base) this.cfg.recent = [patch.base, ...(this.cfg.recent ?? []).filter((r) => r !== patch.base)].slice(0, 12);
    this.saveCfg(cx);
    cx.notify();
  }

  setTab(tab, cx) {
    if (tab === this.tab()) return;
    this.sel = 0; this.scrollY = 0; this.searchInput = null;
    this.setPrefs({ tab }, cx);
  }

  loadCfg(cx) {
    cx.spawn(async (cx) => {
      const raw = await readTextFile(configPath()).catch(() => null);
      this.cfgRaw = raw;
      try { const j = JSON.parse(raw ?? "{}"); this.cfg = { spaces: j.spaces ?? {}, recent: j.recent ?? [] }; this.names = { ...j.names, ...this.names }; } catch { /* keep defaults */ }
      cx.notify();
    });
  }

  saveCfg(cx) {
    const text = JSON.stringify({ ...this.cfg, names: this.names }, null, 2) + "\n";
    cx.spawn(async () => {
      try { await writeTextFile(configPath(), text, this.cfgRaw); }
      catch { await writeTextFile(configPath(), text, await readTextFile(configPath()).catch(() => null)); }
      this.cfgRaw = text;
    });
  }

  resolveRepo(ctx, cx) {
    const k = this.ctxKey(ctx), c = this.ctxRepos[k];
    if (c && (c.pending || Date.now() - c.at < REPO_MS)) return;
    this.ctxRepos[k] = { ...c, pending: true };
    const script = 'cd "$1" 2>/dev/null || exit 2; b=$(git branch --show-current 2>/dev/null); '
      + 'r=$(git config "branch.$b.remote" 2>/dev/null); [ -n "$r" ] || r=origin; git remote get-url "$r" 2>/dev/null';
    cx.spawn(async (cx) => {
      let repo = null;
      try { repo = repoOf((await exec("sh", ["-c", script, "remote-checker", ctx.cwd], { on: ctx.machine ?? undefined, timeout: 10_000 })).stdout); } catch { /* not reachable */ }
      const had = this.ctxRepos[k]?.repo;
      this.ctxRepos[k] = { repo, at: Date.now() };
      if (repo !== had) cx.notify();
    });
  }

  // ---- GitHub accounts ----------------------------------------------------------

  // This space's pick while gh still has it signed in, else gh's active account.
  account() {
    const accounts = this.auth?.accounts ?? [], picked = this.prefs().account;
    if (picked && accounts.some((a) => a.login === picked && a.ok)) return picked;
    return accounts.find((a) => a.active)?.login ?? null;
  }

  gh(args, opts) { return gh(this.prefs().account ? this.account() : null, args, opts); }

  needsSetup() { return Boolean(this.auth) && (!this.auth.installed || !this.auth.accounts.length); }

  loadAuth(cx, then) {
    cx.spawn(async (cx) => {
      let auth;
      try { auth = await checkAuth(); } catch (e) { auth = { installed: true, accounts: this.auth?.accounts ?? [], error: String(e?.message ?? e) }; }
      const wasSetup = this.needsSetup();
      this.auth = auth;
      if (wasSetup && !this.needsSetup()) this.resetFetched();
      then?.(auth, cx);
      cx.notify();
      for (const a of auth.accounts) if (a.ok && this.names[a.login] === undefined) {
        this.names[a.login] = "";
        fetchName(a.login).then((name) => { if (name) { this.names = { ...this.names, [a.login]: name }; this.saveCfg(cx); cx.notify(); } });
      }
    });
  }

  // While an install or sign-in tab runs: recheck every few seconds until gh changes (or 10 minutes).
  // gh auth login makes the new account gh's active one; that's put back, and the new one is this space's.
  watchAuth(cx, { pickNew = false } = {}) {
    const before = this.auth, known = new Set((before?.accounts ?? []).map((a) => a.login));
    const prevActive = before?.accounts.find((a) => a.active)?.login ?? null;
    const token = this.authWatching = (this.authWatching ?? 0) + 1, until = Date.now() + WATCH_FOR;
    const tick = (cx) => {
      if (this.authWatching !== token) return;
      this.loadAuth(cx, (auth, cx) => {
        if (this.authWatching !== token) return;
        const added = auth.accounts.find((a) => !known.has(a.login));
        const changed = added || auth.installed !== before?.installed || auth.accounts.some((a) => a.ok && !before?.accounts.find((b) => b.login === a.login)?.ok);
        if (added && prevActive && prevActive !== added.login) {
          gh(null, ["auth", "switch", "--hostname", "github.com", "--user", prevActive], { timeout: 15_000 })
            .finally(() => this.loadAuth(cx));
        }
        if (added && pickNew) this.setPrefs({ account: added.login }, cx);
        if (changed || Date.now() > until) { this.authWatching = null; cx.notify(); return; }
        cx.timer.after(WATCH_MS, tick);
      });
    };
    cx.timer.after(WATCH_MS, tick);
    cx.notify();
  }

  installGh(cx) {
    if (this.installing) return;
    this.installing = true; this.installError = null; cx.notify();
    cx.spawn(async (cx) => {
      try { this.installError = await installGh(Boolean(this.auth?.brew)); } catch (e) { this.installError = String(e?.message ?? e); }
      this.installing = false;
      this.loadAuth(cx);
    });
  }

  pickAccount(acc, cx) {
    this.accountMenuOpen = false; this.handle.focus();
    // Picking gh's active account follows it from then on.
    this.setPrefs({ account: acc.active ? null : acc.login }, cx);
    this.resetFetched();
    this.refetch(cx);
  }

  openAccountMenu(cx) { if (this.auth?.accounts.length) { this.accountMenuOpen = true; this.handle.focus(); cx.notify(); } }
  closeAccountMenu(cx) { this.accountMenuOpen = false; this.handle.focus(); cx.notify(); }

  // Another account sees other pull requests: drop what was fetched as the previous one.
  resetFetched() {
    this.data = null; this.detail = null; this.lookups = {}; this.ghRepos = null;
  }

  // ---- The list tabs ------------------------------------------------------------

  listKey() {
    const tab = this.tab(), base = this.base();
    return tab === "active" || !base ? null : `${tab}|${base}|${tab === "search" ? this.query() : ""}|${this.account() ?? ""}`;
  }

  searchQuery(tab, base) {
    const q = tab === "mine" ? "is:open author:@me" : tab === "review" ? "is:open review-requested:@me" : this.query();
    return `repo:${base} is:pr ${q}${/(^|\s)sort:/.test(q) ? "" : " sort:updated-desc"}`;
  }

  refreshList(cx, force = false) {
    const key = this.listKey();
    if (!key || this.listFetching === key) return;
    const [tab, base] = key.split("|");
    this.listFetching = key; cx.notify();
    cx.spawn(async (cx) => {
      let res;
      try {
        const r = await this.gh(["api", "graphql", "-f", `query=${SEARCH}`, "-f", `q=${this.searchQuery(tab, base)}`], { timeout: 20_000 });
        const j = r.code === 0 ? JSON.parse(r.stdout) : null;
        if (!j) res = { error: (r.stderr || r.stdout).trim() || "gh api failed" };
        else if (j.errors?.length) res = { error: j.errors[0].message };
        else res = { count: j.data.search.issueCount, items: j.data.search.nodes.filter((n) => n?.number).map(shapeItem) };
      } catch (e) { res = { error: String(e?.message ?? e) }; }
      this.listFetching = null;
      const prev = this.lists[key];
      if (res.error && prev?.items) res = { ...prev, error: res.error };
      this.lists = { ...this.lists, [key]: { ...res, at: Date.now() } };
      cx.notify();
    });
  }

  // ---- A pull request opened from a list ------------------------------------------

  openedPr() { return this.tab() === "active" ? null : this.opened[this.spaceId()] ?? null; }
  detailKey(o) { return o ? `${o.owner}/${o.repo}#${o.number}` : null; }

  openFromList(item, cx) {
    const [owner, repo] = (item.repo ?? this.base() ?? "").split("/");
    if (!owner || !repo) return;
    this.listSel = this.sel; this.listScroll = this.scrollY;
    this.opened = { ...this.opened, [this.spaceId()]: { owner, repo, number: item.number, from: this.tab() } };
    this.sel = 0; this.scrollY = 0;
    this.refreshDetail(cx);
    cx.notify();
  }

  backToList(cx) {
    const { [this.spaceId()]: _gone, ...rest } = this.opened;
    this.opened = rest;
    this.sel = this.listSel ?? 0; this.scrollY = this.listScroll ?? 0;
    cx.notify();
  }

  refreshDetail(cx) {
    const o = this.openedPr(), key = this.detailKey(o);
    if (!o || this.detailFetching === key) return;
    this.detailFetching = key; cx.notify();
    cx.spawn(async (cx) => {
      let res;
      try { res = await this.fetchPr(o.owner, o.repo, o.number); }
      catch (e) { res = { error: String(e?.message ?? e) }; }
      this.detailFetching = null;
      if (res.error && this.detail?.key === key && this.detail.pr) res = { ...this.detail, error: res.error };
      this.detail = { ...res, git: null, key, at: Date.now() };
      cx.notify();
    });
  }

  // The data the detail rows draw: the focused branch's pull request (Active), or the one opened from a list.
  view() {
    if (this.tab() === "active") { const d = this.data; return d && d.key === this.ctxKey(this.context()) ? d : null; }
    const o = this.openedPr();
    return o && this.detail?.key === this.detailKey(o) ? this.detail : null;
  }

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
      const v = await this.gh(["pr", "view", "--json", "number,url"], { cwd: ctx.cwd, on, timeout: 20_000 });
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

    return { git, ...(await this.fetchPr(found.owner, found.repo, found.number, { cwd: ctx.cwd, on })) };
  }

  // One pull request's details: { pr, repo } or { error }.
  async fetchPr(owner, repo, number, { cwd, on } = {}) {
    const q = await this.gh(["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `n=${number}`],
      { cwd, on, timeout: 20_000 });
    if (q.code !== 0) return { error: (q.stderr || q.stdout).trim() || "gh api failed" };
    const json = JSON.parse(q.stdout);
    const pr = json.data?.repository?.pullRequest;
    if (!pr) return { error: json.errors?.[0]?.message ?? "Pull request not found" };
    return { pr: shape(pr), repo: `${owner}/${repo}` };
  }

  // ---- Rows -------------------------------------------------------------------

  // Every row of the list with its exact height; `url` makes it selectable.
  // A list tab with no pull request opened from it.
  listMode() { return this.tab() !== "active" && !this.openedPr(); }
  wide() { return (this.size?.width ?? 0) >= 560; }

  rows() {
    if (this.listMode()) {
      const h = this.wide() ? 34 : 54;
      return (this.lists[this.listKey()]?.items ?? []).map((it) => ({ key: `it-${it.repo}-${it.number}`, h, kind: "item", item: it, url: it.url }));
    }
    const d = this.view(), out = [];
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
    if (this.accountMenuOpen) {
      if (e.key === "escape") { cx.stop_propagation(); this.closeAccountMenu(cx); }
      return;
    }
    // While a text field has the keyboard, only these reach the panel; the rest types.
    if (this.picker) {
      const k = m.control && ["n", "p"].includes(e.key) ? (e.key === "n" ? "down" : "up") : e.key;
      if (["escape", "up", "down", "enter"].includes(k)) { cx.stop_propagation(); this.pickerKey(k, cx); }
      return;
    }
    if (this.searchInput) {
      if (e.key === "escape") { cx.stop_propagation(); this.stopSearch(cx); }
      return;
    }
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
    if (this.accountMenuOpen) { if (k === "escape") this.closeAccountMenu(cx); return true; }
    if (this.picker) { if (["escape", "up", "down", "enter"].includes(k)) this.pickerKey(k, cx); return true; }
    if (this.searchInput) { if (k === "escape") this.stopSearch(cx); return true; }
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
    const tabKey = TABS.find((x) => x.key === k);
    if (tabKey) { this.setTab(tabKey.id, cx); return true; }
    if (k === "tab") { const i = TABS.findIndex((x) => x.id === this.tab()); this.setTab(TABS[(i + 1) % TABS.length].id, cx); return true; }
    if (k === "b") { this.openPicker(cx); return true; }
    if (k === "a") { this.openAccountMenu(cx); return true; }
    if (k === "/") { this.setTab("search", cx); this.editSearch(cx); return true; }
    if (this.openedPr() && (k === "escape" || k === "backspace")) { this.backToList(cx); return true; }
    if (this.listMode() && (k === "enter" || k === "o" || k === "l")) { const r = this.selectedRow(rows); if (r?.item) this.openFromList(r.item, cx); return true; }
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
      case "O": { const pr = this.view()?.pr; if (pr) exec("open", [pr.url]); return true; }
      case "y": {
        const r = this.selectedRow(rows), url = r?.url ?? this.view()?.pr?.url;
        if (url) { exec("sh", ["-c", 'printf %s "$1" | pbcopy', "copy", url]); this.flash("Copied " + url.replace(/^https:\/\/github\.com\//, ""), cx); }
        return true;
      }
      case "r": this.refetch(cx); return true;
      // Escape gives the keyboard back to the terminal; q also closes the panel.
      case "escape": this.leave(); if (focused()?.pane) run("pane.focus", { pane: focused().pane }); return true;
      case "q":
        this.leave();
        closePanel("remote-checker");
        return true;
    }
    return false;
  }

  refetch(cx) {
    if (this.tab() === "active") this.refresh(cx, true);
    else if (this.openedPr()) this.refreshDetail(cx);
    else this.refreshList(cx, true);
  }

  // ---- The base repo picker and the search field ------------------------------------

  openPicker(cx) {
    const input = InputState.new({ value: "", placeholder: "Filter, or type owner/repo" });
    input.on("change", (_e, cx) => { if (this.picker) this.picker.sel = 0; cx.notify(); });
    input.on("submit", (_e, cx) => this.pickerKey("enter", cx));
    this.picker = { input, sel: 0 };
    input.focus();
    // Suggestions: every space's repo, and the person's recently pushed repos on GitHub (once).
    for (const sp of spaces()) { const c = this.spaceCtx(sp); if (c) this.resolveRepo(c, cx); }
    if (!this.ghRepos) {
      this.ghRepos = [];
      cx.spawn(async (cx) => {
        try {
          const r = await this.gh(["api", "user/repos?sort=pushed&per_page=40", "--jq", ".[].full_name"], { timeout: 20_000 });
          if (r.code === 0) this.ghRepos = r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
        } catch { /* offline: the other suggestions still show */ }
        cx.notify();
      });
    }
    cx.notify();
  }

  // The focused terminal's repo first (picking it follows the terminal again), then repos picked
  // before and seen in terminals; typed "owner/repo" on top when it's new.
  pickerItems() {
    const ctx = this.ctxRepo(), typed = this.picker.input.value().trim(), f = typed.toLowerCase(), out = [], seen = new Set();
    const add = (repo, note, follow = false) => { const k = `${repo}|${follow}`; if (!repo || seen.has(k)) return; seen.add(k); out.push({ repo, note, follow }); };
    if (ctx) add(ctx, "the focused terminal's repo · follows it", true);
    if (this.prefs().base) add(this.prefs().base, "this space's repo now");
    for (const r of this.cfg.recent ?? []) add(r, "picked before");
    for (const sp of spaces()) {
      const c = this.spaceCtx(sp), repo = c ? this.ctxRepos[this.ctxKey(c)]?.repo : null;
      if (repo) add(repo, `space: ${sp.name}`);
    }
    for (const c of Object.values(this.ctxRepos)) if (c.repo) add(c.repo, "seen in a terminal");
    for (const r of this.ghRepos ?? []) add(r, "on GitHub");
    const list = out.filter((x) => !f || x.repo.toLowerCase().includes(f));
    if (/^[\w.-]+\/[\w.-]+$/.test(typed) && !list.some((x) => x.repo.toLowerCase() === f)) list.unshift({ repo: typed, note: "use this repo" });
    return list;
  }

  // Where a space is now: its first terminal's live folder (as Herdr's own sidebar takes it), else its folder.
  spaceCtx(sp) {
    const tabs = new Set((sp.tabs ?? []).map((t) => t.id));
    const pane = panes().find((p) => p.terminal && tabs.has(p.tab) && p.cwd);
    const cwd = pane?.cwd ?? sp.folder;
    return cwd ? { cwd, branch: pane ? pane.branch ?? null : sp.branch ?? null, machine: sp.machine ?? null } : null;
  }

  pickerKey(k, cx) {
    const items = this.pickerItems();
    if (k === "escape") { this.picker = null; this.handle.focus(); }
    else if (k === "down") this.picker.sel = Math.min(Math.max(0, items.length - 1), this.picker.sel + 1);
    else if (k === "up") this.picker.sel = Math.max(0, this.picker.sel - 1);
    else if (k === "enter" && items[this.picker.sel]) this.pickBase(items[this.picker.sel], cx);
    cx.notify();
  }

  pickBase(it, cx) {
    this.picker = null; this.handle.focus();
    const { [this.spaceId()]: _gone, ...rest } = this.opened;
    this.opened = rest; this.sel = 0; this.scrollY = 0;
    this.setPrefs({ base: it.follow ? null : it.repo, ...(this.tab() === "active" ? { tab: "mine" } : {}) }, cx);
  }

  editSearch(cx) {
    const input = InputState.new({ value: this.query(), placeholder: "is:open author:someone label:bug …" });
    input.on("submit", (_e, cx) => {
      const q = input.value().trim() || "is:open";
      this.searchInput = null; this.handle.focus(); this.sel = 0; this.scrollY = 0;
      this.setPrefs({ query: q }, cx);
    });
    this.searchInput = { input };
    input.focus();
    cx.notify();
  }

  stopSearch(cx) { this.searchInput = null; this.handle.focus(); cx.notify(); }

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
    const st = this.stateLook(pr, t), git = this.view()?.git;
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
      case "pr": return pick(outer.pt(10).pb(6).child(ring(this.prCard(this.view().pr, t, mono))));
      case "summary": return pick(outer.py(4).child(ring(this.summaryCard(this.view().pr, t))));
      case "item": {
        // A list row opens the pull request here (double-click: on GitHub).
        const el = outer.py(1).id(`row-${r.key}`)
          .on_mouse_down("left", (e, cx) => {
            this.handle.focus();
            const s = this.selectable(rows).indexOf(idx);
            if (s >= 0) this.sel = s;
            if (e.click_count === 2) this.openFromList(r.item, cx);
            cx.notify();
          });
        return el.child(this.listItem(r.item, on, t, mono));
      }
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

  // gh-dash style: one line of columns when the panel is wide, two lines when it's narrow.
  listItem(it, on, t, mono) {
    const c = this.colors(t);
    const stateColor = it.state === "MERGED" ? t.ansi5 : it.state === "CLOSED" ? t.ansi1 : it.draft ? t.dim : t.ansi2;
    const ci = it.ci === "pass" ? svg(`${ICON}/check.svg`).size(12).text_color(c.pass)
      : it.ci === "fail" ? svg(`${ICON}/x.svg`).size(12).text_color(c.fail)
      : it.ci === "pending" ? svg(`${ICON}/ring.svg`).size(12).text_color(c.pending).spin(1400)
      : svg(`${ICON}/minus.svg`).size(12).text_color(t.dim);
    const REVIEW = { APPROVED: ["approved", t.ansi2], CHANGES_REQUESTED: ["changes", t.ansi1], REVIEW_REQUIRED: ["review", t.ansi3] };
    const [review, reviewColor] = REVIEW[it.decision] ?? [it.draft ? "draft" : "", t.dim];
    const box = h_flex().size_full().px(8).gap(8).rounded(7).items_center().cursor_pointer().text_size(12.5)
      .bg(on ? t.selected : t.background).hover((s) => s.bg(on ? t.selected : t.hover))
      .when(on && this.hadKeys, (e) => e.border_l(2).border_color(t.accent));
    const icon = svg(`${ICON}/pr.svg`).size(13).flex_none().text_color(stateColor);
    const number = div().flex_none().font_family(mono).text_size(11.5).text_color(t.dim).child(`#${it.number}`);
    const size = h_flex().flex_none().gap(4).font_family(mono).text_size(11)
      .child(div().text_color(c.pass).child(`+${num(it.additions)}`)).child(div().text_color(c.fail).child(`−${num(it.deletions)}`));
    if (this.wide()) {
      return box
        .child(icon).child(number.w(54))
        .child(div().flex_1().min_w(0).truncate().child(it.title))
        .child(div().w(96).flex_none().truncate().text_size(11.5).text_color(t.muted).child(it.author))
        .child(div().w(16).flex_none().child(ci))
        .child(div().w(62).flex_none().text_size(11).text_color(reviewColor).child(review))
        .child(size.w(92))
        .child(div().w(62).flex_none().text_right().text_size(11).text_color(t.dim).child(ago(it.updated)));
    }
    return box.py(6).items_start()
      .child(icon.mt(2))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(number).child(div().flex_1().min_w(0).truncate().child(it.title))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(it.updated))))
        .child(h_flex().gap(8).items_center().min_w(0).text_size(11).text_color(t.muted)
          .child(div().min_w(0).max_w(120).truncate().child(`@${it.author}`))
          .child(ci)
          .when(Boolean(review), (e) => e.child(div().flex_none().text_color(reviewColor).child(review)))
          .child(size)
          .when(it.comments > 0, (e) => e.child(div().flex_none().text_color(t.dim).child(plural(it.comments, "comment"))))));
  }

  message(t, title, body) {
    return v_flex().flex_1().min_h(0).p(20).gap(6).items_center().justify_center().text_center()
      .child(svg(`${ICON}/pr.svg`).size(28).text_color(t.dim))
      .child(div().pt(4).font_semibold().child(title))
      .when(Boolean(body), (e) => e.child(div().max_w(280).text_size(12).text_color(t.dim).child(body)));
  }

  body(t, mono) {
    if (!this.auth) return this.message(t, "Checking the GitHub CLI…", null);
    if (this.needsSetup()) return setupView(this, t);
    const tab = this.tab();
    if (tab !== "active") {
      const base = this.base(), o = this.openedPr();
      if (o) {
        const d = this.view();
        if (!d) return this.message(t, "Loading the pull request…", this.detailKey(o));
        if (d.error && !d.pr) return this.message(t, "Couldn't reach GitHub", d.error.split("\n").slice(0, 3).join(" "));
        return this.rowsView(t, mono);
      }
      if (!base) return this.message(t, "No repo for this space", "Focus a terminal in a GitHub repo, or press b to pick one for this space.");
      const l = this.lists[this.listKey()];
      if (!l) return this.message(t, "Loading pull requests…", base);
      if (l.error && !l.items) return this.message(t, "Couldn't reach GitHub", l.error.split("\n").slice(0, 3).join(" "));
      if (!l.items.length) return this.message(t,
        { mine: "No open pull requests of yours", review: "Nothing is waiting for your review", search: "No pull requests match" }[tab], base);
      return this.rowsView(t, mono);
    }
    const d = this.data, ctx = this.lastCtx;
    if (!ctx) return this.message(t, "No terminal focused", "Focus a terminal in a git repo and its pull request shows here.");
    if (!d || d.key !== this.ctxKey(ctx)) return this.message(t, "Looking for the pull request…", tilde(ctx.cwd));
    if (d.notRepo) return this.message(t, "Not a git repository", tilde(ctx.cwd));
    if (d.detached) return this.message(t, "Detached HEAD", "Check out a branch to see its pull request.");
    if (d.unpushed) return this.message(t, `${d.git.branch} isn't pushed`, "It has no upstream branch yet. Push it (git push -u) and open a pull request.");
    if (d.error && !d.pr) return this.message(t, "Couldn't reach GitHub", d.error.split("\n").slice(0, 3).join(" "));
    if (d.noPr) return this.message(t, "No pull request for this branch", `${d.git.upstream} has no pull request yet. Mine (2) lists your others.`);
    return this.rowsView(t, mono);
  }

  rowsView(t, mono) {
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
    const ctx = this.context(), tab = this.tab(), active = tab === "active", opened = this.openedPr();
    const d = active ? (this.data && this.data.key === this.ctxKey(ctx) ? this.data : null) : null, git = d?.git;
    const where = d?.repo ?? (git?.remoteUrl ? git.remoteUrl.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "") : null);
    const branch = active ? git?.branch ?? ctx?.branch : null;
    const list = !active && !opened ? this.lists[this.listKey()] : null;
    const busy = active ? this.fetching : opened ? Boolean(this.detailFetching) : this.listFetching === this.listKey() && Boolean(this.listKey());
    const at = active ? d?.at : opened ? this.view()?.at : list?.at;
    const stamp = busy ? "fetching…" : at ? `checked ${ago(new Date(at).toISOString())}` : "";
    const pr = this.view()?.pr, account = this.needsSetup() ? null : this.account();
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
        .when(Boolean(pr), (el) => el.child(this.iconButton("rc-open", `${ICON}/external.svg`, "Open on GitHub (O)", () => exec("open", [pr.url]), t)))
        .child(this.iconButton("rc-refresh", "mods/remote-checker/restart.svg", "Refetch (r)", (cx) => this.refetch(cx), t, { spin: busy }))
        .when(Boolean(account), (el) => el.child(div().id("rc-account").ml(2).p(2).flex_none().rounded_full().cursor_pointer()
          .bg(this.accountMenuOpen ? t.selected : t.background).hover((s) => s.bg(t.hover))
          .tooltip(`GitHub: ${account}${this.prefs().account ? " (this space)" : " (gh's active account)"}`)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => (this.accountMenuOpen ? this.closeAccountMenu(cx) : this.openAccountMenu(cx)))
          .child(avatar(account, this.names[account], t)))))
      .child(this.tabsBar(t))
      .when(tab === "search" && !opened, (el) => el.child(this.searchBar(t, mono, list)))
      .when(Boolean(opened), (el) => el.child(this.backBar(t, opened)))
      .when(Boolean(branch), (el) => el.child(h_flex().h(28).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(svg(`${CHROME}/git-branch.svg`).size(12).flex_none().text_color(t.accent))
        .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(branch))
        .when(Boolean(git?.upstream), (e) => e.child(div().flex_none().text_color(t.dim).child("→")))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(where ?? git?.upstream ?? ""))
        .when(Boolean(d?.error && d?.pr), (e) => e.child(div().flex_none().text_color(t.ansi1).tooltip(d.error).child("stale")))))
      .child(this.body(t, mono))
      .when(Boolean(this.picker), (el) => el.child(this.pickerView(t, mono)))
      .when(this.accountMenuOpen && Boolean(this.auth), (el) => el.child(accountMenu(this, t, spaces().find((x) => x.id === this.spaceId()))))
      .child(keybar(t, { id: "remote-checker", chips: this.listMode() ? LIST_FOOTER : FOOTER, flash: this.flashText, width: this.size?.width,
        onKeys: (cx) => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.keysOpen), (el) => el.child(keysCard(t, { id: "remote-checker", title: "Remote Checker: all keys",
        onClose: (cx) => { this.keysOpen = false; cx.notify(); },
        groups: [{ title: "Tabs and repo", chips: KEYS.tabs }, { title: "Moving", chips: KEYS.moving }, { title: "Acting", chips: KEYS.acting }] })));
  }

  // Active / Mine / Review / Search, and the space's base repo on the right.
  tabsBar(t) {
    const tab = this.tab(), base = this.base(), own = Boolean(this.prefs().base);
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().h(34).flex_none().pl(8).pr(8).gap(2).items_center().border_b(1).border_color(t.border)
      .children(TABS.map((x) => {
        const on = x.id === tab, n = x.id === "mine" || x.id === "review" ? this.lists[`${x.id}|${base}||${this.account() ?? ""}`]?.items?.length : null;
        return h_flex().id(`rc-tab-${x.id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
          .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(`${x.tip} (${x.key})`).on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.handle.focus(); this.setTab(x.id, cx); })
          .child(x.label)
          .when(n > 0, (el) => el.child(div().text_size(10.5).text_color(on ? t.muted : t.dim).child(String(n))));
      }))
      .child(div().flex_1().min_w(4))
      .child(h_flex().id("rc-base").min_w(0).h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(11.5)
        .text_color(base ? t.muted : t.ansi3).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`${base ? `${base}: ` : ""}${own ? "this space's repo for Mine, Review and Search (b to change)" : "Mine, Review and Search use the focused terminal's repo (b to pick one for this space)"}`)
        .on_mouse_down("left", stop).on_click((_e, cx) => this.openPicker(cx))
        .when(own, (el) => el.child(div().size(5).flex_none().rounded_full().bg(t.accent)))
        .child(div().min_w(0).truncate().child(base ? (this.wide() ? base : base.split("/")[1]) : "Pick a repo"))
        .child(svg(`${CHROME}/chevron-down.svg`).size(11).flex_none()));
  }

  searchBar(t, mono, list) {
    const editing = Boolean(this.searchInput);
    return h_flex().h(36).flex_none().px(10).gap(7).items_center().border_b(1).border_color(t.border)
      .child(svg(`${CHROME}/search.svg`).size(13).flex_none().text_color(editing ? t.accent : t.dim))
      .child(editing
        ? Input.new(this.searchInput.input).flex_1().h(26).px(7).rounded(6).border_1().border_color(t.accent).bg(t.background)
          .font_family(mono).text_size(11.5).text_color(t.foreground)
        : div().id("rc-query").flex_1().min_w(0).truncate().cursor_pointer().font_family(mono).text_size(11.5).text_color(t.foreground)
          .tooltip("GitHub search, in the base repo (/ to edit)")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.editSearch(cx)).child(this.query()))
      .when(!editing && list?.count != null, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim)
        .child(list.count > (list.items?.length ?? 0) ? `${list.items.length} of ${num(list.count)}` : plural(list.count, "result"))));
  }

  backBar(t, o) {
    const from = TABS.find((x) => x.id === o.from)?.label ?? "list";
    return h_flex().id("rc-back").h(30).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border).cursor_pointer()
      .text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to the list (escape)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.backToList(cx))
      .child(svg(`${CHROME}/chevron-left.svg`).size(12).flex_none())
      .child(div().flex_none().child(from))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${o.owner}/${o.repo} #${o.number}`));
  }

  pickerView(t, mono) {
    const items = this.pickerItems(), sel = Math.min(this.picker.sel, Math.max(0, items.length - 1));
    const space = spaces().find((x) => x.id === this.spaceId());
    return div().absolute().top(0).left(0).right(0).bottom(0).bg(t.background).opacity(0.98)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().m(10).p(12).gap(8).rounded(9).bg(t.popover).border_1().border_color(t.border).shadow_md()
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().font_semibold().text_size(12.5).child(`Repo for ${space?.name ?? "this space"}`))
          .child(div().text_size(11).text_color(t.dim).child("esc")))
        .child(div().text_size(11.5).text_color(t.dim).child("Mine, Review and Search look here. Active still follows the focused terminal."))
        .child(Input.new(this.picker.input).h(30).px(9).rounded(7).border_1().border_color(t.accent).bg(t.background)
          .font_family(mono).text_size(12).text_color(t.foreground))
        .child(v_flex().gap(1)
          .when(!items.length, (el) => el.child(div().py(6).text_size(12).text_color(t.dim).child("Type owner/repo")))
          .children(items.slice(0, 12).map((it, i) => h_flex().id(`rc-pick-${i}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer()
            .bg(i === sel ? t.selected : t.popover).hover((s) => s.bg(i === sel ? t.selected : t.hover))
            .on_click((_e, cx) => this.pickBase(it, cx))
            .child(div().flex_none().font_family(mono).text_size(12).child(it.repo))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(it.note))))));
  }
}
