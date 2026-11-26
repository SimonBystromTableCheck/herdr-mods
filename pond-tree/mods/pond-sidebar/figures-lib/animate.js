// Keeping a picture's own animation.
//
// Herdr plays GIF and animated WebP as they are. It draws SVG still: its CSS
// keyframes and SMIL <animate> never run. So an animated SVG is turned, once,
// into an animated WebP: headless Chrome draws every frame side by side in one
// page (each copy paused at its own moment), once on black and once on white so
// the transparency can be worked out; ImageMagick cuts the sheet up and joins
// the frames. Needs Chrome (or Chromium, Edge, Brave) and ImageMagick.

import { appHome, readTextFile, writeTextFile, exec, window } from "herdr";

export const PLAYS = /\.(gif|webp)$/i;
const HEIGHT = 128; // px per frame: crisp at 45 px on a 2x screen
const FPS = 15;
const COLS = 8;

// Whether an SVG's text animates (CSS keyframes or SMIL).
export const svgAnimates = (text) => /@keyframes|animation\s*:|animation-name|<animate|<animateTransform|<animateMotion|<set\b/i.test(text ?? "");

// Whether this picture has an animation of its own worth keeping.
export async function animated(path) {
  if (PLAYS.test(path)) return true;
  if (!/\.svg$/i.test(path)) return false;
  return svgAnimates(await readTextFile(`${appHome()}/${path}`).catch(() => null));
}

// The longest animation in the SVG, in ms: one loop of the whole picture.
function duration(text) {
  let longest = 0;
  const take = (n, unit) => { const ms = parseFloat(n) * (unit === "ms" ? 1 : 1000); if (ms > longest) longest = ms; };
  for (const m of text.matchAll(/animation(?:-duration)?\s*:[^;}]*?(\d*\.?\d+)(ms|s)\b/gi)) take(m[1], m[2]);
  for (const m of text.matchAll(/\bdur\s*=\s*["'](\d*\.?\d+)(ms|s)?["']/gi)) take(m[1], m[2] ?? "s");
  return Math.min(10000, Math.max(200, longest || 2000));
}

function aspect(text) {
  const box = text.match(/viewBox\s*=\s*["'][\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = parseFloat(box?.[1] ?? text.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i)?.[1]);
  const h = parseFloat(box?.[2] ?? text.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i)?.[1]);
  return w > 0 && h > 0 ? w / h : 1;
}

async function which(names) {
  for (const n of names) {
    if (n.startsWith("/")) { if ((await exec("test", ["-x", n]).catch(() => null))?.code === 0) return n; continue; }
    const r = await exec("sh", ["-c", `command -v "${n}"`]).catch(() => null);
    if (r?.code === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const browsers = () => window()?.platform === "macos"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
  : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];

// What's missing for converting here, or null when it can.
export async function missingTools() {
  const missing = [];
  if (!(await which(browsers()))) missing.push("Google Chrome");
  if (!(await which(["magick"]))) missing.push("ImageMagick");
  return missing.length ? missing : null;
}

function page(svg, n, step, w, bg) {
  const body = svg.replace(/<\?xml[^>]*\?>/i, "").replace(/<!DOCTYPE[^>]*>/i, "");
  // The SVG goes in once (Herdr writes at most 1 MiB); the page copies it per frame.
  return `<!doctype html><html><head><style>
html,body{margin:0;background:${bg};overflow:hidden}
body{display:grid;grid-template-columns:repeat(${COLS},${w}px)}
.f{width:${w}px;height:${HEIGHT}px;overflow:hidden}
.f>svg{display:block;width:${w}px;height:${HEIGHT}px}
</style></head><body><template id="art">${body}</template><script>
const art = document.getElementById("art");
for (let i = 0; i < ${n}; i++) {
  const f = document.createElement("div");
  f.className = "f";
  f.appendChild(art.content.cloneNode(true));
  document.body.appendChild(f);
}
document.querySelectorAll(".f").forEach((f, i) => {
  const t = i * ${step};
  const s = f.querySelector("svg");
  try { s.pauseAnimations(); s.setCurrentTime(t / 1000); } catch (e) {}
  f.getAnimations({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = t; });
});
</script></body></html>`;
}

// Turns an animated SVG (path from the app home) into an animated WebP next to
// it in the person's pond-figures/. Resolves with the new path; throws a
// sentence a person can read.
export async function svgToWebp(path, ownDir) {
  const home = appHome();
  const text = await readTextFile(`${home}/${path}`);
  if (!text) throw new Error("Couldn't read the SVG.");
  const [chrome, magick] = [await which(browsers()), await which(["magick"])];
  if (!chrome || !magick) throw new Error(`Needs ${[!chrome && "Google Chrome", !magick && "ImageMagick"].filter(Boolean).join(" and ")} to convert.`);

  const ms = duration(text);
  const w = Math.max(8, Math.round(HEIGHT * aspect(text)));
  const n = Math.min(64, Math.max(COLS, Math.round((ms / 1000) * FPS / COLS) * COLS));
  const step = ms / n;
  const rows = n / COLS;

  const tmp = `${home}/.pond-convert-${Date.now().toString(36)}`;
  await exec("mkdir", ["-p", `${tmp}/profile`]);
  try {
    for (const bg of ["black", "white"]) {
      await writeTextFile(`${tmp}/${bg}.html`, page(text, n, step, w, bg), null);
      const r = await exec(chrome, [
        "--headless=new", `--user-data-dir=${tmp}/profile`, "--no-first-run", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", `--window-size=${w * COLS},${HEIGHT * rows}`, `--screenshot=${tmp}/${bg}.png`, `file://${tmp}/${bg}.html`,
      ], { timeout: 60000 });
      if ((await exec("test", ["-s", `${tmp}/${bg}.png`]))?.code !== 0) throw new Error(`Chrome didn't draw the frames. ${r.stderr.split("\n").filter((l) => !/task_policy|^\s*$/.test(l)).pop() ?? ""}`.trim());
    }
    // Opacity is how alike the black and white shots are; colour comes from the black one, unpremultiplied.
    const matte = await exec(magick, [
      `${tmp}/black.png`, `${tmp}/white.png`, "-alpha", "off",
      "(", "-clone", "0,1", "-compose", "difference", "-composite", "-colorspace", "gray", "-negate", "-colorspace", "sRGB", ")",
      "-delete", "1", "(", "-clone", "0,1", "-compose", "divide_src", "-composite", ")",
      "-delete", "0", "+swap", "-compose", "copy_opacity", "-composite", "-colorspace", "sRGB", `${tmp}/sheet.png`,
    ]);
    if (matte.code !== 0) throw new Error(`ImageMagick: ${matte.stderr.trim().split("\n").pop()}`);

    const cut = await exec(magick, [`${tmp}/sheet.png`, "-crop", `${w}x${HEIGHT}`, "+repage", "+adjoin", `${tmp}/f-%03d.png`]);
    if (cut.code !== 0) throw new Error(`ImageMagick: ${cut.stderr.trim().split("\n").pop()}`);
    const frames = Array.from({ length: n }, (_, i) => `${tmp}/f-${String(i).padStart(3, "0")}.png`);

    // Every frame whole: Herdr drops parts of WebP frames that only carry what
    // changed, which is how ImageMagick writes them. img2webp can write whole
    // frames; without it, a GIF (whole frames, hard-edged transparency).
    const name = path.split("/").pop().replace(/\.svg$/i, "");
    const dir = path.startsWith(`${ownDir}/`) ? path.split("/").slice(0, -1).join("/") : ownDir;
    await exec("mkdir", ["-p", `${home}/${dir}`]);
    const img2webp = await which(["img2webp"]);
    const out = `${dir}/${name}-anim.${img2webp ? "webp" : "gif"}`;
    const join = img2webp
      ? await exec(img2webp, ["-loop", "0", "-lossless", "-kmin", "0", "-kmax", "1", "-d", String(Math.round(step)), ...frames, "-o", `${home}/${out}`])
      : await exec(magick, [...frames, "-set", "delay", String(Math.max(2, Math.round(step / 10))), "-dispose", "Background", "-loop", "0", `${home}/${out}`]);
    if (join.code !== 0) throw new Error(`${img2webp ? "img2webp" : "ImageMagick"}: ${join.stderr.trim().split("\n").pop()}`);
    return out;
  } finally {
    await exec("rm", ["-rf", tmp]).catch(() => null);
  }
}
