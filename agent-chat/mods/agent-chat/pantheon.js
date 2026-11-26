// Pond: for a Claude Code agent started on a gateway profile (its terminal's herdr.claude-profile label, set by
// pond-profiles' hook), the model menu, each model's efforts and its context window come from that gateway's
// catalog (pond-profiles' `ctl.py models <profile>`, which keeps the gateway token to itself), instead of the
// Claude adapter's fixed list. Agents on other machines, or on a profile without a gateway, keep the fixed list.
import { exec, appHome, terminals, shared, setShared, home, readTextFile } from "herdr";

const KEY = "pond.gateway.models.v2";       // { [profile]: { at, models: [{ id, name, context, efforts, lifecycle }], error? } }
const FRESH = 10 * 60 * 1000;               // a catalog is asked again after 10 minutes
const AFTER_ERROR = 10 * 60 * 1000;         // and after a failure (a profile with no gateway fails every time)
const asking = new Set();

// The profile new sessions use (cvp's global pick), read once: a terminal's own label can lag or be
// missing from the app's list, and then this is the profile its Claude Code was most likely started on.
let activeProfile = null;

export async function loadActiveProfile() {
  const p = (await readTextFile(`${home()}/.cvm/active-profile`).catch(() => null))?.trim() || null;
  const changed = p !== activeProfile;
  activeProfile = p;
  return changed;
}

/** The gateway profile this terminal was started on, or null (another machine, or no profile). */
export function profileOf(address) {
  if (!address || address.includes("/")) return null;
  return terminals().find(x => x.address === address)?.labels?.["herdr.claude-profile"] || activeProfile;
}

export function catalog(profile) {
  return profile ? (shared(KEY) ?? {})[profile] ?? null : null;
}

/** Asks for the profile's catalog when it's due. From a timer or a handler only (it sets shared state). */
export function refreshCatalog(profile) {
  if (!profile || asking.has(profile)) return;
  const was = catalog(profile);
  if (was && Date.now() - was.at < (was.error ? AFTER_ERROR : FRESH)) return;
  asking.add(profile);
  const keep = (entry) => setShared(KEY, { ...(shared(KEY) ?? {}), [profile]: { at: Date.now(), ...entry } });
  exec("python3", [`${appHome()}/mods/pond-profiles/ctl.py`, "models", profile], { timeout: 30000 })
    .then(r => {
      let d = null;
      try { d = JSON.parse(r.stdout); } catch { /* not JSON */ }
      if (d?.ok && Array.isArray(d.models)) keep({ models: d.models });
      else keep({ models: was?.models ?? [], error: d?.error || (r.stderr || "").trim() || `exit ${r.code}` });
    })
    .catch(e => keep({ models: was?.models ?? [], error: String(e?.message ?? e) }))
    .finally(() => asking.delete(profile));
}

const shortName = (name, id) => String(name || id).replace(/^Claude\s+/, "");

/**
 * A model id as people read it when no catalog names it: "anthropic/acme-1-code-task" → "Acme 1 Code Task",
 * "claude-opus-5-5" → "Opus 5.5".
 */
export function prettyModel(id) {
  const raw = String(id ?? "").split("/").pop().replace(/\[[^\]]*\]/g, "");
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(raw);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  return raw.split(/[-_]/).filter(Boolean).map(w => (/^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** The terminal labels pond-profiles' status line hook keeps: { model, percent } (either may be null). */
export function labelsOf(address) {
  const l = terminals().find(x => x.address === address)?.labels ?? {};
  const pct = Number.parseInt(l["claude.context"], 10);
  return { model: l["claude.model"] || null, percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null };
}
const profileName = (p) => p ? p[0].toUpperCase() + p.slice(1) : "";

/**
 * The harness as runsWith reads it, with the gateway's models when this agent runs on one: each with its own efforts
 * (none: no effort menu) and context window. `gateway` names the profile, for the chip's tooltip.
 */
// The shortcuts at the top of Claude Code's /model menu, so the chat's list reads like the terminal's.
const ALIASES = [
  { id: "default", name: "Default (recommended)", switchTo: "default" },
  { id: "opus", name: "Opus", switchTo: "opus" },
  { id: "sonnet", name: "Sonnet", switchTo: "sonnet" },
  { id: "haiku", name: "Haiku", switchTo: "haiku" },
];

// Claude Code's own list, used when the harness object the app hands the chat has lost its arrays
// (a stale cached module): the chat still gets models and an effort menu.
const CLAUDE_BASE = [
  { id: "claude-opus-5-5", alias: "opus", name: "Opus 5.5", window: 1000000 },
  { id: "claude-sonnet-5-5", alias: "sonnet", name: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", alias: "haiku", name: "Haiku 5.5" },
  { id: "claude-fable-5-2", alias: "fable", name: "Fable 5.2" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function withCatalog(harness, address) {
  if (harness?.id !== "claude-code") return harness;
  const profile = profileOf(address), c = catalog(profile);
  const base = harness.models?.length ? harness.models : CLAUDE_BASE;
  // The gateway names the effort levels it supports; for a model only Claude Code's cache lists
  // (the router's), it doesn't say, so use the harness's own levels rather than none.
  const fallback = harness.efforts?.length ? harness.efforts : CLAUDE_EFFORTS;
  if (!c?.models?.length) return { ...harness, models: base, efforts: fallback };
  const models = [
    ...ALIASES,
    ...c.models.filter(m => m.lifecycle !== "retired").map(m => ({
      id: m.id, name: shortName(m.name, m.id) + (m.lifecycle === "deprecated" ? " (deprecated)" : ""),
      // /model takes the base id: the gateway's [1m] suffix is a menu/context marker, not part of it.
      alias: String(m.id).replace(/\[[^\]]*\]$/, ""), window: m.context ?? undefined,
      efforts: Array.isArray(m.efforts) ? m.efforts : fallback,
    })),
  ];
  return { ...harness, models, efforts: undefined, gateway: profileName(profile) };
}
