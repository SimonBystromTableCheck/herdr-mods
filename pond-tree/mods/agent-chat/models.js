// The models a Claude Code agent's /model offers, read live when the chat's model menu opens —
// never from a kept copy. Which source depends on the agent's profile (~/.cvm/profiles):
//
//  - a gateway profile (its env sets ANTHROPIC_BASE_URL, e.g. Pantheon): that gateway's
//    GET /v1/models, through pond-profiles' ctl.py, which holds the profile's token;
//  - a normal profile (Personal: Anthropic's own endpoints, your claude.ai login):
//    `claude -p "/model"`, whose answer lists the aliases /model accepts.
//
// The answer is kept in memory for KEEP ms so reopening the menu doesn't ask again; nothing is
// written to shared state.

import { appHome, exec, home, readTextFile } from "herdr";
import { onWindows } from "./platform.js";

const KEEP = 15 * 1000;
const lists = new Map(); // key → { at, profile, list, current, source, error }
const inflight = new Map();

// The names Claude Code's picker gives the aliases it prints as ids.
const NAMES = {
  default: "Default (recommended)", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku",
  fable: "Fable", best: "Best", opusplan: "Opus Plan",
};

/** An alias as the picker names it: "sonnet[1m]" → "Sonnet (1M)", "opus" → "Opus". */
function aliasName(id) {
  const m = /^([a-z]+)\[(\d+m)\]$/i.exec(id);
  if (m) return `${NAMES[m[1].toLowerCase()] ?? m[1]} (${m[2].toUpperCase()})`;
  return NAMES[String(id).toLowerCase()] ?? String(id);
}

const keyOf = (app, address, profile) => `${app ?? "claude-code"}@${address ?? ""}@${profile ?? ""}`;

/** The list read for this agent (and profile) since the menu last opened, or null. */
export function modelList(address, app = "claude-code", profile = null) {
  const e = lists.get(keyOf(app, address, profile));
  return e?.list?.length ? e : null;
}

/** `claude -p "/model"`'s answer: the aliases it lists, and the model it says is current. */
export function parseModelAnswer(stdout) {
  const text = String(stdout ?? "");
  const line = text.split("\n").find((l) => /Available:/i.test(l)) ?? "";
  const list = line
    .replace(/^.*?Available:\s*/i, "")
    .split(",")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s && !/^or a full model ID$/i.test(s))
    .map((id) => ({ id, name: aliasName(id) }));
  const current = /Current model:\s*`?([^`\n]+?)`?\s*$/im.exec(text)?.[1]?.trim() ?? null;
  return { list, current };
}

/** Whether the profile starts Claude Code on a gateway (its env sets ANTHROPIC_BASE_URL). */
async function isGateway(profile) {
  if (!profile) return false;
  const text = await readTextFile(`${home()}/.cvm/profiles/${profile}.env`).catch(() => null);
  return text !== null && /^\s*ANTHROPIC_BASE_URL\s*=\s*\S/m.test(text);
}

/** The gateway's own list: pond-profiles' ctl.py asks it (GET /v1/models) with the profile's token. */
async function fromGateway(profile) {
  const source = `the ${profile} gateway`;
  const r = await exec("python3", [`${appHome()}/mods/pond-profiles/ctl.py`, "models", profile], { timeout: 20000 })
    .catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let d = null;
  try { d = JSON.parse(r.stdout); } catch { /* not JSON */ }
  if (d?.ok && Array.isArray(d.models)) {
    return {
      source,
      error: null,
      current: null,
      list: d.models.map((m) => ({ id: String(m.id), name: String(m.name || m.id), window: m.context ?? undefined })),
    };
  }
  return { source, error: (d?.error || r.stderr || "").trim() || `exit ${r.code}`, current: null, list: [] };
}

/** Claude Code's own answer, in the agent's profile environment (the gateway's variables are left out). */
async function fromCli(t) {
  // `env -u` leaves the gateway's variables out, so a normal profile answers with its own endpoints.
  const [cmd, args] = onWindows()
    ? ["claude", ["-p", "/model"]]
    : ["env", ["-u", "ANTHROPIC_BASE_URL", "-u", "ANTHROPIC_AUTH_TOKEN", "claude", "-p", "/model"]];
  const r = await exec(cmd, args, { cwd: t.cwd || home(), on: t.machine ?? undefined, timeout: 25000 })
    .catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  const { list, current } = parseModelAnswer(r?.stdout ?? "");
  return { source: "Claude Code", error: list.length ? null : (r?.stderr || "").trim() || `exit ${r?.code ?? "?"}`, current, list };
}

/**
 * Reads the agent's model list for its profile: the gateway's, or Claude Code's. An answer from
 * KEEP ms ago is reused, and one read is shared by every caller waiting on it.
 */
export async function fetchModels(t, profile) {
  const app = t?.harness?.id ?? "claude-code";
  const key = keyOf(app, t?.address, profile);
  const hit = lists.get(key);
  if (hit && Date.now() - hit.at < KEEP) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const read = (async () => {
    const gateway = await isGateway(profile).catch(() => false);
    const res = gateway ? await fromGateway(profile) : await fromCli(t);
    const entry = { at: Date.now(), profile, ...res };
    lists.set(key, entry);
    return entry;
  })().finally(() => inflight.delete(key));
  inflight.set(key, read);
  return read;
}
