// The Dragon Quest slime: a flat blue teardrop with big white eyes, a wide
// smile and a red tongue. The body is native divs, like the duck, so it stays
// crisp and flat at sidebar size; the face changes with the mood.
//
//   working   – the reference's happy face, bouncing and squashing
//   blocked   – wide eyes, an open mouth, an exclamation mark hopping above
//   waiting   – half-lidded eyes, a flat mouth, a question mark, a small shake
//   done      – a big smile, blush, sparkles, a thumbs-up, big hops
//   idle      – a gentle smile, a slow breath
//
// The slime has its own square 240×240 box, centred, so a row has no empty
// knife room on the left the way the duck's box does.

import { div, image } from "gpui-kit";

const BODY = "mods/pond-agents/slime-body.svg";
const EYE = "#0B1220";
const WHITE = "#FFFFFF";
const MOUTH = "#4A1F1F";
const TONGUE = "#E06060";
const CUFF = "#2F6FE0";
const CHEEK = "#FF9DB0";
const SPARK = "#FFD166";
const ALERT = "#FFB020";

const WIDTH = 240;
const HEIGHT = 240;
const CENTER = WIDTH / 2;

export const SLIME_MOODS = [
  { id: "work", label: "Working" },
  { id: "alert", label: "Needs you" },
  { id: "impatient", label: "Impatient" },
  { id: "cheer", label: "Done hop" },
  { id: "calm", label: "Content" },
];

// hop: the body's lift; squash: how much the base flattens at the top of the
// bounce; shake: a side-to-side instead.
const MOTION = {
  work: { hop: -8, squash: 8, period: 600 },
  alert: { hop: -12, squash: 8, period: 700 },
  impatient: { shake: 3, period: 520 },
  cheer: { hop: -20, squash: 10, period: 340 },
  calm: { hop: 4, squash: 4, period: 1700 },
};

export function slimeMood(m, height, { still = false } = {}) {
  const s = height / HEIGHT;
  const px = (v) => v * s;
  const oval = (x, y, w, h, color, opacity = null) => {
    const el = div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(color).rounded_full();
    return opacity == null ? el : el.opacity(opacity);
  };
  const bar = (x, y, w, h, color, radius = 3, opacity = null) => {
    const el = div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(color).rounded(px(radius));
    return opacity == null ? el : el.opacity(opacity);
  };
  // A smile: a flat top, round bottom. The reference mouth is a wide dark
  // opening with a red lower lip.
  const smile = (x, y, w, h, color) => div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h))
    .bg(color).rounded_t(px(h * 0.25)).rounded_b(px(h * 0.5));
  const stillEl = (el, prop, from, to, period) =>
    still ? el : el.loop(prop, { from, to, period, easing: "ease-in-out" });
  // The ! and ? are text, not bars: a font glyph stays clean at every size.
  const mark = (text, x, y, size) => div().absolute().left(px(x)).top(px(y)).w(px(size)).h(px(size * 1.15))
    .flex().items_center().justify_center()
    .text_size(px(size * 0.95)).font_bold().text_color(ALERT).child(text);

  const mood = MOTION[m] ?? MOTION.calm;
  const period = mood.period;
  const q = still ? 0 : (mood.squash ?? 0);

  // The body is one picture (the reference droplet), so the whole teardrop
  // squashes: its bottom stays on the ground while the top comes down and the
  // sides spread.
  let body = image(BODY).size(px(240)).absolute().left(0).top(0);
  if (q) {
    body = body
      .loop("top", { from: 0, to: px(q), period, easing: "ease-in-out" })
      .loop("height", { from: px(240), to: px(240 - q), period, easing: "ease-in-out" })
      .loop("width", { from: px(240), to: px(240 + q * 0.7), period, easing: "ease-in-out" })
      .loop("left", { from: 0, to: px(-q * 0.35), period, easing: "ease-in-out" });
  }

  // White eyes with black pupils and a glint, like the reference.
  const eye = (x, y, w = 40, h = 48, pw = 18, ph = 22, dy = 0) => [
    oval(x, y, w, h, WHITE),
    oval(x + (w - pw) / 2, y + (h - ph) / 2 + dy, pw, ph, EYE),
    oval(x + (w - pw) / 2 + 2, y + (h - ph) / 2 + 3 + dy, 5, 5, WHITE, 0.9),
  ];

  let eyes;
  if (m === "alert") eyes = [...eye(CENTER - 54, 112, 44, 54, 20, 26), ...eye(CENTER + 10, 112, 44, 54, 20, 26)];
  else if (m === "impatient") eyes = [...eye(CENTER - 52, 130, 40, 30, 18, 16, 6), ...eye(CENTER + 12, 130, 40, 30, 18, 16, 6)];
  else eyes = [...eye(CENTER - 52, 118, 40, 48, 18, 22), ...eye(CENTER + 12, 118, 40, 48, 18, 22)];

  let brows = null;
  if (m === "impatient") {
    brows = div().absolute().left(0).top(0).w(px(WIDTH)).h(px(140))
      .child(bar(CENTER - 46, 106, 14, 6, EYE, 3)).child(bar(CENTER - 34, 112, 12, 6, EYE, 3))
      .child(bar(CENTER + 22, 112, 12, 6, EYE, 3)).child(bar(CENTER + 34, 106, 14, 6, EYE, 3));
    if (!still) brows = brows.loop("top", { from: 0, to: px(2), period: 700, easing: "ease-in-out" });
  }

  let mouth;
  if (m === "alert") mouth = [oval(CENTER - 12, 174, 24, 30, MOUTH), oval(CENTER - 8, 192, 16, 10, TONGUE)];
  else if (m === "cheer") mouth = [smile(CENTER - 46, 172, 92, 32, MOUTH), oval(CENTER - 36, 186, 72, 16, TONGUE)];
  else if (m === "impatient") mouth = [bar(CENTER - 22, 186, 44, 10, MOUTH, 5)];
  else mouth = [smile(CENTER - 36, 176, 72, 24, MOUTH), oval(CENTER - 27, 188, 54, 12, TONGUE)];

  const cheeks = m === "cheer" || m === "calm"
    ? [
      oval(CENTER - 72, 158, 20, 12, CHEEK, m === "cheer" ? 0.8 : 0.55),
      oval(CENTER + 52, 158, 20, 12, CHEEK, m === "cheer" ? 0.8 : 0.55),
    ]
    : [];

  // Done: a little white glove with its thumb up on the right side.
  const hand = m === "cheer"
    ? [
      bar(CENTER + 90, 166, 26, 8, CUFF, 4),
      bar(CENTER + 93, 146, 24, 22, WHITE, 9),
      bar(CENTER + 93, 132, 9, 16, WHITE, 4.5),
      bar(CENTER + 100, 146, 2, 8, "#C9D8E8", 1),
      bar(CENTER + 103, 152, 10, 2, "#C9D8E8", 1),
      bar(CENTER + 103, 157, 10, 2, "#C9D8E8", 1),
    ]
    : [];

  // Effects live on a full-canvas layer so a loop can move the whole mark.
  const effects = [];
  if (m === "alert") {
    effects.push(stillEl(mark("!", CENTER + 64, 8, 30), "top", px(8), px(-2), period));
  } else if (m === "impatient") {
    effects.push(stillEl(mark("?", CENTER + 55, 6, 42), "top", px(6), px(-4), period));
  } else if (m === "cheer") {
    const star = (x, y, size, p) => {
      const t = 4;
      return stillEl(div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT))
        .child(bar(x + size / 2 - t / 2, y, t, size, SPARK, t / 2))
        .child(bar(x, y + size / 2 - t / 2, size, t, SPARK, t / 2)), "opacity", 0.15, 1, p);
    };
    effects.push(star(CENTER - 100, 40, 16, 600), star(CENTER + 85, 45, 12, 800), star(CENTER - 120, 130, 10, 700), star(CENTER + 30, 4, 10, 650));
  }

  let face = div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT))
    .children(eyes).when(Boolean(brows), (el) => el.child(brows)).children(mouth).children(cheeks).children(hand);
  // The face follows the body's top as it squashes; its own proportions stay.
  if (q) face = face.loop("top", { from: 0, to: px(q), period, easing: "ease-in-out" });

  let group = div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT))
    .child(body).child(face)
    .child(div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT)).children(effects));
  if (!still) {
    if (mood.shake != null) group = group.loop("left", { from: 0, to: px(mood.shake), period, easing: "ease-in-out" });
    else group = group.loop("top", { from: 0, to: px(mood.hop), period, easing: "ease-in-out" });
  }

  return div().relative().flex_none().w(px(WIDTH)).h(px(HEIGHT)).child(group);
}
