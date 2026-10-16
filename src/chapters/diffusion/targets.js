'use client'

import { rng } from './schedule';

/**
 * Target point clouds x_0 ("the clean image"). Each target is a 2.5-D relief rendered at runtime:
 * shapes are drawn to an offscreen canvas (or computed analytically), turned into a height field,
 * lit, and then stippled — points are importance-sampled where the shaded image is dark, so the
 * particle density *is* the image's luminance. Every call takes a seed so each generation differs.
 */

export const PROMPTS = [
  { id: 'hand', label: 'a human hand' },
  { id: 'cat', label: 'a cat' },
  { id: 'galaxy', label: 'a spiral galaxy' },
  { id: 'word', label: 'the word LATENT' },
  { id: 'portrait', label: 'a portrait' },
];

const G = 200; // field resolution
const EXT = 1.6; // world half-extent of the image plane

let fontReady = null;
function loadFont() {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      const f = new FontFace('LatentDiffXB', 'url(/fonts/Archivo-ExpandedBlack.ttf)');
      await f.load();
      document.fonts.add(f);
      return true;
    } catch {
      return false;
    }
  })();
  return fontReady;
}

function ctx2d() {
  const c = document.createElement('canvas');
  c.width = c.height = G;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000';
  x.fillRect(0, 0, G, G);
  x.fillStyle = '#fff';
  x.strokeStyle = '#fff';
  x.lineCap = 'round';
  x.lineJoin = 'round';
  return x;
}
function channel(x) {
  const d = x.getImageData(0, 0, G, G).data;
  const a = new Float32Array(G * G);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4] / 255;
  return a;
}
function blur(src, r, passes = 2) {
  let a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < G; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * G + Math.min(G - 1, Math.max(0, k))];
      for (let x = 0; x < G; x++) {
        b[y * G + x] = s / n;
        s += a[y * G + Math.min(G - 1, x + r + 1)] - a[y * G + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < G; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(G - 1, Math.max(0, k)) * G + x];
      for (let y = 0; y < G; y++) {
        a[y * G + x] = s / n;
        s += b[Math.min(G - 1, y + r + 1) * G + x] - b[Math.max(0, y - r) * G + x];
      }
    }
  }
  return a;
}

/** Height field + lighting → stipple density. */
function shadeFields({ m, h, lines, hi, extraInk }, { depth = 0.5, edgeGain = 1.4, base = 0.12 } = {}) {
  const ink = new Float32Array(G * G);
  const soft = blur(m, 1, 1);
  const cell = (2 * EXT) / G;
  // light from upper-left, in front
  let lx = -0.55, ly = 0.6, lz = 0.58;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  for (let y = 1; y < G - 1; y++) {
    for (let x = 1; x < G - 1; x++) {
      const i = y * G + x;
      if (m[i] < 0.02 && !(lines && lines[i] > 0.02)) continue;
      const dx = ((h[i + 1] - h[i - 1]) * depth) / (2 * cell);
      const dy = -((h[i + G] - h[i - G]) * depth) / (2 * cell);
      let nx = -dx, ny = -dy, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const shade = Math.max(0, nx * lx + ny * ly + nz * lz);
      const ex = soft[i + 1] - soft[i - 1], ey = soft[i + G] - soft[i - G];
      const edge = Math.min(1, Math.hypot(ex, ey) * 1.6);
      let v = m[i] * (base + (1 - base) * Math.pow(1 - shade, 1.35)) + edge * edgeGain;
      if (lines) v += lines[i] * 1.1;
      if (extraInk) v += extraInk[i];
      if (hi) v += hi[i] * 1.6;
      ink[i] = Math.max(0, v);
    }
  }
  return ink;
}

/** Importance-sample N points from an ink-density field, lifting them onto the height field. */
function sampleField(N, seed, { ink, h, hi }, { depth = 0.5, back = 0.3, extrude = false, yScale = 1 } = {}) {
  const R = rng(seed);
  const cdf = new Float64Array(G * G);
  let acc = 0;
  for (let i = 0; i < G * G; i++) { acc += ink[i]; cdf[i] = acc; }
  const pos = new Float32Array(N * 3);
  const hiOut = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const r = R() * acc;
    let lo = 0, up = G * G - 1;
    while (lo < up) { const mid = (lo + up) >> 1; if (cdf[mid] < r) lo = mid + 1; else up = mid; }
    const cx = lo % G, cy = (lo / G) | 0;
    const u = (cx + R()) / G, v = (cy + R()) / G;
    const hv = h[lo];
    let z, side = 1;
    if (extrude) {
      const q = R();
      z = q < 0.38 ? depth : q < 0.76 ? -depth : (R() * 2 - 1) * depth;
    } else {
      side = R() < back ? -0.75 : 1;
      z = side * hv * depth * (0.94 + 0.06 * R());
    }
    pos[p * 3] = (u - 0.5) * 2 * EXT;
    pos[p * 3 + 1] = (0.5 - v) * 2 * EXT * yScale;
    pos[p * 3 + 2] = z + R.normal() * 0.012;
    hiOut[p] = hi && hi[lo] > 0.45 && side > 0 ? 1 : 0;
  }
  return { pos, hi: hiOut };
}

function raster(N, seed, draw, opts = {}) {
  const R = rng(seed * 7 + 3);
  const mask = ctx2d(), lines = ctx2d(), hi = ctx2d();
  draw({ mask, lines, hi, R });
  const m = channel(mask);
  const l = channel(lines);
  const hh = channel(hi);
  const hb = blur(m, opts.blur ?? 7, 3);
  const h = new Float32Array(G * G);
  for (let i = 0; i < h.length; i++) h[i] = m[i] > 0.01 ? Math.pow(hb[i], 0.62) * m[i] : 0;
  const ink = shadeFields({ m, h, lines: l, hi: hh }, opts);
  return sampleField(N, seed, { ink, h, hi: hh }, opts);
}

// ───────────────────────────── targets ─────────────────────────────

function hand(N, seed) {
  return raster(N, seed, ({ mask, lines, hi, R }) => {
    const j = () => (R() - 0.5) * 0.12; // per-generation pose variation (radians)
    const S = G / 256;
    mask.save(); mask.scale(S, S);
    // palm + wrist
    mask.beginPath(); mask.ellipse(128, 168, 50, 56, 0, 0, Math.PI * 2); mask.fill();
    mask.fillRect(100, 180, 58, 90);
    const finger = (bx, by, len, ang, w) => {
      const a = ang + j();
      const tx = bx + Math.sin(a) * len, ty = by - Math.cos(a) * len;
      mask.lineWidth = w; mask.beginPath(); mask.moveTo(bx, by); mask.lineTo(tx, ty); mask.stroke();
      return [bx, by, tx, ty, a];
    };
    const fs = [
      finger(98, 128, 82, -0.17, 22),
      finger(124, 120, 94, -0.02, 23),
      finger(150, 124, 86, 0.13, 22),
      finger(172, 138, 66, 0.3, 19),
    ];
    // thumb: two segments
    const ta = -0.95 + j();
    mask.lineWidth = 25; mask.beginPath(); mask.moveTo(98, 186); mask.lineTo(70, 160);
    mask.lineTo(70 + Math.sin(ta) * 48, 160 - Math.cos(ta) * 48); mask.stroke();
    mask.restore();
    // knuckle creases + palm lines (extra ink)
    lines.save(); lines.scale(S, S); lines.lineWidth = 1.4; lines.globalAlpha = 0.35;
    for (const [bx, by, , , a] of fs) {
      for (const k of [0.38, 0.68]) {
        const L = 88 * k;
        const cx = bx + Math.sin(a) * L, cy = by - Math.cos(a) * L;
        lines.beginPath(); lines.moveTo(cx - 7 * Math.cos(a), cy - 7 * Math.sin(a)); lines.lineTo(cx + 7 * Math.cos(a), cy + 7 * Math.sin(a)); lines.stroke();
      }
    }
    lines.beginPath(); lines.moveTo(96, 160); lines.quadraticCurveTo(130, 150, 168, 156); lines.stroke();
    lines.beginPath(); lines.moveTo(92, 178); lines.quadraticCurveTo(118, 196, 120, 232); lines.stroke();
    lines.restore();
    // signal: the index fingertip — the point of contact
    const [, , tx, ty] = fs[0];
    hi.save(); hi.scale(S, S); hi.beginPath(); hi.arc(tx, ty + 3, 5, 0, Math.PI * 2); hi.fill(); hi.restore();
  }, { depth: 0.42, back: 0.32 });
}

function cat(N, seed) {
  return raster(N, seed, ({ mask, lines, hi, R }) => {
    const S = G / 256;
    const tilt = (R() - 0.5) * 0.22;
    const curl = (R() - 0.5) * 30;
    mask.save(); mask.scale(S, S);
    // body
    mask.beginPath(); mask.ellipse(124, 186, 56, 60, 0, 0, Math.PI * 2); mask.fill();
    mask.beginPath(); mask.ellipse(124, 236, 64, 20, 0, 0, Math.PI * 2); mask.fill();
    // tail
    mask.lineWidth = 15; mask.beginPath(); mask.moveTo(168, 236);
    mask.bezierCurveTo(226, 240, 236, 170 + curl, 206, 128 + curl * 0.5); mask.stroke();
    // head (tilted)
    mask.translate(124, 98); mask.rotate(tilt);
    mask.beginPath(); mask.ellipse(0, 0, 46, 40, 0, 0, Math.PI * 2); mask.fill();
    mask.beginPath(); mask.moveTo(-42, -12); mask.lineTo(-36, -64); mask.lineTo(-8, -36); mask.closePath(); mask.fill();
    mask.beginPath(); mask.moveTo(42, -12); mask.lineTo(36, -64); mask.lineTo(8, -36); mask.closePath(); mask.fill();
    // whiskers
    mask.lineWidth = 1.6;
    for (const s of [-1, 1]) for (const k of [-6, 0, 6]) {
      mask.beginPath(); mask.moveTo(s * 18, 14 + k * 0.4); mask.quadraticCurveTo(s * 50, 10 + k, s * 74, 6 + k * 2.2); mask.stroke();
    }
    mask.restore();
    lines.save(); lines.scale(S, S); lines.lineWidth = 2; lines.globalAlpha = 0.8;
    lines.translate(124, 98); lines.rotate(tilt);
    lines.beginPath(); lines.ellipse(0, 0, 46, 40, 0, 0.15 * Math.PI, 0.85 * Math.PI); lines.stroke(); // jaw line
    lines.beginPath(); lines.moveTo(-5, 12); lines.lineTo(0, 17); lines.lineTo(5, 12); lines.stroke(); // nose
    lines.beginPath(); lines.moveTo(0, 17); lines.quadraticCurveTo(-6, 24, -12, 21); lines.moveTo(0, 17); lines.quadraticCurveTo(6, 24, 12, 21); lines.stroke();
    lines.beginPath(); lines.moveTo(-34, -20); lines.lineTo(-32, -48); lines.lineTo(-16, -32); lines.stroke();
    lines.beginPath(); lines.moveTo(34, -20); lines.lineTo(32, -48); lines.lineTo(16, -32); lines.stroke();
    lines.setTransform(S, 0, 0, S, 0, 0);
    lines.beginPath(); lines.moveTo(104, 196); lines.lineTo(104, 246); lines.moveTo(144, 196); lines.lineTo(144, 246); lines.stroke(); // front legs
    lines.restore();
    // eyes glow signal
    hi.save(); hi.scale(S, S); hi.translate(124, 98); hi.rotate(tilt);
    for (const s of [-1, 1]) { hi.beginPath(); hi.ellipse(s * 18, -4, 7, 9, 0, 0, Math.PI * 2); hi.fill(); }
    hi.restore();
  }, { depth: 0.4, back: 0.3 });
}

function word(N, seed) {
  return raster(N, seed, ({ mask, lines, R }) => {
    const S = G / 256;
    mask.save(); mask.scale(S, S);
    mask.font = `900 52px LatentDiffXB, "Arial Black", Impact, sans-serif`;
    mask.textAlign = 'center'; mask.textBaseline = 'middle';
    const w = mask.measureText('LATENT').width;
    const k = Math.min(1, 236 / w);
    mask.translate(128, 128); mask.scale(k, k * (1.05 + (R() - 0.5) * 0.06)); mask.rotate((R() - 0.5) * 0.04);
    mask.fillText('LATENT', 0, 0);
    mask.restore();
  }, { depth: 0.09, extrude: true, blur: 2, edgeGain: 2.2, base: 0.35 });
}

function portrait(N, seed) {
  const R = rng(seed * 13 + 1);
  const m = new Float32Array(G * G), h = new Float32Array(G * G);
  const extra = new Float32Array(G * G), hi = new Float32Array(G * G);
  const tilt = (R() - 0.5) * 0.1;
  const hairPhase = R() * 6;
  const gs = (x, s) => Math.exp(-(x * x) / s);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let cy = 0; cy < G; cy++) {
    for (let cx = 0; cx < G; cx++) {
      const i = cy * G + cx;
      const X0 = ((cx + 0.5) / G) * 2 - 1, Y0 = 1 - ((cy + 0.5) / G) * 2;
      const X = X0 * Math.cos(tilt) - Y0 * Math.sin(tilt);
      const Y = X0 * Math.sin(tilt) + Y0 * Math.cos(tilt) + 0.04;
      const ax = Math.abs(X);
      const jaw = 1 - 0.32 * Math.pow(Math.min(1, Math.max(0, (0.1 - Y) / 0.62)), 1.6);
      const hx = X / (0.44 * jaw), hy = (Y - 0.12) / 0.6;
      const rh = hx * hx + hy * hy;
      let mask = 0, ht = 0, ink = 0;
      // shoulders + neck
      const sx = X / 0.98, sy = (Y + 1.22) / 0.52;
      if (sx * sx + sy * sy < 1) { mask = 1; ht = Math.sqrt(1 - sx * sx - sy * sy) * 0.42; }
      if (ax < 0.17 && Y < -0.28 && Y > -0.86) { mask = 1; ht = Math.max(ht, Math.sqrt(1 - (X / 0.17) ** 2) * 0.32 + 0.04); ink += 0.25 * sm(-0.3, -0.5, Y); }
      if (rh < 1) {
        mask = 1;
        let d = Math.sqrt(1 - rh) * 0.55;
        d += 0.17 * gs(X, 0.0035) * sm(0.32, 0.18, Y) * sm(-0.12, 0.0, Y); // nose ridge
        d += 0.08 * gs(X, 0.006) * gs(Y + 0.06, 0.005); // nose tip
        d += 0.05 * gs(Y - 0.31, 0.0025) * (ax < 0.36 ? 1 : 0); // brow
        d -= 0.07 * gs(ax - 0.17, 0.008) * gs(Y - 0.2, 0.005); // eye sockets
        d += 0.035 * gs(X, 0.02) * gs(Y + 0.27, 0.0016); // lips
        d += 0.05 * gs(X, 0.02) * gs(Y + 0.45, 0.006); // chin
        d += 0.04 * gs(ax - 0.25, 0.02) * gs(Y + 0.02, 0.02); // cheeks
        ht = d;
        // features as ink
        const eye = gs(ax - 0.17, 0.0016) * gs(Y - 0.2, 0.0007);
        ink += 0.55 * eye;
        const iris = Math.hypot(ax - 0.17, Y - 0.2);
        if (iris < 0.032) { hi[i] = 1; }
        ink += 0.8 * gs(ax - 0.18, 0.009) * gs(Y - 0.31 + 0.03 * gs(ax - 0.18, 0.01), 0.00035); // brows
        ink += 0.55 * gs(X, 0.012) * gs(Y + 0.27, 0.0012); // lips
        ink += 0.3 * gs(ax - 0.035, 0.0006) * gs(Y + 0.07, 0.002); // nostrils
      }
      // hair
      const qx = X / 0.5, qy = (Y - 0.17) / 0.66;
      const inHair = qx * qx + qy * qy < 1.12 && (Y > 0.43 - 0.55 * X * X || (ax > 0.37 && Y > -0.16));
      if (inHair) {
        mask = 1;
        ht = Math.max(ht, Math.sqrt(Math.max(0, 1.12 - qx * qx - qy * qy)) * 0.55 + 0.05);
        ink += 0.45 + 0.35 * Math.sin(X * 64 + Y * 9 + Math.sin(Y * 18 + hairPhase) * 2.2);
      }
      m[i] = mask; h[i] = ht; extra[i] = mask ? ink : 0;
    }
  }
  const hn = blur(h, 1, 1);
  const ink = shadeFields({ m, h: hn, hi, extraInk: extra }, { depth: 1, edgeGain: 1.2, base: 0.06 });
  return sampleField(N, seed, { ink, h: hn, hi }, { depth: 1, back: 0.12 });
}

function galaxy(N, seed) {
  const R = rng(seed * 31 + 5);
  const arms = 2 + Math.floor(R() * 2.2); // 2–3 arms
  const twist = 2.3 + R() * 0.9;
  const pos = new Float32Array(N * 3);
  const hi = new Float32Array(N);
  const tiltX = -1.0 + (R() - 0.5) * 0.15, tiltZ = 0.35 + (R() - 0.5) * 0.2;
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
  const knots = Array.from({ length: 14 }, () => [0.4 + R() * 1.1, R() * Math.PI * 2]);
  for (let p = 0; p < N; p++) {
    const q = R();
    let x, y, z, isHi = 0;
    if (q < 0.17) { // bulge
      const r = Math.abs(R.normal()) * 0.22;
      const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      x = r * Math.sin(ph) * Math.cos(th); z = r * Math.sin(ph) * Math.sin(th); y = r * Math.cos(ph) * 0.6;
      if (r < 0.09) isHi = 1;
    } else if (q < 0.9) { // arms
      const a = Math.floor(R() * arms);
      const r = 0.12 + 1.5 * Math.pow(R(), 0.75);
      const spread = R.normal() * (0.16 + 0.1 * r) / Math.max(0.5, r);
      const th = (a / arms) * Math.PI * 2 + twist * Math.log(r / 0.12) * 0.62 + spread;
      x = r * Math.cos(th); z = r * Math.sin(th); y = R.normal() * 0.035 * (1.6 - r);
      for (const [kr, kt] of knots) {
        const dx = x - kr * Math.cos(kt), dz = z - kr * Math.sin(kt);
        if (dx * dx + dz * dz < 0.0012) { isHi = 1; break; }
      }
    } else { // halo dust
      const r = 0.3 + R() * 1.6;
      const th = R() * Math.PI * 2;
      x = r * Math.cos(th); z = r * Math.sin(th); y = R.normal() * 0.12;
    }
    // tilt the disc toward the viewer
    const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    const x2 = x * cz - y1 * sz, y2 = x * sz + y1 * cz;
    pos[p * 3] = x2 * 1.02; pos[p * 3 + 1] = y2 * 1.02; pos[p * 3 + 2] = z1 * 1.02;
    hi[p] = isHi;
  }
  return { pos, hi };
}

const BUILDERS = { hand, cat, galaxy, word, portrait };

/** Build target `id` with N points. Async because the word target waits for its local font. */
export async function buildTarget(id, N, seed = 1) {
  if (id === 'word') await loadFont();
  const fn = BUILDERS[id] || hand;
  return fn(N, seed);
}
