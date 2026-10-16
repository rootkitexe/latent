/**
 * The loss landscape — an analytic function of two "weights" (u, v) with an exact gradient.
 * Pure math, no three.js: shared by the terrain mesh, the ball simulation and the static fallback.
 *
 *   L(u, v) = bowl + quartic walls − Σ wells + ripples − Lmin
 *
 * One elongated, tilted ravine holds the global minimum (classic zig-zag territory for plain
 * gradient descent), three shallower basins are local minima, two hills create saddle points, and
 * a faint ripple adds the small traps that noise (SGD) can shake a ball out of.
 */

// [cx, cy, amplitude (+ = well, − = hill), sigmaX, sigmaY, angle]
const WELLS = [
  [1.25, -0.85, 1.75, 1.55, 0.4, 0.62], // global ravine
  [-1.7, 1.35, 1.05, 0.72, 0.72, 0], // local A
  [-2.05, -1.65, 0.8, 0.55, 0.55, 0], // local B
  [1.85, 2.05, 0.72, 0.62, 0.62, 0], // local C
  [0.05, 0.35, -0.75, 0.85, 0.85, 0], // central hill (saddles around it)
  [-0.45, -2.55, -0.5, 0.6, 0.6, 0], // southern hill
  [2.0, -1.85, 0.5, 0.32, 0.32, 0], // shallow dimple on the eastern slope (a trap for plain SGD)
];
const W = WELLS.map(([cx, cy, a, sx, sy, th]) => ({
  cx, cy, a, isx: 1 / (sx * sx), isy: 1 / (sy * sy), c: Math.cos(th), s: Math.sin(th),
}));

const K2 = 0.055; // bowl
const K4 = 0.0016; // quartic walls
const RA = 0.045; // ripple amplitude
const RM0 = 3.4, RM1 = 2.2; // ridge mask: starts at r = RM0, full by RM0 + RM1

/** Raw function + gradient. Writes [f, du, dv] into out. */
export function evalRaw(u, v, out) {
  const r2 = u * u + v * v;
  const r4 = r2 * r2;
  let f = K2 * r2 + K4 * r4;
  const gr = 2 * K2 + 4 * K4 * r2; // ∂/∂u = gr·u
  let gu = gr * u;
  let gv = gr * v;
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    const du = u - w.cx, dv = v - w.cy;
    const a = w.c * du + w.s * dv;
    const b = -w.s * du + w.c * dv;
    const e = Math.exp(-0.5 * (a * a * w.isx + b * b * w.isy));
    f -= w.a * e;
    // d/du of −A·exp(−Q/2) = A·e·(a·isx·∂a/∂u + b·isy·∂b/∂u)
    const pa = a * w.isx * w.a * e, pb = b * w.isy * w.a * e;
    gu += pa * w.c - pb * w.s;
    gv += pa * w.s + pb * w.c;
  }
  const s1 = Math.sin(2.3 * u + 0.5), c1 = Math.cos(2.3 * u + 0.5);
  const s2 = Math.sin(2.1 * v + 0.3), c2 = Math.cos(2.1 * v + 0.3);
  f += RA * s1 * s2;
  gu += RA * 2.3 * c1 * s2;
  gv += RA * 2.1 * s1 * c2;
  // Alien ridges beyond the playable area (masked to zero inside it, so the lesson stays clean).
  const r = Math.sqrt(r2);
  if (r > RM0) {
    const t = Math.min(1, (r - RM0) / RM1);
    const m = t * t * (3 - 2 * t);
    const dm = r < RM0 + RM1 ? (6 * t * (1 - t)) / RM1 / r : 0; // dm/dr ÷ r
    const a1 = 1.3 * u + 0.7, b1 = 1.1 * v - 0.4, a2 = 2.7 * u - 1.1 * v + 0.3, a3 = 1.7 * u + 3.9 * v;
    const n = 0.55 * Math.sin(a1) * Math.sin(b1) + 0.3 * Math.sin(a2) + 0.18 * Math.sin(a3);
    const nu = 0.55 * 1.3 * Math.cos(a1) * Math.sin(b1) + 0.3 * 2.7 * Math.cos(a2) + 0.18 * 1.7 * Math.cos(a3);
    const nv = 0.55 * 1.1 * Math.sin(a1) * Math.cos(b1) - 0.3 * 1.1 * Math.cos(a2) + 0.18 * 3.9 * Math.cos(a3);
    f += m * n;
    gu += dm * u * n + m * nu;
    gv += dm * v * n + m * nv;
  }
  out[0] = f; out[1] = gu; out[2] = gv;
  return out;
}

// Find the global minimum once (coarse grid + Newton-free polish by small GD steps).
const tmp = [0, 0, 0];
let LMIN = Infinity, MIN_U = 0, MIN_V = 0;
for (let i = 0; i <= 240; i++) {
  for (let j = 0; j <= 240; j++) {
    const u = -4 + (8 * i) / 240, v = -4 + (8 * j) / 240;
    evalRaw(u, v, tmp);
    if (tmp[0] < LMIN) { LMIN = tmp[0]; MIN_U = u; MIN_V = v; }
  }
}
for (let k = 0; k < 4000; k++) {
  evalRaw(MIN_U, MIN_V, tmp);
  MIN_U -= 0.02 * tmp[1]; MIN_V -= 0.02 * tmp[2];
}
evalRaw(MIN_U, MIN_V, tmp);
LMIN = tmp[0];

export const GLOBAL_MIN = { u: MIN_U, v: MIN_V };

/** Loss (≥ 0, exactly 0 at the global minimum) + gradient into out = [L, dL/du, dL/dv]. */
export function lossGrad(u, v, out) {
  evalRaw(u, v, out);
  out[0] -= LMIN;
  return out;
}

export function loss(u, v) {
  return evalRaw(u, v, tmp)[0] - LMIN;
}

/** Playable half-extent in weight space, full terrain half-extent (mountains to the horizon). */
export const PLAY = 3.1;
export const EXTENT = 7.5;
/** World units per weight unit, and world height per unit of loss. */
export const S = 4;
export const H = 2.05;

/** Visual height compression (mirrors the GLSL hv()). */
export const hv = (L) => (L < 3 ? L : 3 + 10 * (1 - Math.exp(-(L - 3) / 10)));
export const hvd = (L) => (L < 3 ? 1 : Math.exp(-(L - 3) / 10));

/** How far the terrain has risen at (u, v) for a global rise 0..1 (a wave out from the minimum). */
export function riseAt(u, v, rise) {
  const d = Math.hypot(u - GLOBAL_MIN.u, v - GLOBAL_MIN.v);
  const k = Math.min(1, Math.max(0, (rise * 15 - d) / 2));
  return k * k * (3 - 2 * k);
}

/** World-space terrain height at weights (u, v). World: x = u·S, z = −v·S. */
export function groundY(u, v, rise = 1) {
  return hv(loss(u, v)) * H * riseAt(u, v, rise);
}
