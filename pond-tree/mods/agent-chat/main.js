import { View, div, image } from "gpui-kit";
import { set_theme, v_flex, h_flex, Popup } from "gpui-base";
import { panes, focused, props, hc, theme, shared, setShared, spaces, appHome, readTextFile, window as appWindow, nextCommand } from "herdr";
import { switchTo, showView, shownView, adoptView, preferredView, sessionOf, chatKey, chatOn } from "./common.js";
import { target, inputBox, interruptAgent, sendMessage, pressKeys, readScreen } from "./terminal-fix3.js";
import { keyRows, splitCode, withCopyRows, stepRows, stepHasBody, withoutRetracted } from "./model/transcript.js";
import { replyFromScreen } from "./model/screen-reply.js";
import { runsWith, switchCommand, tokens, sameModel } from "./model/runs-with.js";
import { row, duration, TOOL_BUTTON, TOOL_GAP, NOTES_BUTTON, NOTES_SENT, NOTES_GAP } from "./ui/rows.js";
import { COLUMN, programIcon, paneButtons, statusBadge, viewToggle, clock, icon } from "./ui/primitives.js";
import { diagramFor, renderQueuedDiagrams, hasQueuedDiagrams } from "./diagrams.js";
import { splitDiagrams, copyDiagramImage } from "./diagram-copy.js";
import { canMirror } from "./harnesses/index.js";
import { sendToVault, offerNotes } from "./notes.js";
import { modelList, fetchModels } from "./models.js";
import { isHeader, terminalHeader } from "./header.js";
import { designPx, zoomProbe } from "./measure.js";
import { ChatList } from "./components/chat-list.js";
import { QuestionCard } from "./components/question-card.js";
import { Composer } from "./components/composer.js";
import { GitActions } from "./components/git-actions.js";
import { SessionReader } from "./components/session-reader.js";
import { isDiagramViewer, openDiagram, DiagramViewer } from "./components/diagram-viewer.js";
import { BackdropView } from "./backdrop/view.js";
import { sceneFor, nextScene } from "./backdrop/scenes/index.js";
import { noticeTerminals } from "./opened.js";
import { contextText, healthFill } from "./context-bar.js";
import { withCatalog, refreshCatalog, profileOf, prettyModel, labelsOf, loadActiveProfile } from "./pantheon.js";
import { duck, duckMood } from "./duck.js";

function inputHighlight(cx) {
  const t = theme(), th = cx.theme();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(t.accent), b = rgb(t.surface), k = th.is_dark ? 0.32 : 0.28;
  const want = "#" + a.map((v, i) => Math.round(v * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
  const see = `${t.accent.slice(0, 7)}${th.is_dark ? "47" : "40"}`;
  if (th.colors.accent.slice(0, 7).toLowerCase() === want && th.colors.selection.slice(0, 7).toLowerCase() === see.slice(0, 7).toLowerCase()) return;
  set_theme({ appearance: th.appearance, tokens: { colors: { ...th.colors, accent: want, selection: see }, spacing: th.spacing, radius: th.radius } });
}

const BACKDROP_SCENE = "herdr-chat.backdrop", BACKDROP_DIM = 0.3, BACKDROP_CHAT_DIM = 0.07;
// A model as people read it: no provider prefix, no gateway context suffix.
const cleanModelName = (s) => String(s ?? "").replace(/^anthropic\//i, "").replace(/\[[^\]]*\]$/, "").trim();
const STIR_MS = 5000;

/** A model's name as the chat compares them: lowercase, without a parenthesized window or a "Claude" prefix. */
const modelKey = (s) => String(s ?? "").toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/…$/, "").replace(/^claude\s+/, "").replace(/\s+/g, " ").trim();

const SPARK = ["·", "✢", "✶", "✻", "✽", "✻", "✶", "✢"];

export default class HerdrChat extends View {
  init(_props, cx) {
    try { this.initInner(cx); }
    catch (e) { this.initError = String(e?.stack ?? e); }
  }

  initInner(cx) {
    if (isHeader(props())) { this.asHeader = true; this.hovered = false; return; }
    if (isDiagramViewer(props())) { this.diagram = new DiagramViewer(cx); return; }
    this.list = new ChatList();
    this.reader = new SessionReader(this);
    this.card = new QuestionCard(this);
    this.composer = new Composer(this, cx);
    // agent-chat.focus (the leader's way back from a right-hand panel): the reply box takes the keyboard. The panel
    // being left focuses the tab's (hidden) terminal at about the same moment, so try again until the box has it.
    cx.spawn(async cx => {
      for (;;) {
        if (await nextCommand() !== "focus") continue;
        // The panel's own pane.focus and the leader popup closing both land a few frames later, in no fixed order:
        // keep taking it back for a moment instead of racing them once.
        const take = () => { if (!this.composer.focused) this.composer.input.focus(); };
        take();
        for (const ms of [80, 160, 280, 450, 700, 950]) cx.timer.after(ms, take);
        cx.notify();
      }
    });
    this.git = new GitActions(this);
    this.width = 900; this.zoom = 1; this.rootPx = 0;
    if (props()?.backdrop) this.backdrop = cx.new(BackdropView, { dim: BACKDROP_DIM, sceneKey: BACKDROP_SCENE });
    this.stirAt = 0;
    this.visit = shared("herdr-chat.visit");
    this.refresh(cx);
    cx.spawn(async (cx) => { if (await loadActiveProfile()) cx.notify(); });
    cx.timer.every(1500, cx => inputHighlight(cx));
    cx.timer.every(100, cx => {
      noticeTerminals();
      this.applyView();
      this.noticeStack();
      this.composer.mirrorOnSwitch(cx);
      this.noticeActivity();
      const t = target();
      if (t && chatKey(t) === this.key) this.composer.takeInbox(t, cx);
      this.composer.noticeHint(t, cx);
      this.git.tick(t, cx);
      // Fall back to the moment this view saw the shown agent start working.
      const k = t ? chatKey(t) : "";
      if (t?.status === "working") {
        if (this.workingKey !== k) { this.workingKey = k; this.workingAt = Date.now(); }
      } else if (this.workingKey) { this.workingKey = ""; this.workingAt = 0; }
      // The status line's clock: redraw when the working turn's whole seconds change.
      const since = t?.status === "working" ? this.workingSince(t) : 0;
      const tick = since > 0 ? Math.floor((Date.now() - since) / 1000) : null;
      if (tick !== this.statusTick) { this.statusTick = tick; cx.notify(); }
      if (t?.app && /claude/i.test(t.app)) refreshCatalog(profileOf(t.address));
      if (chatKey(t) !== this.key || this.reader.needsFirstRead || this.composer.pendingDraft) this.refresh(cx);
      this.reader.noticeAgents(cx);
      this.composer.previewsFor(t, this.reader.session.messages, cx);
      this.composer.menu.warm(t, this.reader.session.path, cx);
      if (t) this.card.showPreview(cx, t);
      this.noticeVisit();
      const cue = this.reader.readCue();
      if (cue !== this.shownCue) { this.shownCue = cue; cx.notify(); }
      if (shared("herdr-chat.mode") !== "chat") return;
      this.markSeen(t);
      if (hasQueuedDiagrams() && !this.drawingDiagram) {
        this.drawingDiagram = true;
        cx.spawn(async cx => { try { if (await renderQueuedDiagrams()) cx.notify(); } finally { this.drawingDiagram = false; } });
      }
      this.list.tick(cx);
    });
  }

  /** When the shown turn started, in ms: its prompt's log time, else the tab's working_since, else when this view saw it start. */
  workingSince(t) {
    if (!t) return 0;
    const raw = this.reader?.session?.raw ?? [];
    for (let i = raw.length - 1; i >= 0; i--) {
      if (raw[i].kind === "tick" && raw[i].p) return raw[i].at * 1000;
    }
    const tab = spaces().flatMap(s => s.tabs ?? []).find(x => x.id === t.tab);
    if (tab?.working_since > 0) return tab.working_since;
    if (t.statusMs > 0) return t.statusMs;
    return this.workingKey === chatKey(t) ? this.workingAt : 0;
  }

  /** The last turn's length in seconds (the terminal's "Worked for"), or null before the first one. */
  lastTurnSecs() {
    const ms = this.reader?.session?.messages ?? [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.kind === "stats" && Number.isFinite(m.secs)) return m.secs;
    }
    return null;
  }

  /**
   * Looking at a finished agent in Chat counts as seeing it, as showing its terminal does: herdr calls an agent done
   * while its terminal's herdr.seen label is below its turn, and only the terminal's pane being shown raises it.
   */
  markSeen(t) {
    if (!t || t.status !== "done" || !Number.isFinite(t.turn) || appWindow()?.active === false) return;
    const mark = `${t.address}:${t.turn}`;
    if (this.seenMark === mark) return;
    this.seenMark = mark;
    const retry = () => { if (this.seenMark === mark) this.seenMark = null; };
    hc(["label", t.address, `herdr.seen=${t.turn}`]).then(r => { if (r?.code !== 0) retry(); }, retry);
  }

  get key() { return this.reader?.key ?? ""; }
  get sessionPath() { return this.reader?.session.path ?? ""; }
  get note() { return this.reader?.session.note ?? ""; }
  set note(text) { if (this.reader) this.reader.session.note = text; }

  /** Switches to the selected agent's session and reads it, and its screen for a question. */
  refresh(cx) {
    const t = target();
    const key = chatKey(t);
    if (key !== this.key) { this.switchSession(t, key); cx.notify(); }
    if (this.composer.pendingDraft) { this.composer.swapDraft(this.key, this.composer.pendingDraft.from); this.composer.pendingDraft = null; cx.notify(); }
    const switched = this.reader.needsFirstRead;
    this.reader.needsFirstRead = false;
    if (!t) return;
    if (switched) { this.reader.read(cx); this.card.read(cx, t); }
  }

  /** Shows another session: its draft swapped in once read, the reader on it, the list and card reset. */
  switchSession(t, key) {
    if (!this.composer.pendingDraft) this.composer.pendingDraft = { from: this.key };
    this.reader.switchTo(t, key);
    this.list.reset();
    this.card.clear();
  }

  applyView() {
    const f = focused(), t = target();
    const focus = `${f?.space ?? ""}:${f?.tab ?? ""}:${t ? sessionOf(t) : "-"}`;
    if (focus === this.viewFocus) return;
    this.viewFocus = focus;
    showView(t ? preferredView(sessionOf(t)) : "terminal");
  }

  /**
   * The stack switched by something other than the chat (Alt+Left/Right, the sidebar's terminals): adopt it as the
   * mode. Only on a change, and only when it differs from the mode, so the chat's own switches (which set the mode
   * first) pass.
   */
  noticeStack() {
    const shown = shownView(), was = this.lastStack;
    if (shown === was) return;
    this.lastStack = shown;
    if (was === undefined || !shown) return;
    if (shown === "chat" && !chatOn()) return showView("terminal");
    if (shown === shared("herdr-chat.mode")) return;
    const t = target();
    adoptView(shown, t ? sessionOf(t) : "");
  }

  /** On a switch to Chat: back to the newest message, hidden until it lands if anything changed. */
  noticeVisit() {
    const visit = shared("herdr-chat.visit");
    if (visit === this.visit) return;
    this.visit = visit;
    this.list.revisit();
  }

  /** Stops the working agent (its own stop key, through hc interrupt). */
  stop(cx) {
    const t = target();
    if (!t || t.status !== "working" || this.stopping) return;
    this.stopping = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await interruptAgent(t);
        if (r.outcome === "failed") throw new Error(r.error || `Couldn't stop ${t.label}.`);
        await cx.sleep(600);
        if (canMirror(t.harness)) {
          const box = (await inputBox("read", t)).box;
          const last = [...this.reader.session.messages].reverse().find(m => m.kind === "message");
          if (box && last?.role === "user" && box.trim() === last.text.trim()) this.retracted = { key: this.key, text: last.text };
          if (this.composer.blank()) this.composer.pullDraft(t, sessionOf(t), cx);
        }
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.stopping = false; cx.notify(); }
    });
  }

  /** Whether the agent's conversation hasn't started: no log yet, rather than loading or failing. */
  fresh(active) {
    return Boolean(active) && !this.reader.session.path && !this.reader.readError && /hasn't written|Waiting for this/.test(this.note || "");
  }

  /** The empty chat for a conversation that hasn't started: the agent's logo and an invitation to write. */
  welcome(t, active) {
    // Pond: a Claude conversation's welcome shows the duck, not the program's robot.
    const duckLogo = /^claude/.test(active.app ?? "")
      ? div().w(58).h(56).flex_none().relative().overflow_hidden()
        .child(div().absolute().left(-28).top(0).child(duckMood("content", 56, { still: true })))
      : null;
    const logo = duckLogo ?? programIcon(active.program, 44, t.foreground) ?? image("frame/welcome/herdr.png").size(44).rounded(10).flex_none();
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(12).px(24)
      .child(logo)
      .child(div().text_center().text_size(17).font_semibold().text_color(t.foreground).child("What would you like to build today?"))
      .child(div().max_w(420).text_center().text_size(13).text_color(t.muted).child(`Send a message to start this conversation with ${active.label}.`));
  }

  /** The scene's name, at the bottom right over the backdrop; a click shows the next one. */
  backdropButton(t) {
    return h_flex().id("backdrop-scene").absolute().bottom(12).right(14).h(26).px(10).gap(6).items_center().rounded(13)
      .border_1().border_color(t.border).bg(t.background).cursor_pointer()
      .text_size(11.5).text_color(t.muted).hover(s => s.text_color(t.foreground).bg(t.hover))
      .tooltip("Next background animation")
      .on_click((_e, cx) => { setShared(BACKDROP_SCENE, nextScene(shared(BACKDROP_SCENE)).id); cx.notify(); })
      .child(icon("layers", 12, t.dim))
      .child(sceneFor(shared(BACKDROP_SCENE)).label);
  }

  header(t, active) {
    // Pond: a Claude agent's header shows its duck, its mood the agent's status, as the terminal view's does.
    const figure = /^claude/.test(active?.app ?? "") ? duck(active.status, 16, 0) : null;
    const glyph = figure ?? programIcon(active?.program, 15, t.muted), badge = statusBadge(t, active?.status);
    const pane = active?.pane, zoomed = Boolean(pane && panes().find(p => p.pane === pane)?.zoomed);
    return h_flex().id("chat-header").h(42).px(14).gap(9).items_center().flex_none()
      .on_hover((hovered, cx) => { if (this.headerHovered !== hovered) { this.headerHovered = hovered; cx.notify(); } })
      .when(Boolean(glyph), el => el.child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(active?.title || active?.label || ""))
      .when(Boolean(this.headerHovered && pane), el => el.children(paneButtons(t, pane, zoomed, "chat")))
      .when(Boolean(badge), el => el.child(badge))
      .when(chatOn(), el => el.child(viewToggle(t, "chat", "view", () => {}, () => switchTo("terminal", active ? sessionOf(active) : ""))));
  }

  /**
   * The line over the reply box, set like the line under it (the footer's 11.5 px in a 24 px row: the spark or dot
   * centred where the model's 12 px icon is, 10 px in, and the text 5 px after it, where the model's name starts): what
   * the agent is doing, a machine that isn't answering, or reading new messages.
   */
  status(t, active) {
    const card = this.card.render(t, active);
    if (card) return card;
    const cue = this.reader.readCue();
    if (cue === "silent") {
      const who = active?.machine ? `${active.machine} isn't answering` : "Couldn't read new messages";
      return h_flex().w_full().max_w(COLUMN).h(24).pl(10).gap(5).items_center()
        .child(div().size(6).mx(3).rounded(3).flex_none().bg(t.blocked ?? t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted)
          .child(this.reader.session.readAt ? `${who} · messages as of ${clock(this.reader.session.readAt)}` : who))
        .child(div().id("read-retry").px(10).h(24).flex().items_center().rounded(12).cursor_pointer()
          .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.reader.retry(cx)).child("Retry"));
    }
    if (active?.status === "working") {
      const since = this.workingSince(active);
      return h_flex().w_full().max_w(COLUMN).h(24).pl(10).gap(5).items_center()
        .child(div().w(12).flex_none().flex().justify_center().text_size(13).text_color(t.accent).frames(SPARK, 120).child(SPARK[0]))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted)
          .loop("opacity", { from: 0.55, to: 1, period: 1600 })
          .child((active.activity ? `${active.activity}…`.replace(/……$/, "…") : "Working…")
            + (since > 0 ? ` · ${duration((Date.now() - since) / 1000)}` : "")
            + (cue === "checking" ? " · checking for new messages" : "")));
    }
    if (cue === "checking") return h_flex().w_full().max_w(COLUMN).h(24).pl(10).gap(5).items_center()
      .child(div().size(6).mx(3).rounded(3).flex_none().bg(t.accent).loop("opacity", { from: 0.25, to: 1, period: 900 }))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 }).child("Checking for new messages…"));
    // The terminal view's last line after a turn: "Worked for 3m 50s".
    const worked = active ? this.lastTurnSecs() : null;
    if (worked != null) return h_flex().w_full().max_w(COLUMN).h(24).pl(10).gap(5).items_center()
      .child(div().w(12).flex_none().flex().justify_center().text_size(13).text_color(t.dim).child("✻"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`Worked for ${duration(worked)}`));
    return null;
  }

  /** Grey stand-ins for a conversation being read for the first time, in the shape of one. */
  placeholder(t) {
    const line = (w, op) => div().h(12).w(w).rounded(6).bg(t.raised).opacity(op);
    return v_flex().flex_1().min_h(0).justify_end().items_center().px(24).pb(8)
      .loop("opacity", { from: 0.45, to: 1, period: 1400 })
      .child(v_flex().w_full().max_w(COLUMN).gap(22)
        .child(h_flex().w_full().justify_end().child(div().h(44).w(260).rounded(18).bg(t.raised)))
        .child(v_flex().w_full().gap(10).child(line(520, 1)).child(line(460, 1)).child(line(300, 1)))
        .child(h_flex().w_full().justify_end().child(div().h(44).w(180).rounded(18).bg(t.raised)))
        .child(v_flex().w_full().gap(10).child(line(480, 1)).child(line(380, 1))));
  }

  render(cx) {
    if (this.initError) return div().p(20).text_color(theme().blocked).child(`herdr-chat init error: ${this.initError}`);
    try { return this.renderInner(cx); }
    catch (e) { return div().p(20).text_color(theme().blocked).child(`herdr-chat render error: ${e?.stack ?? e}`); }
  }

  /**
   * Presses the harness's key for the next mode or effort (switching.nextMode / nextEffort), then reads the new one off
   * the screen (switching.screenMode / screenEffort: a pattern whose first group is the value, `names` for its display
   * name, `none` for when it isn't shown). The log records these only with a message, so the screen is what's current.
   */
  cycle(what, active, logged, cx) {
    const key = this.key, sw = active.harness.switching, read = what === "mode" ? sw.screenMode : sw.screenEffort;
    this.screenSeen ??= {};
    cx.spawn(async cx => {
      await pressKeys(active, what === "mode" ? sw.nextMode : sw.nextEffort);
      if (!read) return;
      const waits = [200, 400, 800];
      for (const [i, wait] of waits.entries()) {
        await new Promise(done => cx.timer.after(wait, () => done()));
        const screen = ((await readScreen(active, 0)) ?? "").split("\n").slice(-12).join("\n");
        const found = [...screen.matchAll(new RegExp(read.pattern, "gi"))].at(-1)?.[1];
        const text = found ? (read.names?.[found] ?? read.names?.[found.toLowerCase()] ?? found) : i === waits.length - 1 ? read.none : null;
        if (text) { this.screenSeen[what] = { key, logged, text }; cx.notify(); return; }
      }
    });
  }

  /** The mode or effort read off the screen after a click, while the log still has what it had then. */
  seenOnScreen(what, logged) {
    const s = this.screenSeen?.[what];
    return s && s.key === this.key && s.logged === logged ? s.text : null;
  }

  /** The message just sent from the chat, shown at once until the log has it (withPending). */
  showPending(key, text) {
    const after = [...this.reader.session.messages].reverse().find(m => m.kind === "message" && m.role === "user") ?? null;
    this.pending = { key, text, after, at: Date.now() };
    this.list.follow();
  }

  /** The send failed: the message goes back to the box, so it leaves the conversation. */
  dropPending(key, text) {
    if (this.pending?.key === key && this.pending.text === text) this.pending = null;
  }

  /**
   * The messages with the one just sent from the chat at the end, drawn as the person's message, until the log has a
   * newer message of theirs than it had at sending (or a minute passes). The same array while nothing changes, so the
   * rows built from it are reused.
   */
  withPending(messages) {
    const p = this.pending;
    if (!p || p.key !== this.key) return messages;
    const last = [...messages].reverse().find(m => m.kind === "message" && m.role === "user") ?? null;
    if (last !== p.after || Date.now() - p.at > 60000) { this.pending = null; return messages; }
    // Sent while the agent was busy: the agent queued it, and the queued row (dimmed, at the end) is that message.
    const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
    if ((this.reader.session.queued ?? []).some(q => norm(q) === norm(p.text))) { this.pending = null; return messages; }
    const c = this.pendingRows;
    if (c?.messages === messages && c.pending === p) return c.rows;
    const rows = [...messages, { kind: "message", role: "user", phase: "", text: p.text }];
    this.pendingRows = { messages, pending: p, rows };
    return rows;
  }

  /**
   * The messages with the reply a question is waiting on at the end, read off the screen (Claude Code logs it only once
   * the question is answered), until the log has it. The same array while nothing changes, so its rows are reused.
   */
  withScreenReply(messages) {
    const screen = this.card.screenForReply();
    if (!screen) return messages;
    const c = this.screenRows;
    if (c?.messages === messages && c.screen === screen) return c.rows;
    const logged = messages.filter(m => m.kind === "message" && m.role !== "user").map(m => m.text);
    const reply = replyFromScreen(screen, logged);
    const rows = reply ? [...messages, { kind: "message", role: "assistant", phase: "screen", text: reply.text, partial: reply.partial }] : messages;
    this.screenRows = { messages, screen, rows };
    return rows;
  }

  /**
   * The messages as rows (copy rows added, diagrams and code blocks split out), rebuilt only when the messages change:
   * a read with nothing new keeps the same array, so most redraws reuse the last rows and their row objects.
   */
  splitRows(messages, working) {
    const c = this.rowCache;
    if (c && c.messages === messages && c.working === working) return c.rows;
    const rows = withCopyRows(messages, working).flatMap(m => {
      const parts = m.kind === "message" && m.role !== "user" && m.text?.includes("```mermaid") ? splitDiagrams(m.text) : null;
      const pieces = parts ? parts.flatMap(p => p.kind === "diagram" ? [{ kind: "diagram", text: p.text }, { kind: "diagram-tools", text: p.text }] : [{ ...m, text: p.text }]) : [m];
      return pieces.flatMap(r => {
        const code = r.kind === "message" && r.role !== "user" && r.text?.includes("```") ? splitCode(r.text) : null;
        return code ? code.map(c => c.kind === "code" ? c : { ...r, text: c.text }) : [r];
      });
    });
    this.rowCache = { messages, working, rows };
    return rows;
  }

  /**
   * Which of a diagram's two buttons is at `x` (design px across the list): they sit at the left of the reply's column.
   */
  diagramButtonAt(x) {
    if (!Number.isFinite(x)) return null;
    const column = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 48)), left = (this.width - column) / 2;
    if (x >= left && x <= left + TOOL_BUTTON) return "image";
    if (x >= left + TOOL_BUTTON + TOOL_GAP && x <= left + 2 * TOOL_BUTTON + TOOL_GAP) return "code";
    return null;
  }

  /** Copy code: the diagram's mermaid source. Copy image: the drawn diagram as a PNG, on the theme's background. */
  diagramTool(key, row, which, cx) {
    if (!which) return;
    const done = mark => { this.copied = mark; cx.notify(); cx.timer.after(1500, cx => { if (this.copied === mark) { this.copied = null; cx.notify(); } }); };
    if (which === "code") { cx.write_to_clipboard(row.text); done(`${key}:code`); return; }
    const d = diagramFor(row.text, theme());
    if (d.state !== "ready") return;
    this.copied = `${key}:image:busy`; cx.notify();
    cx.spawn(async cx => {
      const error = await copyDiagramImage(d, String(theme().background ?? "#000000").slice(0, 7));
      if (error) { this.copied = null; this.note = error; cx.notify(); }
      else done(`${key}:image`);
    });
  }

  /**
   * Whether a click at `x` (design px across the list) is on a response's Send to Notes button: its copy button (24 px)
   * and NOTES_GAP come first, then the button, narrower while it reads "Sent".
   */
  notesButtonAt(x, sent = false) {
    if (!Number.isFinite(x)) return false;
    const column = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 48)), left = (this.width - column) / 2;
    const start = left + 24 + NOTES_GAP;
    return x >= start && x <= start + (sent ? NOTES_SENT : NOTES_BUTTON);
  }

  /**
   * Saves a message into the Notes mod's vault (notes.js): the branch's feature note under "## Notes", made with its
   * repo note when missing, or a note at the vault's root outside a git repo. The Notes panel watches the vault, so the
   * note shows there at once.
   */
  async sendToNotes(m, cx) {
    if (this.notesSending) return;
    // The vault and its folder are the Notes mod's settings: without that mod, offer to install it.
    if (!(await readTextFile(`${appHome()}/mods/notes/mod.json`).then(() => true, () => false))) { offerNotes(); return; }
    this.notesSending = true;
    const t = target();
    let saved = null;
    try {
      saved = await sendToVault({ text: String(m.text ?? ""), cwd: t?.cwd, machine: t?.machine, label: t?.label });
      if (!saved) this.note = "Notes has no vault yet: set one in the Notes panel";
    } catch (e) {
      this.note = `Couldn't save the note: ${e?.message ?? e}`;
    } finally {
      this.notesSending = false;
    }
    if (!saved) { cx.notify(); return; }
    this.sentNote = m.key;
    cx.notify();
    cx.timer.after(1800, cx => { if (this.sentNote === m.key) { this.sentNote = null; cx.notify(); } });
  }

  /**
   * A trigger with its menu above it (open while this.menu === id): rows of { key, text, note?, on }, picked with a
   * click, closed by a press anywhere else.
   */
  menuButton(t, id, open, trigger, items, onPick, width = 200) {
    return Popup.new(`menu-${id}`, trigger).anchor("bottom_left")
      .when(open, pop => {
        const rows = 12, top = Math.min(this.menuOffset ?? 0, Math.max(0, items.length - rows));
        const shown = items.slice(top, top + rows);
        return pop.content(v_flex().id(`menu-${id}`).w(width).h(Math.min(items.length, rows) * 28 + (items.length > rows ? 24 : 0) + 8)
          .mb(12).p(4).rounded(10).border_1().border_color(t.border)
          .bg(t.popover ?? t.raised).shadow_md().text_size(12.5)
          .on_mouse_down_out((_e, cx) => { if (this.menu === id) { this.menu = null; this.menuClosed = { id, at: Date.now() }; cx.notify(); } })
          // Wheel moves the window of rows; a fixed column alone could not scroll inside a popup. Deltas
          // accumulate (a trackpad sends fractions; a wheel notch is one event) so a flick moves several rows
          // and a slow drag still moves one, the way the app's own picker scrolls.
          .on_scroll_wheel((e, cx) => {
            cx.stop_propagation();
            const max = Math.max(0, items.length - rows);
            this.menuWheel = (this.menuWheel ?? 0) + e.delta.y;
            const steps = Math.trunc(this.menuWheel / 30);
            if (!steps) return;
            this.menuWheel -= steps * 30;
            const next = Math.max(0, Math.min(max, top - steps));
            if (next !== top) { this.menuOffset = next; cx.notify(); }
          })
          .children(shown.map(item => h_flex().id(`menu-${id}-${item.key}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
            .text_color(item.on ? t.foreground : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; onPick(item, cx); cx.notify(); })
            .child(div().w(12).flex_none().child(item.on ? icon("check", 12, t.accent) : div()))
            .child(div().flex_1().min_w(0).truncate().child(item.text))
            .when(Boolean(item.note), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(item.note)))))
          .when(items.length > rows, el => el.child(div().px(8).h(20).flex().items_center().text_size(10.5).text_color(t.dim)
            .child(`${top + 1}–${top + shown.length} of ${items.length}`))));
      });
  }

  /**
   * Opens menu `id` from its button, or closes it. Pressing the button while it's open is a press outside the menu,
   * which closes it first; that same press's click then lands here and would open it again, so a menu just closed that
   * way stays shut.
   */
  toggleMenu(id, cx) {
    const justClosed = this.menuClosed?.id === id && Date.now() - this.menuClosed.at < 400;
    this.menuClosed = null;
    this.menu = this.menu === id || justClosed ? null : id;
    if (this.menu) { this.menuOffset = 0; this.menuWheel = 0; }
    if (this.menu === "model") this.loadModels(cx);
    cx.notify();
  }

  /** Pond's duck for the agent on screen, in a fixed box: its mood follows the agent's status. */
  fig(active) {
    return h_flex().w(26).h(20).flex_none().items_center().justify_center().child(duck(active.status, 15, 0));
  }

  /** Types a switch (/model, /effort) into the agent, as the person would. */
  switchTo(active, line, cx) {
    if (!line) { this.note = "This agent can't switch models."; cx.notify(); return; }
    this.note = `Switching to ${line.replace(/^\/\w+\s*/, "")}…`;
    cx.notify();
    // The click's cx is gone once anything is awaited: the task gets its own.
    cx.spawn(async (cx) => {
      try {
        await sendMessage(active, line);
        if (String(this.note ?? "").startsWith("Switching")) this.note = null;
      } catch (e) { this.note = String(e?.message ?? e); }
      cx.notify();
    });
  }

  /**
   * The screen once two reads in a row agree: a terminal read can come back a frame behind, and acting on a stale row
   * is how the cursor ends up on the wrong one.
   */
  async settle(active, cx, tries = 10) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      const screen = (await readScreen(active, 60)) ?? "";
      if (last !== null && screen === last) return screen;
      last = screen;
      await cx.sleep(120);
    }
    return last ?? "";
  }

  /**
   * Waits for the terminal to say what a switch did. Claude Code asks "Switch model?" first when the conversation's
   * cache is for the old model: the person already chose in the chat, so this answers "Yes, switch". Only what is new
   * since `before` counts: the screen keeps the answers to earlier commands, and its lines scroll.
   */
  async switchAnswer(active, cx, before, want) {
    const answers = (s) => [...String(s).matchAll(/(?:Set model to|Kept model as)\s+([^\n]+?)(?: and saved|$)/gm)].map((m) => m[1].trim());
    const refusals = (s) => [...String(s).matchAll(/(?:API error|model not changed|Invalid model|Unknown model)[^\n]*/gi)].map((m) => m[0].trim());
    const baseAnswer = answers(before).at(-1) ?? "", baseBad = refusals(before).at(-1) ?? "";
    let answeredAt = 0;
    for (let i = 0; i < 30; i++) {
      await cx.sleep(150);
      const screen = (await readScreen(active, 0)) ?? "";
      if (/Switch model\?/.test(screen)) {
        if (Date.now() - answeredAt > 1200) { answeredAt = Date.now(); await this.answerSwitch(active, screen); }
        continue;
      }
      const bad = refusals(screen).at(-1);
      if (bad && bad !== baseBad) return { model: "", why: bad };
      // The terminal's own status line names the model it is on, the moment it changes.
      const label = labelsOf(active.address).model;
      if (label && modelKey(label) === modelKey(want)) return { model: label };
      const answer = answers(screen).at(-1);
      if (answer && answer !== baseAnswer) return { model: answer };
    }
    return null;
  }

  /** Answers Claude Code's "Switch model?" with its "Yes, switch" row. */
  async answerSwitch(active, screen) {
    const rows = screen.split("\n").map((line) => {
      const m = /^\s*([❯❱›>])?\s*(\d+)\.\s+(.*)$/.exec(line);
      return m ? { sel: Boolean(m[1]), n: Number(m[2]), text: m[3].trim() } : null;
    }).filter(Boolean);
    const yes = rows.find((r) => /^yes\b/i.test(r.text));
    if (!yes) return;
    const sel = rows.find((r) => r.sel) ?? yes;
    const delta = yes.n - sel.n;
    if (delta) await pressKeys(active, Array(Math.abs(delta)).fill(delta > 0 ? "down" : "up"));
    await pressKeys(active, ["enter"]);
  }

  /**
   * Switches the model. `/model <name>` (a shortcut, or a gateway model's id) usually sets it at once; when the terminal
   * doesn't take it, its own /model menu is driven instead, as a person would: the row found by name, down/up and Enter.
   * The terminal's answer is read back either way, so the note says what really happened, never just that it tried.
   */
  switchModel(active, item, cx) {
    const target = String(item.text ?? "");
    this.note = `Switching to ${target}…`;
    cx.notify();
    // The click's cx is gone once anything is awaited: the whole switch runs as a task with its own.
    cx.spawn(async (cx) => this.runSwitch(active, item, target, cx));
  }

  async runSwitch(active, item, target, cx) {
    const alias = /^(opus|sonnet|haiku|default)$/i.test(String(item.switchTo ?? ""));
    const line = alias ? `/model ${item.switchTo}` : item.key ? `/model ${item.key}` : "";
    try {
      let answer = null;
      if (line) {
        const before = (await readScreen(active, 0)) ?? "";
        await sendMessage(active, line);
        answer = await this.switchAnswer(active, cx, before, target);
      }
      // A refusal ("API error … model not changed") can be about that one spelling: its own menu still sets it.
      if (!answer?.model) answer = (await this.pickInModelMenu(active, target, cx)) ?? answer;
      if (answer?.model) {
        // The terminal is the truth: say so when it landed somewhere other than what was picked.
        const got = modelKey(answer.model), want = modelKey(target);
        this.note = got === want || sameModel(answer.model, item.key) ? null : `The terminal switched to ${answer.model}, not ${target}.`;
        cx.notify();
        return;
      }
      this.note = answer?.why || `Couldn't switch to ${target}.`;
      cx.notify();
    } catch (e) {
      this.note = String(e?.message ?? e);
      cx.notify();
    }
  }

  /** The terminal's own /model menu: the row named like `target`, the cursor moved onto it, Enter, the answer read back. */
  async pickInModelMenu(active, target, cx) {
    const key = modelKey(target);
    const before = (await readScreen(active, 0)) ?? "";
    await sendMessage(active, "/model");
    let sawMenu = false;
    try {
      for (let page = 0; page < 6; page++) {
        let screen = "";
        for (let i = 0; i < 14; i++) {
          screen = await this.settle(active, cx, 2);
          // The menu's title, or its cursor row: a numbered line of the conversation above must not count as the menu.
          if (/Select model/.test(screen) || /^\s*❯\s*\d+\.\s/m.test(screen)) break;
          await cx.sleep(120);
        }
        // A row is its number, its name, then its description after a wide gap; the name alone is what a model is
        // called ("Opus ✔", "Claude Fable 5.2"), so the description never takes part in the match.
        const rows = screen.split("\n").map((line) => {
          const m = /^\s*(❯)?\s*(\d+)\.\s+(.*)$/.exec(line);
          if (!m) return null;
          const raw = m[3].split(/\s{2,}/)[0].replace(/[✔✓]/g, "").trim();
          // A narrow menu cuts a long name short: only a cut name may be shorter than what the chat asked for.
          return { sel: m[1] === "❯", n: Number(m[2]), name: modelKey(raw), cut: /…|\.\.$/.test(raw) };
        }).filter(Boolean);
        if (!rows.length) return null;
        sawMenu = true;
        // An exact name wins ("Opus 4.8" over the "Opus" shortcut above it), then the shortest name the key starts (the
        // menu says "Claude Fable 5.2", the chat "Fable 5.2"), then — only for a name the menu cut short — the longest
        // cut name the key starts with. Without that last check "Acme 1 Code" answers for "… 1 Code Task".
        const named = rows.filter((r) => r.name);
        const found = named.find((r) => r.name === key)
          ?? named.filter((r) => r.name.startsWith(key)).sort((a, b) => a.name.length - b.name.length)[0]
          ?? named.filter((r) => r.cut && key.startsWith(r.name)).sort((a, b) => b.name.length - a.name.length)[0];
        const sel = rows.find((r) => r.sel) ?? rows[0];
        if (found) {
          const delta = found.n - sel.n;
          if (delta) {
            await pressKeys(active, Array(Math.min(30, Math.abs(delta))).fill(delta > 0 ? "down" : "up"));
            // Let the cursor land before Enter, or Enter takes the row it was on.
            await this.settle(active, cx);
          }
          await pressKeys(active, ["enter"]);
          return await this.switchAnswer(active, cx, before, target);
        }
        // The row is further down the menu: page and look again.
        await pressKeys(active, Array(8).fill("down"));
        await this.settle(active, cx);
      }
      return null;
    } finally {
      // Leave the terminal as it was: a menu left open hides its prompt (Esc only once the menu was really up, or it
      // would stop a working turn).
      const open = sawMenu && /Select model|Esc to cancel/.test((await readScreen(active, 0)) ?? "");
      if (open) await pressKeys(active, ["esc"]).catch(() => null);
    }
  }

  /**
   * The model the agent is on now: the terminal's own label (its status line writes it the moment the model changes),
   * over the log's, which only says so at the next message.
   */
  modelNow(active, look) {
    const label = active ? labelsOf(active.address).model : null;
    if (!label) return look?.model ?? null;
    const plain = (s) => String(s ?? "").toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/\[[^\]]*\]$/, "").replace(/^claude\s+/, "").trim();
    const hit = (look?.models ?? []).find(m => sameModel(m.id, label) || plain(m.name) === plain(label));
    return hit ? { id: hit.id, name: hit.name } : { id: label, name: label };
  }

  /**
   * First on the line under the message box: the agent's icon and model, as the line's other items; a click lists the
   * models to switch to.
   */
  modelChip(t, active) {
    const look = active ? runsWith(this.reader.session.meta, withCatalog(active.harness, active.address)) : null;
    const now = this.modelNow(active, look);
    if (!now) return null;
    // The menu lists what the agent's own source says (models.js): its gateway's models, or Claude Code's
    // aliases, read when the menu opened. Until one lands, the harness's list keeps the menu usable.
    const live = this.liveModels(active);
    const models = live?.list?.length ? live.list : look.models.length ? look.models : [
      { id: "default", name: "Default (recommended)", switchTo: "default" },
      { id: "opus", name: "Opus", switchTo: "opus" },
      { id: "sonnet", name: "Sonnet", switchTo: "sonnet" },
      { id: "haiku", name: "Haiku", switchTo: "haiku" },
    ];
    const canSwitch = Boolean(active.harness?.switching?.model);
    const via = live ? ` · from ${live.source}` : "";
    const chip = h_flex().id("model-chip").h(22).px(6).gap(5).flex_none().items_center().rounded(6).text_size(11.5).text_color(t.foreground)
      .tooltip(`${now.id}${via}${this.modelsError ? ` · couldn't read the list: ${this.modelsError}` : ""}`)
      .when(canSwitch, el => el.cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.toggleMenu("model", cx)))
      .when(/^claude/.test(active?.app ?? ""), el => el.child(this.fig(active)))
      .when(!/^claude/.test(active?.app ?? "") && Boolean(programIcon(active.program, 12, t.muted)), el => el.child(programIcon(active.program, 12, t.muted)))
      .child(cleanModelName(models.some(m => sameModel(now.id, m.id)) ? now.name : prettyModel(now.name)))
      .when(canSwitch, el => el.child(icon("chevron-down", 11, t.dim)));
    if (!canSwitch) return chip;
    const items = this.modelsLoading && !live
      ? [{ key: "reading", text: "Reading the models…", on: false }]
      : this.modelsError && !live
        ? [{ key: "unread", text: `Couldn't read the models`, note: this.modelsError.slice(0, 24), on: false }]
        : (models.some(m => sameModel(now.id, m.id))
          ? models
          : [{ id: now.id, name: prettyModel(now.name), switchTo: String(now.id).replace(/\[[^\]]*\]$/, ""), window: null }, ...models])
          .map(m => ({ key: m.id, text: cleanModelName(m.name), note: m.window ? tokens(m.window) : null, on: sameModel(now.id, m.id), switchTo: m.switchTo ?? m.id }));
    return this.menuButton(t, "model", this.menu === "model", chip, items,
      (item, cx) => { if (item.switchTo) this.switchModel(active, item, cx); }, 320);
  }

  /** The live /model list read for the shown agent (models.js), or null when it hasn't been read. */
  liveModels(active) {
    if (!active) return null;
    return modelList(active.address, active.harness?.id ?? "claude-code", profileOf(active.address));
  }

  /** Reads the shown agent's model list for its profile when the model menu opens; the menu fills in when it lands. */
  loadModels(cx) {
    const t = target();
    if (!t) return;
    this.modelsLoading = true; this.modelsError = null;
    cx.spawn(async cx => {
      const res = await fetchModels(t, profileOf(t.address)).catch(e => ({ list: [], error: String(e?.message ?? e) }));
      this.modelsLoading = false;
      this.modelsError = res?.error ?? null;
      cx.notify();
    });
  }

  /**
   * Under the message box: the effort (a menu) and the permission mode (a click moves to the next) at the left, each
   * with its icon; the context at the right: a gauge with the tokens used of the window and a filling bar, or with
   * harns's health bar chosen, a pixel heart in the bar's color with the share left ("62% left") and a bar draining as
   * the sidebar's does.
   */
  sessionLine(t, active, chip = null) {
    const look = active ? runsWith(this.reader.session.meta, withCatalog(active.harness, active.address)) : null;
    if (!look || (!chip && !look.effort && !look.mode && !look.context)) return null;
    const item = (id, glyph, text, tip) => h_flex().id(id).h(22).px(6).gap(5).flex_none().items_center().rounded(6).text_size(11.5).text_color(t.muted)
      .tooltip(tip).child(icon(glyph, 12, t.dim)).child(text);
    const sw = active.harness?.switching ?? {};
    // A stale harness can lose its effort levels too: Claude Code's own five still make a usable menu.
    const efforts = look.efforts.length ? look.efforts : ["low", "medium", "high", "xhigh", "max"];
    const switchEffort = Boolean(sw.effort);
    const clickable = el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground));
    // The log usually says the effort; when it doesn't, the item still shows (the model's default) so it stays clickable.
    const effortText = this.seenOnScreen("effort", look.effort) ?? look.effort ?? (switchEffort ? "default" : null);
    const effort = effortText ? item("session-effort", "zap", effortText, sw.nextEffort ? "Effort · click for the next one" : switchEffort ? "Effort · click to change" : "Effort")
      .when(Boolean(sw.nextEffort), el => clickable(el).on_click((_e, cx) => this.cycle("effort", active, look.effort, cx)))
      .when(switchEffort && !sw.nextEffort, el => clickable(el).on_click((_e, cx) => this.toggleMenu("effort", cx))) : null;
    const modeText = this.seenOnScreen("mode", look.mode?.key) ?? look.mode?.text;
    const mode = modeText ? item("session-mode", "shield", modeText, sw.nextMode ? "Mode · click for the next one" : "Mode")
      .when(Boolean(sw.nextMode), el => clickable(el).on_click((_e, cx) => this.cycle("mode", active, look.mode?.key, cx))) : null;
    const lab = active ? labelsOf(active.address) : {};
    const c = look.context && lab.percent != null
      ? { ...look.context, share: lab.percent, window: look.context.window ?? (look.context.used && lab.percent > 0 ? Math.round(look.context.used * 100 / lab.percent) : null) }
      : look.context;
    const health = c?.share == null ? null : healthFill(t, c.share);
    const bar = c?.share == null ? null : health ?? { share: c.share, color: c.share >= 95 ? "#d88179" : c.share >= 80 ? "#e8823a" : t.accent };
    const gauge = c ? h_flex().id("session-context").gap(6).items_center().text_size(11.5).text_color(t.muted)
      .tooltip(c.window ? `${c.used.toLocaleString()} of ${c.window.toLocaleString()} tokens of context in use` : `${c.used.toLocaleString()} tokens of context in use`)
      .child(health ? icon("heart-pixel", 13, bar.color) : icon("gauge", 12, t.dim))
      .child(health ? contextText(c.share) : c.window ? `${tokens(c.used)} / ${tokens(c.window)}` : tokens(c.used))
      .when(Boolean(bar), el => el.child(div().w(96).h(4).flex_none().rounded_full().bg(t.border)
        .when(bar.share > 0, b => b.child(div().h_full().rounded_full().w(Math.max(2, Math.round(96 * bar.share / 100))).bg(bar.color))))) : null;
    return h_flex().w_full().h(24).px(4).items_center()
      .child(h_flex().flex_1().min_w(0).gap(2).items_center()
        .when(Boolean(chip), el => el.child(chip))
        .when(Boolean(effort), el => el.child(switchEffort && !sw.nextEffort
          ? this.menuButton(t, "effort", this.menu === "effort", effort,
            efforts.map(e => ({ key: e, text: e, on: e === look.effort })),
            (picked, cx) => this.switchTo(active, switchCommand(active.harness, "effort", { effort: picked.key, model: (this.modelNow(active, look) ?? {}).id }), cx), 140)
          : effort))
        .when(Boolean(mode), el => el.child(mode)))
      .when(Boolean(gauge), el => el.child(gauge));
  }

  /** What the backdrop is told: slower and dimmer behind a conversation, and the last stir. */
  backdropProps() {
    const slow = Boolean(this.backdropSlow);
    return { dim: slow ? BACKDROP_CHAT_DIM : BACKDROP_DIM, slow, sceneKey: BACKDROP_SCENE, stir: this.stirAt };
  }

  /** The chat is in use (the pointer moving over it, a message, typing): keeps the backdrop from resting on its last
   *  frame, at most once per STIR_MS. Only from an event or a timer, since set_props can't run in a render. */
  stirBackdrop() {
    if (!this.backdropShown || Date.now() - this.stirAt < STIR_MS) return;
    this.stirAt = Date.now();
    this.backdrop.set_props(this.backdropProps());
  }

  /** Looks (every 100 ms) for activity that isn't the pointer: a new message, the agent's status changing, typing. */
  noticeActivity() {
    if (!this.backdropShown) return;
    const messages = this.reader.session.messages;
    const last = messages[messages.length - 1];
    const sign = `${this.key}|${messages.length}|${String(last?.text ?? "").length}|${target()?.status}|${this.composer.input.value().length}`;
    if (sign !== this.activitySign) { this.activitySign = sign; this.stirBackdrop(); }
  }

  renderInner(cx) {
    if (this.asHeader) return terminalHeader(this);
    if (this.diagram) return this.diagram.render(cx);
    const t = theme();
    const active = target();
    if (chatKey(active) !== this.key) this.switchSession(active, chatKey(active));
    const shown = withoutRetracted(this.reader.session.messages, this.retracted?.key === this.key ? this.retracted.text : null);
    if (!shown.retracted && this.retracted?.key === this.key) this.retracted = null;
    // Prompts queued in the agent and not yet delivered: shown at the end, dimmed, until the log delivers them.
    const queuedRows = (this.reader.session.queued ?? []).map(text => ({ kind: "message", role: "user", phase: "queued", text }));
    const rows = [...this.splitRows([...this.withPending(this.withScreenReply(shown.rows)), ...queuedRows], active?.status === "working")];
    if (this.note) rows.push({ kind: "note", text: this.note });
    const empty = rows.length === 0 || (rows.length === 1 && rows[0].kind === "note" && !this.reader.session.messages.length);
    keyRows(rows);
    rows.splice(0, rows.length, ...rows.flatMap(r => r.kind === "tools" && this.reader.session.open[r.key] ? [r, ...stepRows(r)] : [r]));
    const inner = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    this.backdropShown = Boolean(this.backdrop) && shared("herdr-chat.animation") !== false;
    if (this.backdropShown && this.backdropSlow !== !empty) {
      this.backdropSlow = !empty;
      cx.timer.after(0, () => this.backdrop.set_props(this.backdropProps()));
    }
    const { body, measure } = this.list.render(cx, {
      rows, empty, t, inner, zoom: this.zoom, beforeScroll: () => this.noticeVisit(),
      heightKey: m => `${m.key}${this.reader.session.open[m.key] ? ":open" : ""}${m.kind === "diagram" ? `:${diagramFor(m.text, t).state}` : ""}`,
      waitsFor: m => m.kind === "diagram" && diagramFor(m.text, t).state === "queued",
      row: m => row(m, { t, open: this.reader.session.open, width: this.width, sent: this.composer.sent, machine: target()?.machine, copied: this.copied, notesSent: this.sentNote,
        repo: this.git.repoFor(target()?.cwd),
        sendQueued: this.composer.canSendQueued() ? cx => this.composer.sendQueued(cx) : null }),
      onItemClick: (key, cx) => {
        const row = rows.find(r => r.key === key);
        if (row?.kind === "copy" && !row.prompt && this.notesButtonAt(this.list.pointerX, this.sentNote === row.key)) { this.sendToNotes(row, cx); return; }
        if (row?.kind === "code" || row?.kind === "copy") {
          cx.write_to_clipboard(row.text);
          this.copied = key; cx.notify();
          cx.timer.after(1500, cx => { if (this.copied === key) { this.copied = null; cx.notify(); } });
          return;
        }
        if (row?.kind === "diagram") {
          const d = diagramFor(row.text, t);
          if (d.state === "ready") openDiagram(d);
          return;
        }
        if (row?.kind === "diagram-tools") { this.diagramTool(key, row, this.diagramButtonAt(this.list.pointerX), cx); return; }
        const opens = row?.kind === "tools" || (row?.kind === "step" && (this.reader.session.open[key] || stepHasBody(row.call)));
        if (opens) { this.reader.session.open[key] = !this.reader.session.open[key]; cx.notify(); }
      },
      canJump: !this.card.showing && active?.status !== "blocked",
    });
    const status = this.status(t, active);
    // The question card takes the whole line; otherwise the git buttons share it with the status, at its right.
    const gitButtons = this.card.showing ? null : this.git.render(t, active);
    return v_flex().id("herdr-chat-root").relative().size_full().min_h(0).rounded(10).border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground)
      .when(this.backdropShown, el => el.child(this.backdrop))
      .when(this.backdropShown && empty, el => el.child(this.backdropButton(t)))
      .on_mouse_move(() => this.stirBackdrop())
      .on_size_change((size, cx) => { this.rootPx = size.width; const w = designPx(size.width, this.zoom); if (w >= 200 && Math.abs(w - this.width) > 8) { this.width = w; cx.notify(); } })
      .child(zoomProbe((zoom, cx) => { if (Math.abs(zoom - this.zoom) > 0.001) { this.zoom = zoom; if (this.rootPx) this.width = designPx(this.rootPx, zoom); cx.notify(); } }))
      .on_drop((e, cx) => this.composer.dropFiles(e.paths ?? [], cx))
      .child(this.header(t, active).when(this.backdropShown && !empty, el => el.bg(t.background).rounded_t(10)))
      .when(empty && /^Opening/.test(this.note || ""), el => el.child(this.placeholder(t)))
      .when(empty && this.fresh(active), el => el.child(this.welcome(t, active)))
      .when(empty && !/^Opening/.test(this.note || "") && !this.fresh(active), el => el.child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(14).px(24)
        .child(image("frame/welcome/herdr.png").size(64).rounded(14).flex_none()
          .when(/^(Opening|Finding)/.test(this.note || ""), el => el.loop("opacity", { from: 0.4, to: 1, period: 1600 })))
        .child(div().max_w(420).text_center().text_size(14).text_color(t.muted).child(this.note))))
      .when(!empty, el => el.child(body))
      .when(Boolean(measure), el => el.child(measure))
      .child(v_flex().w_full().flex_none().items_center().px(24).pt(12).pb(14).gap(6)
        .when(this.backdropShown && !empty, el => el.bg(t.background).rounded_b(10))
        .child(h_flex().w_full().max_w(COLUMN).min_h(24).gap(8).items_center()
          .child(div().flex_1().min_w(0).child(status ?? div().w_full().h(24)))
          .when(Boolean(gitButtons), el => el.child(gitButtons)))
        .child(this.composer.render(t, active, this.sessionLine(t, active, this.modelChip(t, active)))));
  }
}


