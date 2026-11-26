// Claude usage cards at the bottom of the sidebar, one per account pinned from the Claude panel
// (pond-profiles' Usage section; the list is ~/.config/herdr-app/pond-usage.json, see usage-pins.js).
// A gateway (Pantheon): each provider's token budget, the end-of-day forecast and the spend.
// A claude.ai plan: the session and weekly limits. It asks pond-profiles' ctl.py, the same JSON the
// Claude panel draws; ctl.py holds the tokens and never prints a secret. Clicking opens the panel.
// The block grows to fit the cards and shrinks to nothing when none are pinned.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, home, theme, props, checking, layout, run, settings, readTextFile } from "herdr";
import { pinnedUsage, loadUsagePins } from "./usage-pins.js";

const EVERY = 2 * 60 * 1000;
// Anthropic first, the gateway's other providers after it by name.
const NAMES = { anthropic: "Anthropic" };
const ORDER = ["anthropic"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, as the other sidebar mods do.
const width = () => find(layout(), "sidebar")?.size?.px ?? Infinity;

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = n => n == null ? "?" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
const pctText = p => p <= 0 ? "0" : p < 1 ? p.toFixed(1) : String(Math.round(p));
const nameOf = k => NAMES[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
// Green, amber from 60%, red from 80%: the status colors every theme keeps distinct.
const tone = (t, p) => p >= 80 ? t.blocked : p >= 60 ? t.working : t.done;
// "2h 10m", "3d": how long until an ISO time.
const until = iso => {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return "now";
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
};
const titled = s => String(s).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// The block showing this mod.
function mine(node) {
  if (node?.content?.mod === "pond-usage") return node;
  for (const c of node?.children ?? []) { const f = mine(c); if (f) return f; }
  return null;
}

function providersOf(usage) {
  const all = usage?.providers;
  if (!all || typeof all !== "object") return [];
  return Object.keys(all)
    .sort((a, b) => ((ORDER.indexOf(a) < 0 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 99 : ORDER.indexOf(b))) || a.localeCompare(b))
    .map(key => {
      const p = all[key] ?? {};
      const used = num(p.credit_adjusted_tokens ?? p.tokens_used);
      const limit = num(p.token_limit);
      const reqs = num(p.credit_adjusted_requests ?? p.requests_used);
      const reqLimit = num(p.request_limit);
      const pct = limit > 0 && used != null ? (used / limit) * 100 : 0;
      return { key, name: nameOf(key), used, limit, reqs, reqLimit, pct, eod: num(p.forecast?.tokens?.projected_pct_of_limit) };
    });
}

export default class PantheonUsage extends View {
  init(_props, cx) {
    this.data = {}; this.err = {}; this.loading = new Set(); // per profile
    this.labels = {}; // profile -> pond-profiles' name for it
    this.pinFile = {};
    const pins = cx => cx.spawn(async cx => {
      await loadUsagePins(this.pinFile, props()?.profile ? [props().profile] : []); // first run: a profile the layout names, else none (pin from the Claude panel)
      for (const name of this.pinned()) if (!(name in this.data) && !this.loading.has(name)) this.load(name, cx);
      cx.notify();
    });
    pins(cx);
    cx.timer.every(3000, pins);
    const labels = cx => cx.spawn(async cx => {
      try {
        const accounts = JSON.parse(await readTextFile(`${home()}/.cvm/herdr/pond-profiles.json`) ?? "{}").accounts ?? {};
        const next = Object.fromEntries(Object.entries(accounts).map(([k, v]) => [k, v?.label]).filter(([, v]) => v));
        if (JSON.stringify(next) !== JSON.stringify(this.labels)) { this.labels = next; cx.notify(); }
      } catch {}
    });
    labels(cx);
    cx.timer.every(15000, labels);
    cx.timer.every(EVERY, cx => { for (const name of this.pinned()) this.load(name, cx); });
  }

  pinned() { return pinnedUsage() ?? []; }
  label(name) { return this.labels[name] ?? (name === props()?.profile && props()?.label) ?? name[0].toUpperCase() + name.slice(1); }

  load(name, cx) {
    if (checking() || this.loading.has(name)) return;
    this.loading.add(name);
    cx.spawn(async cx => {
      try {
        const r = await exec("python3", [`${appHome()}/mods/pond-profiles/ctl.py`, "usage", name], { timeout: 60000 });
        const line = r.stdout.trim().split("\n").pop() || "";
        if (!line) this.err[name] = r.stderr.trim() || "No answer from the usage check";
        else {
          const json = JSON.parse(line);
          if (json.ok === false) this.err[name] = json.error || "Usage unavailable";
          else { this.data[name] = json; this.err[name] = null; }
        }
      } catch (e) { this.err[name] = String(e); }
      this.loading.delete(name);
      cx.notify();
    });
  }

  // The Claude panel's Usage section, when this layout has the panel stack; else its overlay.
  open(cx) {
    const body = find(layout(), "panel-body");
    const child = body?.children?.find(c => c.content?.mod === "pond-profiles")?.id;
    if (child) {
      run("layout.select", { stack: "panel-body", child });
      run("layout.show", { id: "panel" });
    } else run("mod.open", { name: "pond-profiles" });
    for (const name of this.pinned()) this.load(name, cx);
  }

  // Proportional flex, not a percentage width: a child's percentage would resolve
  // against the row, not the track, and overfill it.
  bar(t, pct, w = null) {
    const p = Math.min(100, Math.max(0, pct));
    const track = h_flex().h(4).rounded(2).overflow_hidden().bg(t.raised ?? t.border)
      .child(div().h_full().flex_basis(0).flex_grow(Math.max(0.0001, p)).min_w(p > 0 ? 2 : 0).bg(pct >= 60 ? tone(t, pct) : t.muted).opacity(pct >= 60 ? 1 : 0.6))
      .child(div().h_full().flex_basis(0).flex_grow(Math.max(0.0001, 100 - p)));
    return w ? track.w(w).flex_none() : track.flex_1();
  }

  render() {
    const t = theme();
    const names = this.pinned();
    // Grow or shrink this block to the cards; nothing pinned, nothing shown.
    const fit = h => {
      const block = mine(layout()), px = Math.round(h);
      if (block && px !== this.fitted) { this.fitted = px; run("layout.resize", { id: block.id, px }); }
    };
    if (!names.length) { fit(0); return div().size_full(); }
    return v_flex().size_full().bg(t.surface ?? t.chrome).justify_end().overflow_hidden()
      .child(v_flex().id("usage-cards").w_full().flex_none().px(8).pt(4).pb(6).gap(2)
        .on_size_change(size => fit(size.height / (settings().zoom || 1)))
        .children(names.map(name => this.cardFor(name, t))));
  }

  // One account's card: a claude.ai plan's limits, or a gateway's providers.
  cardFor(name, t) {
    const data = this.data[name], err = this.err[name];
    const compact = width() < 160;
    const rail = width() < 60;
    const label = this.label(name);
    const plan = data?.kind === "plan";
    const providers = plan ? (data.limits ?? []).slice(0, 3).map((l, i) => ({
      key: `${l.group}-${i}`, name: l.label === "Current session" ? "Session" : l.label, pct: num(l.percent) ?? 0, plan: true, resetsAt: l.resetsAt,
    })) : providersOf(data?.usage);
    const primary = providers.find(p => p.key === "anthropic") ?? providers[0];
    const spend = num(data?.budget?.current_spend_usd);

    // No items_center on the column: on this runtime it re-lays the column out as a
    // wrapping row, putting the compact percentage and bar side by side.
    // Styled as harns's Usage strip: on the sidebar's surface, a rounded card that lights up on hover.
    const card = v_flex().id(`usage-${name}`).w_full().px(8).py(6).gap(compact ? 4 : 6).rounded(7)
      .when(compact, el => el.justify_center())
      .hover(s => s.bg(t.hover)).cursor_pointer()
      .on_click((_e, cx) => this.open(cx));
    const root = { child: (el) => { card.child(el); return root; }, children: (els) => { card.children(els); return root; } };
    const done = () => card;

    if (!providers.length) {
      const signedOut = data?.signedIn === false;
      const unconfigured = data?.configured === false;
      const msg = err ? "Usage unavailable" : unconfigured ? "Usage not set up"
        : signedOut ? (data?.expired ? "Sign-in expired" : "Sign in needed")
        : data ? "No usage data" : "Checking usage…";
      const hint = err || (signedOut ? "Open the Claude panel to sign in" : unconfigured ? "Set it up in the Claude panel" : `${label} usage`);
      root
        .child(div().w_full().text_size(12).text_color(t.muted).when(compact, el => el.text_center()).child(label))
        .child(div().id(`usage-msg-${name}`).w_full().text_size(11.5).text_color(err ? t.blocked : signedOut || unconfigured ? t.working : t.dim)
          .when(compact, el => el.text_center())
          .tooltip(hint)
          .child(msg));
      return done();
    }

    const header = h_flex().w_full().gap(6).items_center().text_size(12)
      .when(compact, el => el.justify_center())
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(rail ? label[0] : label))
      .when(!compact && !rail && plan && Boolean(data.subscription), el => el.child(div().flex_none().text_color(t.dim).child(`${titled(data.subscription)} plan`)))
      .when(!compact && !rail && !plan, el => el.child(h_flex().id(`usage-today-${name}`).flex_none().gap(4).items_center().text_color(t.muted)
        .tooltip(`${primary.name} tokens used today, of the day's limit`)
        .child(svg("mods/pond-usage/coins.svg").size(12).flex_none())
        .child(div().child(`${fmt(primary.used)} / ${fmt(primary.limit)}`))))
      .when(Boolean(err), el => el.child(div().size(5).flex_none().rounded_full().bg(t.blocked).tooltip(`Last refresh failed: ${err}`)));

    const rows = providers.slice(0, 3).map(p => h_flex().id(`usage-${name}-${p.key}`).w_full().h(16).gap(7).items_center().text_size(11.5)
      .tooltip(p.plan ? `${p.name}: ${pctText(p.pct)}% used · resets in ${until(p.resetsAt)}`
        : `${p.name}: ${fmt(p.used)} / ${fmt(p.limit)} tokens · ${fmt(p.reqs)} / ${fmt(p.reqLimit)} requests`
          + (p.eod != null ? ` · projected ${pctText(p.eod)}% by end of day` : ""))
      .when(!rail, el => el.child(div().w(compact ? 0 : 62).flex_none().truncate().text_color(t.muted).child(p.name)))
      .child(this.bar(t, p.pct))
      .child(div().w(rail ? 0 : 30).flex_none().text_right().text_size(11).text_color(t.dim).child(`${pctText(p.pct)}%`)));

    // A plan's foot: when the session limit resets.
    const session = plan ? (data.limits ?? []).find(l => l.group === "session") : null;
    const foot = plan ? h_flex().w_full().gap(4).items_center().text_size(11).text_color(t.dim)
      .child(div().truncate().child(session?.resetsAt ? `Session resets in ${until(session.resetsAt)}` : "Weekly limits"))
      : h_flex().w_full().gap(4).items_center().text_size(11).text_color(t.dim)
      .when(primary?.eod != null, el => el.child(div().flex_none().text_color(tone(t, primary.eod)).tooltip("Projected usage by the end of the day").child(`EOD ${pctText(primary.eod)}%`)))
      .when(primary?.eod != null && spend != null, el => el.child(div().child("·")))
      .when(spend != null, el => el.child(div().truncate().tooltip("Spent this billing period").child(`$${spend.toFixed(2)} spent`)));
    // The rail is too narrow for one line: stack the forecast and the spend.
    const footNarrow = v_flex().w_full().gap(1).text_size(10).text_color(t.dim)
      .when(primary?.eod != null, el => el.child(div().w_full().text_center().text_color(tone(t, primary.eod)).tooltip("Projected usage by the end of the day").child(`EOD ${pctText(primary.eod)}%`)))
      .when(spend != null, el => el.child(div().w_full().text_center().truncate().tooltip("Spent this billing period").child(`$${spend.toFixed(2)} spent`)));

    if (rail) {
      root
        .child(div().w_full().text_center().text_size(10).text_color(t.dim).child(label[0]))
        .child(div().w_full().text_center().text_size(14).font_semibold().text_color(tone(t, primary?.pct ?? 0)).child(`${pctText(primary?.pct ?? 0)}%`))
        .child(h_flex().w_full().justify_center().child(this.bar(t, primary?.pct ?? 0, 30)));
      return done();
    }
    if (compact) {
      root
        .child(header)
        .child(div().w_full().text_center().text_size(16).font_semibold().text_color(tone(t, primary?.pct ?? 0)).child(`${pctText(primary?.pct ?? 0)}%`))
        .child(h_flex().w_full().justify_center().child(this.bar(t, primary?.pct ?? 0, 44)))
        .child(footNarrow);
      return done();
    }
    root.child(header).children(rows).child(foot);
    return done();
  }
}
