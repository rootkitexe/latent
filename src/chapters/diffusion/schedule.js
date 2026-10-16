/**
 * Cosine noise schedule (Nichol & Dhariwal, 2021).
 *   ᾱ(t) = f(t) / f(0),   f(t) = cos²( ((t/T) + s) / (1 + s) · π/2 )
 * Forward process:  x_t = √ᾱ_t · x_0 + √(1 − ᾱ_t) · ε,   ε ~ N(0, I)
 * The same formula is evaluated per particle in the vertex shader (see shaders.js).
 */
export const T = 1000;
export const S = 0.008;
const HALF_PI = Math.PI / 2;
const F0 = Math.cos((S / (1 + S)) * HALF_PI) ** 2;

export function alphaBar(t) {
  const tt = Math.min(T, Math.max(0, t));
  const f = Math.cos(((tt / T + S) / (1 + S)) * HALF_PI);
  return Math.min(1, Math.max(0, (f * f) / F0));
}

/** Signal-to-noise ratio ᾱ / (1 − ᾱ), in decibels. */
export function snrDb(ab) {
  if (ab >= 0.999999) return Infinity;
  if (ab <= 1e-9) return -Infinity;
  return 10 * Math.log10(ab / (1 - ab));
}

export const GLSL_ALPHABAR = /* glsl */ `
float alphaBar(float t) {
  float tt = clamp(t, 0.0, ${T.toFixed(1)});
  float f = cos(((tt / ${T.toFixed(1)}) + ${S}) / ${(1 + S).toFixed(3)} * 1.5707963);
  return clamp((f * f) / ${F0.toFixed(8)}, 0.0, 0.99999);
}
`;

/** Seeded PRNG (mulberry32) + standard normal (Box–Muller). */
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  r.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0;
    while (u < 1e-12) u = r();
    const v = r();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  return r;
}
