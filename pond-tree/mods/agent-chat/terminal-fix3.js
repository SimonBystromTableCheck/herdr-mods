import { hc, exec, appHome, focused, agents, terminals, panes, spaces } from "herdr";
import { onWindows, modFile, base64Utf8 } from "./platform.js";
import { harnessFor } from "./harnesses/index.js";

// Claude Code's own harness, used when the app's module cache hands the chat an empty one.
const CLAUDE_FALLBACK = {
  id: "claude-code", label: "Claude Code", images: "mention", mirror: true, prompt: {},
  modes: { default: "Ask before edits", acceptEdits: "Accept edits", plan: "Plan mode", auto: "Auto mode", bypassPermissions: "Bypass permissions", dontAsk: "Don't ask" },
  models: [], efforts: ["low", "medium", "high", "xhigh", "max"],
  switching: { model: "/model {model}", effort: "/effort {effort}", nextMode: ["shift+tab"] },
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};

function usableHarness(app) {
  const h = harnessFor(app);
  if (h?.switching) return h;
  return app === "claude-code" ? CLAUDE_FALLBACK : h;
}

/**
 * The app's agents. Right after a restart its live list can be empty until the agent's status
 * report arrives; the core's terminals still say which ones are agents, so build those from the
 * terminals and their panes (their labels carry the space and tab).
 */
function agentList() {
  const ps = panes() ?? [];
  const spaceOf = (tab) => spaces().find(s => (s.tabs ?? []).some(t => t.id === tab))?.id ?? null;
  // Fill in a space/tab the app's live entry lost (or never had) from the pane.
  const out = agents().map(a => {
    const p = ps.find(x => x.terminal === a.address);
    const tab = a.tab ?? p?.tab ?? null, space = a.space ?? spaceOf(tab);
    return { ...a, space, tab, space_name: a.space_name ?? spaces().find(s => s.id === space)?.name ?? null };
  });
  const seen = new Set(out.map(a => a.address));
  // The app's live agent list can be empty right after a restart; the panes still name the agents.
  for (const p of ps) {
    if (!p.terminal || !p.program?.agent || seen.has(p.terminal)) continue;
    const space = spaceOf(p.tab);
    const app = p.program?.key === "claude" ? "claude-code" : (p.app ?? p.program?.key ?? null);
    out.push({
      address: p.terminal, pane: p.pane, app, program: p.program, space, tab: p.tab,
      space_name: spaces().find(s => s.id === space)?.name ?? null,
      status: p.status ?? "idle", title: p.title, pinned: false, focused: p.focused,
      machine: p.terminal.includes("/") ? p.terminal.split("/")[0] : null,
    });
  }
  return out;
}

/** The agent the chat shows: the focused tab's agent, the focused one when there are several. */
export function target() {
  const f = focused();
  if (!f) return null;
  const mine = agentList().filter(x => x.tab === f.tab && x.space === f.space && usableHarness(x.app));
  const a = mine.find(x => x.address === f.terminal) ?? mine[0];
  return a ? agentTarget(a, terminals()) : null;
}

/** Every agent the chat can show, as target() describes one (the background keeps them read). */
export function agentTargets() {
  const terms = terminals();
  return agentList().filter(x => usableHarness(x.app)).map(a => agentTarget(a, terms));
}

function agentTarget(a, terms) {
  const term = terms.find(x => x.address === a.address), harness = usableHarness(a.app);
  return {
    address: a.address, pane: a.pane, app: a.app, harness, label: harness?.label, program: a.program, space_name: a.space_name,
    status: a.status, title: a.title, remote: a.address.includes("/"),
    machine: a.address.includes("/") ? a.address.split("/")[0] : null,
    pid: term?.pid ?? 0, created: term?.created_ms ?? 0, cwd: term?.cwd ?? "",
    activity: term?.report?.msg ?? term?.status?.msg ?? "",
    kind: term?.report?.kind ?? term?.status?.kind ?? "",
    turn: term?.turn ?? null, statusMs: term?.status_ms ?? null,
  };
}

/** The screen plus `lines` of history, or null when it can't be read. */
export async function readScreen(t, lines) {
  const r = await hc(["read", t.address, "--lines", String(lines)]);
  return r.code === 0 ? r.stdout : null;
}

/** The screen's end as prompts are judged on (what the question card and its checks compare). */
export async function readPrompt(t) {
  const screen = await readScreen(t, 26);
  return screen == null ? null : screen.trim().slice(-4000);
}

/** Types `text` into the agent and presses Enter, as the person. */
export function sendMessage(t, text, force) {
  const forced = force ? ["--force"] : [];
  if (t.remote) return exec("sh", ["-c", 'h=$(command -v hc || echo "$HOME/.local/bin/hc"); exec env -u HC_TERMINAL_ID -u HC_SCOPE "$h" send "$@"',
    "hc-send", ...forced, t.address.slice(t.address.indexOf("/") + 1), text], { on: t.machine });
  if (onWindows()) return exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    `${appHome()}\\mods\\agent-chat\\send.ps1`, "-Address", t.address, "-Text64", base64Utf8(text), ...(force ? ["-Force"] : [])]);
  return exec("env", ["-u", "HC_TERMINAL_ID", "-u", "HC_SCOPE", "hc", "send", ...forced, t.address, text]);
}

/** Presses the agent's stop key (Esc for an agent, Ctrl+C otherwise) and reports what happened. */
export async function interruptAgent(t) {
  const r = await hc(["interrupt", "--json", "--timeout", "5", t.address]);
  try { return JSON.parse(r.stdout); } catch { return { outcome: r.code === 0 ? "unknown" : "failed", error: (r.stderr || "").trim() }; }
}

/** Presses named keys in the terminal (up, down, enter, esc, …). */
export function pressKeys(t, keys) {
  return hc(["keys", t.address, ...keys]);
}

/**
 * input-box.py: `read`, `set` (a JSON list of pastes) or `paste` on the agent's own input box, or `step` for a prompt's
 * current step.
 */
export async function inputBox(command, t, ...args) {
  const shape = command === "read" || command === "set" ? [JSON.stringify(t.harness.box)] : [];
  const r = await exec("python3", ["-I", modFile("input-box.py"), command, t.address, ...shape, ...args]).catch(e => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) return { ok: false, box: null, error: (r.stderr || r.stdout || `input-box.py ${command} failed`).trim() };
  let box = null;
  try { box = r.stdout.trim() ? JSON.parse(r.stdout).box ?? null : null; } catch {}
  return { ok: true, box, error: "" };
}

/** The dim hint in the agent's own input box (Claude Code's suggested next prompt), or "" when there is none. */
export async function inputHint(t) {
  const r = await exec("python3", ["-I", modFile("input-box.py"), "hint", t.address, JSON.stringify(t.harness.box)]).catch(() => null);
  if (!r || r.code !== 0) return "";
  try { return String(JSON.parse(r.stdout).hint ?? ""); } catch { return ""; }
}
