// GitHub accounts: runs gh as the account picked for the space (gh's own active account is left
// alone), the setup screen shown while gh is missing or signed out, and the header's account menu.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, home, appHome } from "herdr";

const HOST = "github.com";
const ICON = "mods/remote-checker", CHROME = "mods/workspace-chrome";
// The token goes through the environment, never argv (argv shows in `ps`).
const AS_USER = 'g=$1; GH_TOKEN=$("$g" auth token --hostname "$2" --user "$3") || exit 97; export GH_TOKEN; shift 3; exec "$g" "$@"';
// gh on PATH, else where install-gh.sh puts it (~/.local/bin isn't on every PATH).
let GH = "gh";
const localGh = () => `${home()}/.local/bin/gh`;

// Remote machines keep their own gh login (and their own gh): the pick only applies here.
export function gh(user, args, opts = {}) {
  if (opts.on) return exec("gh", args, opts);
  if (!user) return exec(GH, args, opts);
  return exec("sh", ["-c", AS_USER, "remote-checker", GH, HOST, user, ...args], opts);
}

// { installed, version, onPath, accounts: [{ login, active, ok }], brew }
export async function checkAuth() {
  let version = null, onPath = false;
  for (const bin of ["gh", localGh()]) {
    try {
      const r = await exec(bin, ["--version"], { timeout: 10_000 });
      if (r.code === 0) { GH = bin; onPath = bin === "gh"; version = r.stdout.split("\n")[0]; break; }
    } catch { /* not there */ }
  }
  if (!version) {
    const brew = await exec("brew", ["--version"], { timeout: 10_000 }).then((r) => r.code === 0, () => false);
    return { installed: false, accounts: [], brew };
  }
  const r = await exec(GH, ["auth", "status", "--hostname", HOST, "--json", "hosts"], { timeout: 15_000 });
  try {
    const list = JSON.parse(r.stdout).hosts?.[HOST] ?? [];
    return { installed: true, version, onPath, accounts: list.map((a) => ({ login: a.login, active: Boolean(a.active), ok: a.state === "success" })) };
  } catch {
    // gh before `auth status --json`: read its text instead.
    const text = `${r.stdout}\n${r.stderr}`;
    const accounts = [...text.matchAll(/Logged in to \S+ (?:account|as) (\S+)/g)].map((m, i) => ({ login: m[1], active: i === 0, ok: true }));
    return { installed: true, version, onPath, accounts };
  }
}

export async function fetchName(login) {
  const r = await gh(login, ["api", "user", "--jq", ".name // \"\""], { timeout: 15_000 }).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
}

// "Ada Lovelace" → "AL"; without a name, the capitals of the login ("AdaLovelaceDev" → "AL").
export function initials(login, name) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  const caps = login.match(/[A-Z]/g) ?? [];
  return (caps.length >= 2 ? caps.slice(0, 2).join("") : login.slice(0, 2)).toUpperCase();
}

function colorOf(login, t) {
  const palette = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1];
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function avatar(login, name, t, size = 22) {
  return div().size(size).flex_none().flex().items_center().justify_center().rounded_full()
    .bg(colorOf(login, t)).text_color(t.background).text_size(size * 0.42).font_semibold()
    .child(initials(login, name));
}

export function button(id, text, kind, action, t, { disabled = false, busy = null } = {}) {
  const primary = kind === "primary";
  return h_flex().id(id).h(26).px(10).gap(5).flex_none().items_center().rounded(6).text_size(12).font_medium()
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .when(Boolean(disabled || busy), (el) => el.opacity(0.5))
    .when(!disabled && !busy, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
    .when(Boolean(busy), (el) => el.child(svg(`${CHROME}/spinner.svg`).size(11).spin(900)))
    .child(busy || text);
}

// In the background (exec's 10-minute cap): Homebrew when there is one, else the official release
// into ~/.local/bin (install-gh.sh). Returns null, or the last lines of the failure.
export async function installGh(brew) {
  const r = brew
    ? await exec("brew", ["install", "gh"], { timeout: 600_000 })
    : await exec("sh", [`${appHome()}/mods/remote-checker/install-gh.sh`], { timeout: 600_000 });
  if (r.code === 0) return null;
  return (r.stderr || r.stdout).trim().split("\n").slice(-4).join("\n") || `brew exited with ${r.code}`;
}

export function startSignIn() {
  run("tab.new", { name: "GitHub sign-in", argv: [GH, "auth", "login", "--hostname", HOST, "--web"] });
}

// Shown in the panel's content until gh is installed and has an account (laid out like pond-profiles' setup).
export function setupView(v, t) {
  const a = v.auth, installed = a.installed, signedIn = a.accounts.length > 0;
  const steps = [
    { id: "install", title: "GitHub CLI (gh)", done: installed,
      text: installed ? `Installed: ${a.version}.` : a.brew
        ? "Remote Checker reads pull requests through gh. Installs it with Homebrew (brew install gh)."
        : "Remote Checker reads pull requests through gh. Downloads the official release from GitHub, checks it against the release's checksums and puts it in ~/.local/bin (no Homebrew or admin rights needed).",
      warn: installed && !a.onPath ? "gh is in ~/.local/bin, which isn't on your PATH: the panel uses it anyway, but terminals won't find gh until you add ~/.local/bin to your PATH." : null,
      error: v.installError,
      action: installed ? null : h_flex().gap(8)
        .child(button("rc-setup-install", "Install GitHub CLI", "primary", (cx) => v.installGh(cx), t, { busy: v.installing ? "Installing…" : null }))
        .when(!a.brew, (el) => el.child(button("rc-setup-manual", "Other ways", null, () => exec("open", ["https://github.com/cli/cli#installation"]), t))) },
    { id: "login", title: "Sign in to GitHub", done: signedIn, needs: installed,
      text: signedIn ? `Signed in: ${a.accounts.map((x) => x.login).join(", ")}.`
        : "Opens a tab running gh auth login: press enter there and finish in the browser. This panel picks it up when you're done.",
      action: signedIn ? null : button("rc-setup-login", "Sign in", "primary", (cx) => { startSignIn(); v.watchAuth(cx); }, t,
        { disabled: !installed, busy: v.authWatching && installed ? "Waiting for sign-in…" : null }) },
  ];
  const row = (s, i) => {
    const icon = s.done
      ? div().size(18).flex_none().flex().items_center().justify_center().rounded_full().bg(t.ansi2).text_color(t.background).text_size(11).child("✓")
      : div().size(18).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(s.needs === false ? t.border : t.accent)
        .text_size(10.5).text_color(t.muted).child(String(i));
    return v_flex().id(`rc-step-${s.id}`).gap(6).p(10).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().gap(8).items_center().child(icon).child(div().flex_1().font_semibold().text_color(s.done ? t.muted : t.foreground).child(s.title)))
      .child(div().pl(26).text_size(11.5).text_color(t.dim).child(s.text))
      .when(Boolean(s.warn), (el) => el.child(div().pl(26).text_size(11.5).text_color(t.ansi3).child(s.warn)))
      .when(Boolean(s.error), (el) => el.child(div().pl(26).text_size(11.5).text_color(t.ansi1).child(s.error)))
      .when(Boolean(s.action), (el) => el.child(h_flex().pl(26).gap(8).child(s.action)));
  };
  return v_flex().id("rc-setup").flex_1().min_h(0).p(12).gap(8).overflow_y_scroll()
    .child(v_flex().gap(3).p(4)
      .child(div().text_size(15).font_semibold().child("Set up GitHub for Remote Checker"))
      .child(div().text_size(11.5).text_color(t.dim).child("The panel needs the GitHub CLI signed in to at least one account. You can add more accounts later from the avatar in the header.")))
    .children(steps.map((s, i) => row(s, i + 1)))
    .child(h_flex().gap(8).pt(4).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.dim).child(installed ? "Sign in to finish." : "Install gh to continue."))
      .child(button("rc-setup-recheck", "Check again", null, (cx) => v.loadAuth(cx), t)));
}

// The header's account menu: this space's account, the others gh knows, and adding one.
export function accountMenu(v, t, space) {
  const effective = v.account(), picked = v.prefs().account ?? null;
  const row = (id, children, onClick, selected = false) => h_flex().id(id).h(36).px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .bg(selected ? t.selected : t.popover).hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .children(children);
  return div().absolute().top(0).left(0).right(0).bottom(0)
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); v.closeAccountMenu(cx); })
    .child(v_flex().absolute().top(40).right(8).w(280).p(8).gap(2).rounded(9).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().px(8).pt(2).font_semibold().text_size(12.5).child(`GitHub account for ${space?.name ?? "this space"}`))
      .child(div().px(8).pb(6).text_size(11).text_color(t.dim)
        .child("Only this panel uses it. gh and git in your terminals keep gh's active account."))
      .children(v.auth.accounts.map((acc) => {
        const name = v.names[acc.login];
        const note = !acc.ok ? "signed out: sign in again" : acc.active ? (picked ? "gh's active account" : "gh's active account · follows it") : name || "";
        return row(`rc-acct-${acc.login}`, [
          avatar(acc.login, name, t, 24),
          v_flex().flex_1().min_w(0)
            .child(div().truncate().text_size(12.5).child(acc.login))
            .child(div().truncate().text_size(11).text_color(acc.ok ? t.dim : t.ansi1).child(note)),
          ...(acc.login === effective ? [svg(`${ICON}/check.svg`).size(13).flex_none().text_color(t.accent)] : []),
        ], (cx) => (acc.ok ? v.pickAccount(acc, cx) : (startSignIn(), v.watchAuth(cx))), acc.login === effective);
      }))
      .child(div().h(1).my(4).bg(t.border))
      .child(row("rc-acct-add", [
        div().size(24).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(t.border).text_color(t.muted)
          .child(svg(`${CHROME}/plus.svg`).size(12)),
        div().flex_1().text_size(12.5).child("Sign in to another account…"),
      ], (cx) => { v.closeAccountMenu(cx); startSignIn(); v.watchAuth(cx, { pickNew: true }); })));
}
