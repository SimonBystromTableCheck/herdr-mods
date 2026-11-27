import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState } from "gpui-base";
import { shared, setShared, run, hc, exec } from "herdr";
import { ICONS, sessionOf, chatKey } from "../common.js";
import { onWindows, modFile, removeFiles, pruneOld } from "../platform.js";
import { target, sendMessage, pressKeys, inputBox, inputHint } from "../terminal-fix3.js";
import { imageStyle, canMirror, withImages, draftPastes, textOfBox, readBack, viaDaemon } from "../harnesses/index.js";
import { savedDraft, storeDraft, keptImages } from "../draft.js";
import { IMAGE_FILE, DOC_FILE, attachDir, attachName, ATTACH_DIR, keepSent, sentNames, fetchSent, previewName, previewFile, staleSent, dropSent } from "../images.js";
import { caretOf, lineMove } from "../model/caret.js";
import { COLUMN, icon } from "../ui/primitives.js";
import { SkillMenu } from "./skill-menu.js";
import { askDaemon } from "./session-reader.js";
import { passKey, passKeys, passAction, bindComposerKeys } from "../keys.js";
import { skillToken } from "../model/skills.js";

const DRAFT_PAUSE = 400;
// Text other mods hand an agent (see takeInbox), and how long a hand-off waits for the view to settle first.
const INBOX_KEY = "herdr-chat.inbox";
const INBOX_SETTLE = 250;
const SENT_PRUNE_EVERY = 3600000;

export class Composer {
  /**
   * The reply box: one draft per session (text and images), mirrored into the agent's own box, and sending it. `host`
   * is the view: its `sending` lock, `note`, `key`, `list`, `card`, `stop()`, `stopping`, `showPending()` /
   * `dropPending()` for the message just sent, and `backdropShown` (whether the backdrop is behind the box now).
   */
  constructor(host, cx) {
    this.host = host;
    this.input = TextareaState.new({ placeholder: "", rows: 1 });
    this.input.set_soft_wrap(true);
    this.input.set_auto_grow(1, 4);
    this.input.on("submit", (e, cx) => { if (!e?.shift) this.enter(cx); });
    // Whether the box has the keyboard: drawn as a ring, and read by the leader's way back (agent-chat.focus).
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.on("change", (_e, cx) => {
      if (Date.now() - (this.enterAt ?? 0) < 400) {
        const v = this.input.value(), s = v.replace(/\r?\n$/, "");
        if (s !== v) this.input.set_value(s);
      }
      // Typing takes the agent's suggested prompt away, as typing in its own box does.
      if (this.hint && this.input.value().trim()) { this.hint = ""; this.hintToken++; }
      this.keepDraft(cx);
      cx.notify();
    });
    this.input.on("paste_other", (_e, cx) => { if (Date.now() - (this.imagePasteAt ?? 0) > 800) this.pasteImage(cx); });
    bindComposerKeys(cx);
    this.menu = new SkillMenu(this);
    this.attachments = []; this.drafts = new Map();
    this.mirror = null; this.mirrorChain = Promise.resolve();
    // The agent's suggested next prompt (its own box's dim hint), per session: shown while the box is empty.
    this.hint = ""; this.hintKey = ""; this.hintToken = 0; this.wasWorking = false;
    this.lastMode = shared("herdr-chat.mode"); this.lastModeSession = "";
    this.pruneCache();
    this.sent = new Set(); this.fetching = new Set();
    cx.spawn(async cx => { for (const n of await sentNames()) this.sent.add(n); this.sentReady = true; await this.pruneSent(); cx.notify(); });
    cx.timer.every(SENT_PRUNE_EVERY, () => { this.pruneSent(); });
  }

  /** Whether the box holds nothing to send. */
  blank() {
    return !this.input.value().trim() && !this.attachments.length;
  }

  /**
   * The agent's suggested next prompt: the dim text Claude Code leaves in its own input box when a turn is over. Read
   * off its screen when a turn ends and when another session is shown (see the host's timer), and shown as the empty
   * box's hint; working, typing and sending take it away, as they take it away in the terminal.
   */
  noticeHint(t, cx) {
    const key = t?.address ?? "";
    if (key !== this.hintKey) {
      this.hintKey = key; this.hint = ""; this.hintToken++;
      this.wasWorking = t?.status === "working";
      if (t && !this.wasWorking) this.fetchHint(t, cx, 600);
      return;
    }
    if (!t) return;
    if (t.status === "working") {
      this.wasWorking = true;
      if (this.hint) { this.hint = ""; this.hintToken++; cx.notify(); }
      return;
    }
    if (this.wasWorking) { this.wasWorking = false; this.fetchHint(t, cx, 1200); }
  }

  /** Reads the suggestion once, then again a couple of times when the agent hasn't written one yet (it takes a moment). */
  fetchHint(t, cx, delay, retries = 2) {
    const token = ++this.hintToken, key = t?.address ?? "";
    cx.timer.after(delay, (cx) => {
      if (token !== this.hintToken) return;
      cx.spawn(async (cx) => {
        const hint = await inputHint(t);
        if (token !== this.hintToken || key !== this.hintKey) return;
        if (hint) { this.hint = hint; cx.notify(); return; }
        if (retries > 0) this.fetchHint(t, cx, 2200, retries - 1);
      });
    });
  }

  /** The suggestion clicked: its prompt in the box, ready to send ("Try \"…\"" is the terminal's wrapping). */
  useHint(cx) {
    const text = this.hint.replace(/^Try\s+"(.*)"$/, "$1");
    this.hint = ""; this.hintToken++;
    this.input.set_value(text);
    this.input.focus();
    cx.notify();
  }

  /** The chat box and the agent's own input box hold the same draft. */
  mirrorOnSwitch(cx) {
    const mode = shared("herdr-chat.mode"), t = target();
    const session = t ? sessionOf(t) : "";
    const was = this.lastMode, wasSession = this.lastModeSession;
    this.lastMode = mode; this.lastModeSession = session;
    if (mode === "chat" && (was !== "chat" || session !== wasSession)) this.input.focus();
    // Back in Chat with nothing typed: the terminal may hold a suggestion from since the hint was read.
    if (mode === "chat" && was === "terminal" && t && t.status !== "working" && this.blank() && !this.hint) this.fetchHint(t, cx, 400);
    if (mode === was || !t || session !== wasSession || !canMirror(t.harness) || this.host.sending || this.host.card.choices) return;
    if (was === "chat" && mode === "terminal") this.pushDraft(t, session, cx);
    else if (was === "terminal" && mode === "chat") this.pullDraft(t, session, cx);
  }

  /** Runs a mirror step after the ones before it, one at a time: a quick switch back waits for the push to finish. */
  queueMirror(cx, step) {
    this.mirrorChain = this.mirrorChain.then(() => new Promise(done => cx.spawn(async cx => {
      try { await step(cx); } catch {} finally { done(); }
    })));
  }

  pushDraft(t, session, cx) {
    const text = this.input.value(), images = this.attachments.slice();
    const sig = `${text}\u0000${images.map(a => a.file).join("|")}`;
    if (this.mirror?.session === session && this.mirror.sig === sig) return;
    this.queueMirror(cx, async () => {
      const paths = await this.placeImages(t, images);
      const { pastes, pasted } = draftPastes(t.harness, paths, text);
      const r = await inputBox("set", t, JSON.stringify(pastes));
      if (!r.ok) return;
      const box = r.box ?? "";
      const textBox = textOfBox(t.harness, box);
      this.mirror = { session, sig, images, paths, pasted, textBox, box, foreign: false };
    });
  }

  /** The agent's box back into the chat. */
  pullDraft(t, session, cx) {
    this.queueMirror(cx, async cx => {
      const r = await inputBox("read", t);
      if (!r.ok) return;
      const box = r.box;
      if (box == null || target()?.address !== t.address || shared("herdr-chat.mode") !== "chat") return;
      const m = this.mirror?.session === session ? this.mirror : null;
      if (m && box === m.box) return;
      const { text, kept, foreign } = readBack(t.harness, box, m);
      if (foreign) {
        this.mirror = { ...(m ?? { session, sig: "", images: [], paths: [], pasted: "", textBox: "" }), box, foreign: true };
        this.host.note = `${t.label}'s input box has an image that was pasted into the terminal itself, and ${t.label} keeps that image where the chat can't read it. Send that draft from the Terminal view, or remove the image there.`;
        cx.notify();
        return;
      }
      const dropped = this.attachments.filter(a => m?.images.includes(a) && !kept.includes(a));
      this.forget(dropped);
      this.attachments = [...new Set([...kept, ...this.attachments.filter(a => !m?.images.includes(a))])];
      if (text !== this.input.value()) this.input.set_value(text);
      const sig = `${text}\u0000${this.attachments.map(a => a.file).join("|")}`;
      this.mirror = { ...(m ?? { session, images: [], paths: [], pasted: "", textBox: "" }), session, sig, box, foreign: false };
      this.keepDraft(cx);
      cx.notify();
    });
  }

  /**
   * Text another mod handed this agent (shared "herdr-chat.inbox" = { id, address, text, at }, e.g. the Notes panel's
   * Send): in Chat it joins the box, unsent; in Terminal it is pasted into the agent's own input, as a paste would be.
   * Taken once the view has had a moment to settle on the agent's session, and only by the copy showing that agent.
   */
  /** Whether the shown agent has queued prompts and a key chord that sends them now (Claude Code: ctrl+x ctrl+s). */
  canSendQueued() {
    return Boolean(target()?.harness?.sendQueued?.length && this.host.reader.session.queued?.length);
  }

  /** Presses the agent's send-queued chord in its terminal, so its queued prompts go in now. */
  sendQueued(cx) {
    const t = target(), keys = t?.harness?.sendQueued;
    if (!keys?.length) return;
    cx.spawn(async () => { await pressKeys(t, keys); });
  }

  takeInbox(t, cx) {
    const box = shared(INBOX_KEY);
    if (!box?.id || box.address !== t.address || this.pendingDraft || Date.now() - (box.at ?? 0) < INBOX_SETTLE) return;
    setShared(INBOX_KEY, null);
    const text = String(box.text ?? "");
    if (!text) return;
    if (shared("herdr-chat.mode") === "chat") {
      const v = this.input.value();
      this.input.set_value(!v ? text : /\s$/.test(v) ? v + text : `${v} ${text}`);
      this.input.focus();
      this.keepDraft(cx);
      cx.notify();
      return;
    }
    const old = cx.read_from_clipboard();
    cx.write_to_clipboard(text);
    run("pane.focus", { terminal: t.address });
    run("terminal.paste");
    cx.spawn(async cx => {
      await cx.sleep(400);
      if (old !== undefined && cx.read_from_clipboard() === text) cx.write_to_clipboard(old);
    });
  }

  /** Saves the reply box's draft (text and images) once typing pauses, so a reload of the chat keeps it. */
  keepDraft(cx) {
    const key = this.host.key, token = this.draftToken = (this.draftToken ?? 0) + 1;
    if (!key) return;
    cx.spawn(async cx => {
      await cx.sleep(DRAFT_PAUSE);
      if (token !== this.draftToken || key !== this.host.key) return;
      storeDraft(key, { text: this.input.value(), attachments: this.attachments });
    });
  }

  /** The reply box's draft kept for session `from` (default: the one shown), and `key`'s put in it. */
  swapDraft(key, from = this.host.key) {
    if (from) {
      const text = this.input.value(), attachments = this.attachments;
      if (text || attachments.length) this.drafts.set(from, { text, attachments });
      else this.drafts.delete(from);
    }
    const draft = key ? this.drafts.get(key) ?? savedDraft(key) : null;
    this.input.set_value(draft?.text ?? "");
    this.attachments = draft?.attachments ?? [];
    this.mirror = null;
  }

  /** `hc put` each image beside the agent's terminal (this computer or another) and return where they landed. */
  async placeImages(t, attached) {
    const placed = [];
    const where = sessionOf(t);
    for (const a of attached) {
      if (a.placed?.[where]) { placed.push(a.placed[where]); continue; }
      const r = await hc(["put", "--json", t.address, a.file]);
      let path = null;
      try { path = r.code === 0 ? JSON.parse(r.stdout).path : null; } catch {}
      if (!path) throw new Error(`Couldn't send ${a.name}${t.machine ? ` to ${t.machine}` : ""}: ${(r.stderr || r.stdout || "hc put failed").trim()}`);
      (a.placed ??= {})[where] = path;
      placed.push(path);
    }
    return placed;
  }

  /** Runs a prepare script; resolves with the preview copy's path, or null with the reason in the note. */
  async prepare(args, label) {
    const r = onWindows()
      ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), ...args.windows]).catch(e => ({ code: 1, stderr: String(e) }))
      : await exec("sh", args.unix).catch(e => ({ code: 1, stderr: String(e) }));
    const file = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if ((r.code === 0 || r.code === 5) && file) {
      if (r.code === 5) this.host.note = `${label} is over 250 KB and nothing here can shrink it (install ImageMagick), so the agent may not attach it.`;
      return file;
    }
    if (r.code === 3) return null;
    this.host.note = r.code === 4
      ? "Pasting images needs wl-paste (Wayland), xclip (X11) or pngpaste (macOS). Drop the file instead."
      : `Couldn't attach ${label}: ${(r.stderr || "it couldn't be read").trim()}`;
    return null;
  }

  /**
   * Adds a file to the draft of `owner`, the session it was added in, even if another one shows now: an image with its
   * preview copy (`image`), or a document (a PDF, a spreadsheet, a text file) as it is.
   */
  attach(file, name, cx, owner = this.host.key, image = true) {
    const a = image ? { name, file, rel: `${ATTACH_DIR}/${file.split(/[\\/]/).pop()}` } : { name, file };
    if (owner === this.host.key) { this.attachments.push(a); this.keepDraft(cx); }
    else {
      const d = this.drafts.get(owner) ?? savedDraft(owner) ?? { text: "", attachments: [] };
      const next = { ...d, attachments: [...d.attachments, a] };
      this.drafts.set(owner, next);
      storeDraft(owner, next);
    }
    cx.notify();
  }

  /**
   * Deletes the preview copies of attachments taken out of the box (after a send, or when one is removed). Only an
   * image has one: a PDF's own file is never touched.
   */
  forget(attachments) {
    removeFiles(attachments.filter(a => a.rel).map(a => a.file));
  }

  /** Sent images keep their previews in sent/, so the message's bubble can show them (a PDF shows as its name). */
  keepSent(attached, placed, t, cx) {
    const images = attached.map((a, i) => [a, placed[i]]).filter(([a]) => a.rel);
    if (!images.length) return;
    cx.spawn(async cx => { for (const n of await keepSent(images.map(([a]) => a.file), images.map(([, p]) => p), t.machine)) this.sent.add(n); cx.notify(); });
  }

  /** Fetches, once each, the images in `messages` that have no preview in sent/ yet, from the agent's machine. */
  previewsFor(t, messages, cx) {
    if (!t || !this.sentReady || messages === this.scanned) return;
    this.scanned = messages;
    for (const m of messages) for (const path of m.images ?? []) {
      if (!IMAGE_FILE.test(path)) continue; // a document is shown as its name, not fetched
      const name = previewName(path, t.machine);
      if (previewFile(this.sent, path, t.machine) || this.fetching.has(name)) continue;
      this.fetching.add(name);
      cx.spawn(async cx => { const file = await fetchSent(path, t.machine); if (file) { this.sent.add(file); cx.notify(); } });
    }
  }

  /** Drops the previews of terminals that are gone. */
  async pruneSent() {
    const r = await hc(["ls", "--all", "--json"]).catch(() => null);
    let listing = null;
    try { listing = r?.code === 0 ? JSON.parse(r.stdout) : null; } catch {}
    const stale = staleSent([...this.sent], listing);
    await dropSent(stale);
    for (const n of stale) this.sent.delete(n);
  }

  /** Preview copies left by a copy that closed before sending them: anything older than a day. */
  pruneCache() {
    pruneOld(attachDir(), keptImages().map(f => f.split(/[\\/]/).pop()), ["sent"]);
  }

  /** Dropped files: images get a preview copy (shrunk when big), documents are attached as they are; the rest is ignored. */
  dropFiles(paths, cx) {
    const images = paths.filter(p => IMAGE_FILE.test(p));
    const docs = paths.filter(p => DOC_FILE.test(p));
    if (!images.length && !docs.length) { this.host.note = "Only images and documents can be attached (png, jpg, gif, webp, pdf, md, txt, xlsx, xls, docx)."; cx.notify(); return; }
    const owner = this.host.key;
    cx.spawn(async cx => {
      for (const source of docs) this.attach(source, source.split(/[\\/]/).pop(), cx, owner, false);
      for (const source of images) {
        const label = source.split(/[\\/]/).pop(), name = attachName(source);
        const file = await this.prepare({
          unix: [modFile("prepare-image.sh"), source, attachDir(), name],
          windows: ["-Source", source, "-Folder", attachDir(), "-Name", name],
        }, label);
        if (file) this.attach(file, label, cx, owner);
        else cx.notify();
      }
    });
  }

  /** Ctrl+V with an image (and no text) on the clipboard: attached like a dropped file. */
  pasteImage(cx) {
    const owner = this.host.key;
    cx.spawn(async cx => {
      const name = attachName("pasted");
      const file = await this.prepare({
        unix: [modFile("prepare-image.sh"), "--clipboard", attachDir(), name],
        windows: ["-Clipboard", "-Folder", attachDir(), "-Name", name],
      }, "the pasted image");
      if (file) this.attach(file, "Pasted image", cx, owner);
      else cx.notify();
    });
  }

  attachmentStrip(t) {
    // An image shows its preview; a PDF (no preview copy) its file icon and extension.
    const ext = (name) => String(name).replace(/^.*\./, "").toUpperCase().slice(0, 4) || "FILE";
    return h_flex().w_full().flex_wrap().gap(8).pt(2).pb(4)
      .children(this.attachments.map((a, i) => div().id(`attachment-${i}`).relative().size(64).flex_none().rounded(10).overflow_hidden()
        .border_1().border_color(t.border).bg(t.raised)
        .tooltip(a.name)
        .when(a.rel, el => el.child(image(a.rel).size_full()))
        .when(!a.rel, el => el.child(v_flex().size_full().items_center().justify_center().gap(3)
          .child(icon("file-text", 16, t.muted))
          .child(div().text_size(9.5).text_color(t.muted).child(ext(a.name)))))
        .child(div().id(`attachment-remove-${i}`).absolute().top(3).right(3).size(18).flex().items_center().justify_center()
          .rounded(9).bg(t.background).border_1().border_color(t.border).text_color(t.muted).cursor_pointer()
          .hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.forget(this.attachments.splice(i, 1)); this.keepDraft(cx); cx.notify(); })
          .child(icon("close", 10, t.muted)))));
  }

  /** ↑ (dir -1) or ↓ (+1) in the reply box: the skill menu's selection while it's open. */
  lineKey(dir, cx) {
    if (this.menu.move(target(), dir, cx)) return;
    const { start, end } = caretOf(this.input);
    const from = dir < 0 ? start : end;
    const goal = this.lineGoal && this.lineGoal.at === from ? this.lineGoal.column : null;
    const { at, column } = lineMove(this.input.value(), from, dir, goal);
    this.input.set_selected_range({ start: at, end: at });
    this.lineGoal = { at, column };
  }

  /** Enter (without Shift): sends, and never leaves a new line in the box. */
  enter(cx) {
    this.enterAt = Date.now();
    const v = this.input.value(), s = v.replace(/\r?\n$/, "");
    if (s !== v) this.input.set_value(s);
    if (this.menu.accept(target(), cx)) return;
    this.send(cx);
  }

  send(cx) {
    const t = target(), typed = this.input.value().trim(), attached = this.attachments.slice();
    if (!t || (!typed && !attached.length) || this.host.sending) return;
    this.host.sending = true;
    this.hint = ""; this.hintToken++;
    this.input.set_value("");
    this.attachments = this.attachments.filter(a => !attached.includes(a));
    this.keepDraft(cx);
    cx.notify();
    const owner = this.host.key;
    if (typed && t.status !== "blocked" && !typed.startsWith("/")) this.host.showPending(owner, typed);
    const restore = () => {
      this.host.dropPending(owner, typed);
      if (this.host.key !== owner) {
        const d = this.drafts.get(owner) ?? { text: "", attachments: [] };
        this.drafts.set(owner, { text: d.text.trim() ? d.text : typed, attachments: [...attached, ...d.attachments] });
        storeDraft(owner, this.drafts.get(owner));
        return;
      }
      if (!this.input.value().trim()) this.input.set_value(typed);
      this.attachments = [...attached.filter(a => !this.attachments.includes(a)), ...this.attachments];
      storeDraft(owner, { text: this.input.value(), attachments: this.attachments });
    };
    cx.spawn(async cx => {
      try {
        if (t.status === "blocked" && !(await this.host.card.stillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        if (canMirror(t.harness) && t.status !== "blocked") {
          await this.mirrorChain;
          if (this.mirror?.session === sessionOf(t) && this.mirror.foreign)
            throw new Error(`${t.label}'s input box has an image pasted in the terminal. Send that draft from the terminal, or clear it there, first.`);
          if ((await inputBox("set", t, "[]")).ok) this.mirror = null;
        }
        const placed = await this.placeImages(t, attached);
        const thread = this.daemonThread(t, typed);
        if (thread) {
          const d = await askDaemon(t, { op: "send", thread, text: typed, images: placed });
          if (d.sent) { this.delivered(t, attached, placed, cx); return; }
          if (d.sent !== false) throw new Error(`Check whether ${t.label} got the message before sending it again (${d.error || "no answer"}).`);
        }
        if (imageStyle(t.harness) === "paste") {
          for (const path of placed) {
            const p = await inputBox("paste", t, path);
            if (!p.ok) throw new Error(`Couldn't paste the image into ${t.label}: ${p.error}`);
          }
          if (!typed) {
            const k = await pressKeys(t, ["enter"]);
            if (k.code !== 0) throw new Error(k.stderr || "Send failed");
            this.keepSent(attached, placed, t, cx);
            this.host.list.follow();
            return;
          }
        }
        const r = await sendMessage(t, withImages(t.harness, placed, typed), t.status === "blocked");
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        if (t.harness.skills?.enterTwice && skillToken(typed, [t.harness.skills.invoke[0]])) { await cx.sleep(400); await pressKeys(t, ["enter"]); }
        this.delivered(t, attached, placed, cx);
      } catch (e) { this.host.note = String(e); restore(); }
      finally { this.host.sending = false; cx.notify(); }
    });
  }

  /**
   * After a message reaches the agent: its box starts empty, its images are kept for the conversation, and the list
   * follows it.
   */
  delivered(t, attached, placed, cx) {
    this.mirror = { session: sessionOf(t), sig: "\u0000", images: [], paths: [], pasted: "", textBox: "", box: "", foreign: false };
    this.keepSent(attached, placed, t, cx);
    this.host.list.follow();
  }

  /** The conversation to send `typed` to through the agent's daemon, or "" to type it into the terminal. */
  daemonThread(t, typed) {
    return viaDaemon(t.harness, t.status, typed) && chatKey(t) === this.host.key ? t.harness.daemon.thread(this.host.sessionPath) : "";
  }

  /**
   * The reply box (attachments, the text, and the send or stop button at its bottom right) and the line under it
   * (`footer`: the model, effort, mode and context), so the box grows only with what's typed.
   */
  render(t, active, footer = null) {
    const ready = (Boolean(this.input.value().trim()) || this.attachments.length > 0) && !this.host.sending && Boolean(active);
    const stopping = active?.status === "working" && !this.input.value().trim() && !this.attachments.length;
    // An empty box shows the agent's suggested next prompt.
    const hint = this.blank() ? this.hint : "";
    const menu = this.menu.render(t, active);
    return v_flex().w_full().max_w(COLUMN).gap(6).relative()
      .when(Boolean(menu), el => el.child(menu))
      .child(h_flex().id("composer-box").w_full().pl(16).pr(8).py(8).gap(8).items_end().rounded(18).border_1().border_color(this.focused ? t.accent : t.input)
        .bg(this.host.backdropShown ? `${t.surface.slice(0, 7)}a6` : t.surface)
        .child(v_flex().flex_1().min_w(0)
          .when(this.attachments.length > 0, el => el.child(this.attachmentStrip(t)))
          // The agent's suggested next prompt: the dim line its own input box shows (a textarea draws over anything
          // laid on it, so the suggestion sits above the box, where the text starts).
          .when(Boolean(hint), el => el.child(div().id("composer-hint").w_full().pb(2).truncate().cursor_pointer()
            .text_size(12.5).text_color(t.dim).tooltip("Click to use this suggestion")
            .hover(s => s.text_color(t.muted))
            .on_click((_e, cx) => this.useHint(cx))
            .child(hint)))
          .child(div().id("composer-input").w_full().min_w(0).py(4).relative().key_context("HerdrChatReply")
          .on_action("herdr_chat::LineUp", (_e, cx) => this.lineKey(-1, cx))
          .on_action("herdr_chat::LineDown", (_e, cx) => this.lineKey(1, cx))
          // Chords keys.json gives the app (the leader's ctrl-a, alt-shift-up/down): run its binding, not the box's own.
          .when(true, el => passKeys().reduce((acc, k) => acc.on_action(passAction(k), () => passKey(k)), el))
          .on_action("herdr_chat::Stop", (_e, cx) => { if (!this.menu.dismiss(target(), cx)) this.host.stop(cx); })
          .on_key_down((e, cx) => {
            // ctrl+x then ctrl+s, as in the agent's own terminal: its queued prompts go in now. Armed only while
            // something is queued, so ctrl+x keeps its usual meaning otherwise.
            const ctrlOnly = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
            if (ctrlOnly && e.key === "x" && this.canSendQueued()) { cx.stop_propagation(); this.chordAt = Date.now(); return; }
            if (this.chordAt && Date.now() - this.chordAt < 1500 && ctrlOnly && e.key === "s") {
              cx.stop_propagation(); this.chordAt = 0; this.sendQueued(cx); return;
            }
            this.chordAt = 0;
            const paste = e.key === "v" && (e.modifiers.control || e.modifiers.platform) && !e.modifiers.alt;
            if (paste && cx.read_from_clipboard() === undefined) { cx.stop_propagation(); this.imagePasteAt = Date.now(); this.pasteImage(cx); return; }
            if (e.key === "tab" && !e.modifiers.shift && this.menu.accept(target(), cx)) { cx.stop_propagation(); return; }
            if (e.key !== "enter" || e.modifiers.shift || e.modifiers.alt) return;
            cx.stop_propagation();
            this.enter(cx);
          })
          .child(Textarea.new(this.input).w_full().text_size(15).text_color(t.foreground))))
        .child(stopping
          ? div().id("stop").size(32).flex_none().flex().items_center().justify_center().rounded(16)
            .bg(t.foreground).text_color(t.background).tooltip("Stop (Esc)")
            .when(!this.host.stopping, el => el.cursor_pointer().hover(s => s.opacity(0.85)).on_click((_e, cx) => this.host.stop(cx)))
            .child(svg(`${ICONS}/stop-filled.svg`).size(14))
          : div().id("send").size(32).flex_none().flex().items_center().justify_center().rounded(16)
            .bg(ready ? t.accent : t.raised).text_color(ready ? t.accent_foreground : t.dim)
            .when(ready, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => this.send(cx)))
            .child(svg(`${ICONS}/arrow-up.svg`).size(16))))
      .child(footer ?? h_flex().w_full().h(24).px(4).items_center().justify_center().text_size(11.5).text_color(t.dim)
        .child(active ? `Sends to the live ${active.label} terminal · drop or paste an image to attach it` : ""));
  }
}
