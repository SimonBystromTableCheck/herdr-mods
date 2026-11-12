// The setup wizard (cvm → PATH → Claude → cvp, then optional profiles and agent router) and the
// panel's forms: add a profile, rename one, set up a profile's usage. Each function takes the
// panel (`v`) for its state, ctl() and its small drawing helpers.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, notify, writeTextFile } from "herdr";

const base = p => p ? p.split("/").pop() : "";

// Claude Code switches a profile can turn on.
export const FLAGS = [
  { key: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", label: "Agent teams", on: true },
  { key: "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", label: "Gateway models in /model", on: true, gateway: true },
  { key: "CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL", label: "Advisor tool", on: false },
  { key: "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", label: "Function hooks (agent router)", router: true },
];

// A secret (a key) goes to ctl in a hidden file it deletes, never on a command line.
async function handOff(v, data) {
  const path = `${appHome()}/mods/pond-profiles/.handoff-${Math.random().toString(36).slice(2)}`;
  await writeTextFile(path, typeof data === "string" ? data : JSON.stringify(data), null);
  return path;
}

const field = (t, label, input, hint) => v_flex().gap(3)
  .child(div().text_size(11.5).text_color(t.dim).child(label))
  .child(Input.new(input).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12))
  .when(Boolean(hint), el => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));

// ---- Setup wizard -----------------------------------------------------------------

export function loadDoctor(v, cx) {
  v.doctorBusy = true; cx.notify();
  cx.spawn(async cx => {
    v.doctor = await v.ctl(["doctor"], 40000);
    v.doctorBusy = false;
    cx.notify();
  });
}

function step(v, cx, id, args, label, then) {
  v.act(`setup-${id}`, label, ["setup", ...args], cx, { then: (r, cx) => { then?.(r, cx); loadDoctor(v, cx); } });
}

export function setupView(v, t) {
  const d = v.doctor, st = v.st;
  const rcName = d?.rc ? `~/${d.rc.split("/").slice(3).join("/")}` : "your shell profile";
  const steps = [
    { id: "cvm", title: "Claude version manager (cvm)", done: d?.cvm,
      text: "Installs Claude Code versions side by side and switches between them. Downloads cvm from github.com/alexandernicholson/cvm into ~/.cvm.",
      action: ["Install cvm", ["cvm"], "Installing…"] },
    { id: "path", title: "Run cvm's claude", done: d?.path?.ok, needs: d?.cvm,
      text: d?.path?.ok
        ? `New terminals put ~/.cvm/bin first (checked in a fresh shell that loads ${rcName}).`
        : `Adds ~/.cvm/bin at the end of ${rcName} so new terminals start cvm's claude. ${d?.path?.claude ? `Right now: ${d.path.claude}` : "No claude found yet."}`,
      after: `Terminals already open keep their old PATH: run  source ${rcName}  in them, or open a new tab.`,
      action: [`Add to ${base(d?.rc) || "profile"}`, ["path"], "Saving…"] },
    { id: "claude", title: "Claude Code", done: d?.claude?.ok, needs: d?.cvm,
      text: "Installs the latest Claude Code with cvm. An existing install stays where it is; Claude's own auto-updater is turned off since cvm manages versions now.",
      action: ["Install latest", ["claude"], "Installing…"] },
    { id: "cvp", title: "Profiles (cvp)", done: d?.cvp, needs: d?.cvm,
      text: "A cvm plugin for named accounts: your claude.ai login and any gateways. It starts with a \"default\" profile that uses your claude.ai login.",
      action: ["Install cvp", ["cvp"], "Installing…"] },
  ];
  const optional = [];
  const gateways = (d?.profiles ?? []).filter(p => p.gateway);
  optional.push({ id: "profiles", title: "Gateway profiles (optional)", done: gateways.length > 0, needs: d?.cvp,
    text: gateways.length ? `${gateways.map(p => p.label).join(", ")} set up. Add more any time from Account.` : "Add a profile for each Anthropic-compatible gateway you use: its URL, key and switches.",
    button: v.form?.type === "profile" ? null : v.button("setup-add-profile", "Add a profile", null, cx => openProfileForm(v, cx), t, { disabled: !d?.cvp }),
    form: v.form?.type === "profile" ? profileForm(v, t) : null });
  const r = d?.router;
  optional.push({ id: "router", title: "Agent router + keepalive (optional)", done: r?.installed, skipped: d?.setup?.routerSkipped, needs: d?.claude?.ok,
    text: `Claude Code plugins: a model and effort per subagent role from a gateway's catalog, and a prompt-cache bar that can keep the cache warm. Need Node 22+${r ? ` (found ${r.node ?? "none"})` : ""} and git.`,
    warn: r && !r.installed && (!r.nodeOk || !r.git) ? (!r.nodeOk ? "Install Node 22 or newer first." : "Install git first.") : null,
    action: ["Install", ["router"], "Installing…"], skip: true });

  const row = (s, i) => {
    const icon = s.done ? div().size(18).flex_none().flex().items_center().justify_center().rounded_full().bg(t.ansi2).text_color(t.background).text_size(11).child("✓")
      : s.skipped ? div().size(18).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(t.border).text_color(t.dim).text_size(10).child("–")
      : div().size(18).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(s.needs === false ? t.border : t.accent).text_size(10.5).text_color(t.muted).child(String(i));
    const busy = v.busy[`setup-${s.id}`];
    return v_flex().id(`step-${s.id}`).gap(6).p(10).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().gap(8).items_center().child(icon).child(div().flex_1().font_semibold().text_color(s.done ? t.muted : t.foreground).child(s.title)))
      .child(div().pl(26).text_size(11.5).text_color(t.dim).child(s.text))
      .when(Boolean(s.done && s.after), el => el.child(div().pl(26).text_size(11.5).text_color(t.ansi3).child(s.after)))
      .when(Boolean(s.warn), el => el.child(div().pl(26).text_size(11.5).text_color(t.ansi3).child(s.warn)))
      .when(Boolean(s.form), el => el.child(div().pl(26).child(s.form)))
      .when(!s.done && (Boolean(s.action) || Boolean(s.button)), el => el.child(h_flex().pl(26).gap(8)
        .when(Boolean(s.action), el => el.child(v.button(`do-${s.id}`, s.action[0], "primary", cx => step(v, cx, s.id, s.action[1], s.action[2]), t,
          { busy, disabled: s.needs === false || Boolean(s.warn) })))
        .when(Boolean(s.button), el => el.child(s.button))
        .when(Boolean(s.skip) && !s.skipped, el => el.child(v.button(`skip-${s.id}`, "Skip", null, cx => step(v, cx, `skip-${s.id}`, ["skip-router"], "…"), t)))))
      .children(v.errorOf(`setup-${s.id}`, t).map(e => e.pl(26)));
  };
  const basics = steps.every(s => s.done);
  return v_flex().gap(8)
    .child(v_flex().gap(3).p(4)
      .child(div().text_size(15).font_semibold().child("Set up Claude for Herdr"))
      .child(div().text_size(11.5).text_color(t.dim).child("This panel switches Claude accounts and versions with cvm and cvp. The steps install them for you; nothing leaves this machine.")))
    .children(steps.map((s, i) => row(s, i + 1)))
    .child(div().pt(4).text_size(11).font_medium().text_color(t.dim).child("OPTIONAL"))
    .children(optional.map((s, i) => row(s, steps.length + i + 1)))
    .child(h_flex().gap(8).pt(4).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.dim).child(!d ? "Checking this machine…" : basics ? "Ready. You can come back here from ⚙ in the header." : "Finish the first steps to use the panel."))
      .child(v.button("setup-recheck", "Check again", null, cx => loadDoctor(v, cx), t, { busy: v.doctorBusy ? "Checking…" : null }))
      .child(v.button("setup-finish", st?.setup?.done ? "Back to the panel" : "Finish", "primary", cx => {
        v.act("setup-finish", "…", ["setup", "done"], cx, { then: (_r, cx) => { v.setupShown = false; v.form = null; v.loadRouter(cx); v.loadUsage(cx); } });
      }, t, { disabled: !basics })));
}

// ---- Add a profile ------------------------------------------------------------------

export function openProfileForm(v, cx) {
  const routerOn = Boolean(v.st?.plugins?.["agent-router"]?.version);
  const f = {
    type: "profile",
    name: InputState.new({ placeholder: "work-gateway" }),
    label: InputState.new({ placeholder: "Work" }),
    base: InputState.new({ placeholder: "https://gateway.example.com/claude (empty: claude.ai login)" }),
    key: InputState.new({ placeholder: "The gateway's key" }),
    vars: InputState.new({ placeholder: "MORE_VARS=1 OTHER=value" }),
    keyVar: "ANTHROPIC_AUTH_TOKEN",
    flags: new Set(FLAGS.filter(x => x.on || (x.router && routerOn)).map(x => x.key)),
    error: null,
  };
  f.key.set_masked(true);
  v.form = f;
  f.name.focus();
  cx.notify();
}

export function profileForm(v, t) {
  const f = v.form, gateway = Boolean(f.base.value().trim());
  return v_flex().id("profile-form").gap(8).p(10).rounded(8).border_1().border_color(t.accent).bg(t.surface)
    .child(div().font_semibold().child("New profile"))
    .child(h_flex().gap(8).child(div().flex_1().child(field(t, "Name (cvp)", f.name))).child(div().flex_1().child(field(t, "Shown as", f.label))))
    .child(field(t, "Gateway URL", f.base, "Leave empty for a profile on your claude.ai login."))
    .when(gateway, el => el
      .child(field(t, "Key", f.key))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(div().text_size(11.5).text_color(t.dim).child("Sent as"))
        .child(v.chip("kv-bearer", "Bearer token", f.keyVar === "ANTHROPIC_AUTH_TOKEN", cx => { f.keyVar = "ANTHROPIC_AUTH_TOKEN"; cx.notify(); }, t))
        .child(v.chip("kv-api", "x-api-key", f.keyVar === "ANTHROPIC_API_KEY", cx => { f.keyVar = "ANTHROPIC_API_KEY"; cx.notify(); }, t)))
      .child(div().text_size(10.5).text_color(t.dim).child(f.keyVar === "ANTHROPIC_AUTH_TOKEN"
        ? "Sent as ANTHROPIC_AUTH_TOKEN (Authorization: Bearer)."
        : "Sent as ANTHROPIC_API_KEY. Claude warns on every start while you're also signed in to claude.ai.")))
    .child(v_flex().gap(4)
      .child(div().text_size(11.5).text_color(t.dim).child("Switches"))
      .child(h_flex().gap(6).flex_wrap().children(FLAGS.filter(x => gateway || !x.gateway).map(x =>
        v.chip(`flag-${x.key}`, x.label, f.flags.has(x.key), cx => { f.flags.has(x.key) ? f.flags.delete(x.key) : f.flags.add(x.key); cx.notify(); }, t)))))
    .child(field(t, "More variables", f.vars, "Optional KEY=value pairs, separated by spaces."))
    .when(Boolean(f.error), el => el.child(div().text_size(11.5).text_color(t.ansi1).child(f.error)))
    .child(h_flex().gap(8).justify_end()
      .child(v.button("profile-cancel", "Cancel", null, cx => { v.form = null; v.handle.focus(); cx.notify(); }, t))
      .child(v.button("profile-save", "Save profile", "primary", cx => saveProfile(v, cx), t, { busy: v.busy.profileAdd })));
}

function saveProfile(v, cx) {
  const f = v.form;
  const vars = {};
  for (const k of f.flags) vars[k] = "1";
  for (const pair of f.vars.value().trim().split(/\s+/).filter(Boolean)) {
    const m = pair.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) { f.error = `"${pair}" isn't KEY=value`; cx.notify(); return; }
    vars[m[1]] = m[2];
  }
  const spec = { name: f.name.value().trim(), label: f.label.value().trim(), base: f.base.value().trim(),
    key: f.key.value().trim(), keyVar: f.keyVar, vars };
  if (!spec.base) { for (const x of FLAGS.filter(x => x.gateway)) delete vars[x.key]; }
  v.busy.profileAdd = "Saving…"; f.error = null; cx.notify();
  cx.spawn(async cx => {
    let r;
    try { r = await v.ctl(["profile-add", await handOff(v, spec)]); } catch (e) { r = { ok: false, error: String(e) }; }
    delete v.busy.profileAdd;
    if (!r.ok) { f.error = r.error; cx.notify(); return; }
    v.form = null; v.handle.focus();
    notify({ title: `Profile ${spec.label || spec.name} saved`, level: "success", timeout: 3000 });
    v.refresh(cx);
    if (v.setupShown) loadDoctor(v, cx);
    if (spec.base) { // check the URL and key work
      const m = await v.ctl(["models", spec.name]);
      notify(m.ok ? { title: `${spec.label || spec.name}: connected`, body: `${m.models.length} models available`, level: "success", timeout: 4000 }
        : { title: `${spec.label || spec.name}: can't reach the gateway`, body: m.error, level: "error" });
    }
    cx.notify();
  });
}

// ---- Rename -----------------------------------------------------------------------

export function openLabelForm(v, p, cx) {
  const input = InputState.new({ value: p.label, placeholder: p.name });
  input.on("submit", (_e, cx) => saveLabel(v, cx));
  v.form = { type: "label", profile: p.name, input };
  input.focus();
  cx.notify();
}

export function labelForm(v, t) {
  return h_flex().gap(6).items_center()
    .child(Input.new(v.form.input).flex_1().h(28).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12))
    .child(v.button("label-save", "Save", "primary", cx => saveLabel(v, cx), t))
    .child(v.button("label-cancel", "Cancel", null, cx => { v.form = null; v.handle.focus(); cx.notify(); }, t));
}

function saveLabel(v, cx) {
  const f = v.form;
  v.form = null; v.handle.focus();
  v.act("label", "Saving…", ["profile-label", f.profile, f.input.value().trim()], cx);
}

// ---- Usage setup ------------------------------------------------------------------

export function openUsageForm(v, p, cx) {
  const f = { type: "usage", profile: p.name, gateway: Boolean(p.gateway), loading: true, error: null };
  v.form = f; cx.notify();
  cx.spawn(async cx => {
    const r = await v.ctl(["usage-detect", p.name], 30000);
    if (v.form !== f) return;
    f.loading = false;
    if (!r.ok) { f.error = r.error; cx.notify(); return; }
    const s = r.suggest;
    f.found = r.apiDescription; f.login = r.login;
    if (s.kind === "gateway") {
      f.url = InputState.new({ value: s.url, placeholder: "https://gateway.example.com/me/usage" });
      f.budgetUrl = InputState.new({ value: s.budgetUrl, placeholder: "Optional: a budget or spend endpoint" });
      f.device = InputState.new({ value: s.device, placeholder: "https://gateway.example.com/oauth/device" });
      f.auth = s.auth;
    }
    cx.notify();
  });
}

export function usageForm(v, t) {
  const f = v.form;
  const shell = v_flex().id("usage-form").gap(8).p(10).rounded(8).border_1().border_color(t.accent).bg(t.surface);
  const buttons = save => h_flex().gap(8).justify_end()
    .child(v.button("usage-cancel", "Cancel", null, cx => { v.form = null; v.handle.focus(); cx.notify(); }, t))
    .child(v.button("usage-save", f.gateway ? "Save" : "Turn on", "primary", save, t, { busy: v.busy.usageSetup, disabled: f.loading }));
  if (f.loading) return shell.child(div().text_size(11.5).text_color(t.dim).child(f.gateway ? "Looking for the gateway's usage API…" : "Checking the claude.ai login…"));
  if (f.error && !f.url) return shell.child(div().text_size(11.5).text_color(t.ansi1).child(f.error)).child(buttons(() => {}));
  if (!f.gateway) {
    return shell
      .child(div().text_size(11.5).text_color(t.foreground).child("Shows this account's claude.ai plan limits (session and weekly), read with the Claude login on this machine."))
      .when(!f.login, el => el.child(div().text_size(11.5).text_color(t.ansi3).child("No claude.ai login found yet: run claude and /login first.")))
      .child(buttons(cx => saveUsage(v, { kind: "plan" }, cx)));
  }
  return shell
    .child(div().text_size(11.5).text_color(f.found ? t.ansi2 : t.dim)
      .child(f.found ? `Filled in from the gateway's API description (${f.found.replace(/^https?:\/\//, "")}). Check and save.` : "The gateway publishes no API description: fill in its usage endpoint."))
    .child(field(t, "Usage URL", f.url))
    .child(field(t, "Budget URL", f.budgetUrl))
    .child(v_flex().gap(4)
      .child(div().text_size(11.5).text_color(t.dim).child("Signing in to the usage API"))
      .child(h_flex().gap(6)
        .child(v.chip("auth-device", "Browser sign-in", f.auth === "device", cx => { f.auth = "device"; cx.notify(); }, t))
        .child(v.chip("auth-key", "The profile's key", f.auth === "key", cx => { f.auth = "key"; cx.notify(); }, t))))
    .when(f.auth === "device", el => el.child(field(t, "Device sign-in URL", f.device, "OAuth device flow (RFC 8628): you approve a code in the browser once.")))
    .when(Boolean(f.error), el => el.child(div().text_size(11.5).text_color(t.ansi1).child(f.error)))
    .child(buttons(cx => saveUsage(v, { kind: "gateway", url: f.url.value().trim(), budgetUrl: f.budgetUrl.value().trim(), auth: f.auth, device: f.device.value().trim() }, cx)));
}

function saveUsage(v, spec, cx) {
  const f = v.form;
  v.busy.usageSetup = "Saving…"; cx.notify();
  cx.spawn(async cx => {
    const r = await v.ctl(["usage-setup", f.profile, JSON.stringify(spec)]);
    delete v.busy.usageSetup;
    if (!r.ok) { f.error = r.error; cx.notify(); return; }
    v.form = null; v.handle.focus();
    v.refresh(cx);
    v.loadUsage(cx);
    if (spec.kind === "gateway" && spec.auth === "device") v.startSignin(f.profile, cx);
    cx.notify();
  });
}
