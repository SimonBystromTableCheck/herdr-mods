// The duck, rebuilt from the rectangles of ~/Downloads/ducks/*.svg as native divs.
// Herdr draws SVG still, so every motion here is a native .loop():
// no timers, no re-renders, and it only runs while the duck is on screen.
//
// Units are the SVG's, with the origin at the duck's body group. The canvas always
// leaves room for a knife on the left, so swapping moods never moves the body.
//
//   working   – angry brows, jabbing the knife                  (Stab-knife)
//   blocked   – escalates while it waits for you:
//                 < 1 min  angry brows, bobbing                 (Idle-angry)
//                 later    brows twitching, scowling            (Scowl-angry)
//   done      – blushing, happy eyes, hopping with wings flapping  (Happy-duck-blush)
//   idle      – blushing, happy eyes, gently bobbing               (Idle-blush)

import { div } from "gpui-kit";

const BODY = "#F5DA81";
const BEAK = "#EFC787";
const EYE = "#000000";
const BLADE = "#DBDBDB";
const HILT = "#A5A5A5";
const CHEEK = "#FFA798";

const KNIFE_ROOM = 118; // knife reach left of the body group, jab included
const WIDTH = KNIFE_ROOM + 250;
const HEIGHT = 240;
const BOB = { period: 1200, easing: "ease-out" };

export const BLOCKED_SCOWL = 60 * 1000;

export function mood(status, waited = 0) {
  if (status === "working") return "stab";
  if (status === "blocked") return waited < BLOCKED_SCOWL ? "angry" : "scowl";
  if (status === "done") return "happy";
  return "content";
}

export const duckWidth = (height) => Math.round((height * WIDTH) / HEIGHT);
// Where the body's middle sits across the canvas (0..1): other figures centre here.
export const DUCK_CENTER = (KNIFE_ROOM + 125) / WIDTH;

// The moods a figure set can pick, in the order the editor shows them.
export const MOODS = [
  { id: "stab", label: "Knife jab" },
  { id: "angry", label: "Angry" },
  { id: "scowl", label: "Scowl" },
  { id: "happy", label: "Happy hop" },
  { id: "content", label: "Content" },
];

// `height` in px; `waited` is how long the agent has been in this status (ms).
export function duck(status, height, waited = 0) {
  return duckMood(mood(status, waited), height);
}

// One mood; `still` draws it without any motion.
export function duckMood(m, height, { still = false } = {}) {
  const s = height / HEIGHT;
  const motion = (el, prop, policy) => (still ? el : el.loop(prop, policy));
  const px = (v) => v * s;
  const rect = (x, y, w, h, color) => div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(color);

  const angry = m === "angry" || m === "scowl" || m === "stab";
  const knife = m === "stab";

  const blush = m === "happy" || m === "content";

  // A happy eye is an arch: two legs under a bar.
  const arch = (x, y) => [rect(x, y + 5, 10, 15, EYE), rect(x + 25, y + 5, 10, 15, EYE), rect(x + 5, y, 25, 10, EYE)];

  // Eyes: happy arches, angry (shorter, with stepped brows), or open.
  const eyes = blush
    ? [...arch(48, 52), ...arch(157, 52)]
    : angry
      ? [rect(55, 52, 20, 20, EYE), rect(164, 52, 20, 20, EYE)]
      : [rect(55, 42, 20, 30, EYE), rect(164, 42, 20, 30, EYE)];

  // Brows tilt in toward the beak; drawn as two steps, pixel-art style.
  let brows = null;
  if (angry) {
    brows = div().absolute().left(0).top(0).w(px(250)).h(px(70))
      .child(rect(43, 33, 20, 9, EYE)).child(rect(62, 41, 20, 10, EYE))
      .child(rect(176, 33, 20, 9, EYE)).child(rect(157, 41, 20, 10, EYE));
    if (m === "scowl" || m === "stab") brows = motion(brows, "top", { from: px(-2), to: px(3), period: 900, easing: "ease-in-out" });
  }

  // Wings; while stabbing, the knife-side one pushes out with each jab. Happy
  // ducks flap them high (the SVG swings them 40°; Herdr can't rotate, so they lift).
  const flutter = (el) => m === "happy" ? motion(el, "top", { from: px(122), to: px(100), period: 300, easing: "ease-in-out" })
    : el;
  const leftWing = m === "stab"
    ? motion(div().absolute().right(px(225)).top(px(122)).h(px(40)).w(px(25)).bg(BODY), "width", { from: px(25), to: px(38), period: 700, easing: "ease-in" })
    : flutter(rect(0, 122, 25, 40, BODY));
  const rightWing = flutter(rect(225, 122, 25, 40, BODY));

  // Knife: held point-first to the left of the left wing.
  let blade = null;
  if (knife) {
    blade = div().absolute().left(px(-105)).top(px(142)).w(px(105)).h(px(30))
      .child(rect(0, 0, 80, 10, BLADE)).child(rect(5, 10, 75, 10, BLADE)).child(rect(20, 20, 60, 10, BLADE)).child(rect(80, 0, 25, 20, HILT));
    if (m === "stab") blade = motion(blade, "left", { from: px(-105), to: px(-118), period: 700, easing: "ease-in" });
  }

  // The body group: everything but the feet. It bobs, or hops when happy.
  let group = div().absolute().left(px(KNIFE_ROOM)).top(0).w(px(250)).h(px(207))
    .child(leftWing)
    .child(rightWing)
    .child(rect(25, 0, 200, 200, BODY))
    .when(blush, (el) => el.child(rect(35, 72, 20, 15, CHEEK)).child(rect(184, 72, 25, 15, CHEEK)))
    .child(rect(5, 82, 60, 25, BEAK))
    .children(eyes)
    .when(Boolean(brows), (el) => el.child(brows))
    .when(Boolean(blade), (el) => el.child(blade));
  group = m === "happy"
    ? motion(group, "top", { from: 0, to: px(-18), period: 300, easing: "ease-in-out" })
    : motion(group, "top", { from: 0, to: px(7), ...BOB });

  // Happy feet tap in turn.
  let feet = [rect(KNIFE_ROOM + 55, 200, 25, 40, BEAK), rect(KNIFE_ROOM + 171, 200, 25, 40, BEAK)];
  if (m === "happy") feet = [
    motion(feet[0], "top", { from: px(194), to: px(200), period: 600, easing: "ease-in-out" }),
    motion(feet[1], "top", { from: px(200), to: px(194), period: 600, easing: "ease-in-out" }),
  ];
  const whole = div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT)).children(feet).child(group);

  return div().relative().flex_none().w(px(WIDTH)).h(px(HEIGHT)).child(whole);
}
