'use client'

/**
 * Real word vectors for the galaxy.
 *
 * public/embeddings/galaxy.json — vocabulary, cluster ids, 3D layout (t-SNE of the real vectors)
 * public/embeddings/vectors.bin — the actual GloVe 6B 300-d vectors for every word, int8 with a
 *                                 Float32 per-row scale table in front (built offline, see report).
 *
 * All similarity / analogy queries below run on the full 300-d vectors in the browser.
 */

let cache = null;

export const CLUSTER_COLORS = {
  // cold palette, each nebula its own hue between teal, ice, frost and violet
  animals: '#3fe0b0',
  people: '#a284ff',
  food: '#47c6ff',
  cities: '#5c7cfa',
  countries: '#7468ff',
  emotions: '#c98cff',
  motion: '#4cf0ff',
  numbers: '#a8f0ff',
  colours: '#79a6ff',
  tech: '#22b4ff',
  music: '#9670ff',
  body: '#62d6e6',
  nature: '#5cc6ff',
  sport: '#35e0d8',
  science: '#8796ff',
  time: '#b4e6ff',
  dust: '#7a849e',
};

const HIDDEN_WORDS = new Set(['mistress', 'drug', 'terror', 'gun', 'hate', 'lover']);

export async function loadGalaxy() {
  if (cache) return cache;
  const [raw, buf] = await Promise.all([
    fetch('/embeddings/galaxy.json').then((r) => r.json()),
    fetch('/embeddings/vectors.bin').then((r) => r.arrayBuffer()),
  ]);
  const N0 = raw.words.length;
  const D = raw.dim;
  const scales = new Float32Array(buf, 0, N0);
  const q = new Int8Array(buf, N0 * 4, N0 * D);
  // Real web-trained vectors carry some associations that read badly on a public demo; leave those
  // words out of the galaxy entirely (labels, neighbours and analogies all skip them).
  const keep = [];
  for (let i = 0; i < N0; i++) if (!HIDDEN_WORDS.has(raw.words[i])) keep.push(i);
  const N = keep.length;
  const g = {
    ...raw,
    words: keep.map((i) => raw.words[i]),
    cat: keep.map((i) => raw.cat[i]),
    pos: keep.flatMap((i) => [raw.pos[i * 3], raw.pos[i * 3 + 1], raw.pos[i * 3 + 2]]),
  };
  const vecs = new Float32Array(N * D);
  keep.forEach((src, i) => {
    let n = 0;
    for (let k = 0; k < D; k++) { const v = q[src * D + k] * scales[src]; vecs[i * D + k] = v; n += v * v; }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < D; k++) vecs[i * D + k] /= n;
  });
  const index = new Map(g.words.map((w, i) => [w, i]));
  const pos = new Float32Array(g.pos);

  // nebula centres (median-ish: mean of the members closest to the mean)
  const K = g.clusters.length;
  const centres = [];
  for (let c = 0; c < K; c++) {
    let x = 0, y = 0, z = 0, n = 0;
    for (let i = 0; i < N; i++) if (g.cat[i] === c) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; n++; }
    x /= n; y /= n; z /= n;
    const d = [];
    for (let i = 0; i < N; i++) if (g.cat[i] === c) d.push([Math.hypot(pos[i * 3] - x, pos[i * 3 + 1] - y, pos[i * 3 + 2] - z), i]);
    d.sort((a, b) => a[0] - b[0]);
    const core = d.slice(0, Math.max(3, Math.floor(d.length * 0.6)));
    let cx = 0, cy = 0, cz = 0;
    for (const [, i] of core) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
    const spread = core[core.length - 1][0];
    // label anchor: the member with the most neighbours (t-SNE can split a cluster into islands)
    let best = core[0][1], bc = -1;
    for (const [, i] of d) {
      let cnt = 0;
      for (const [, j] of d) if (Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]) < 5) cnt++;
      if (cnt > bc) { bc = cnt; best = i; }
    }
    centres.push({ ...g.clusters[c], x: cx / core.length, y: cy / core.length, z: cz / core.length, spread, count: n, lx: pos[best * 3], ly: pos[best * 3 + 1], lz: pos[best * 3 + 2] });
  }

  cache = { N, D, words: g.words, cat: Int8Array.from(g.cat), pos, vecs, index, clusters: centres, source: g.source };
  return cache;
}

export function vec(G, i) {
  return G.vecs.subarray(i * G.D, i * G.D + G.D);
}

export function cosine(G, a, b) {
  const D = G.D; let s = 0;
  for (let k = 0; k < D; k++) s += G.vecs[a * D + k] * G.vecs[b * D + k];
  return s;
}

/** Top-k words by cosine to an arbitrary query vector (normalized internally). */
export function nearestTo(G, qv, k = 8, exclude = []) {
  const D = G.D; let qn = 0;
  for (let j = 0; j < D; j++) qn += qv[j] * qv[j];
  qn = Math.sqrt(qn) || 1;
  const top = [];
  for (let i = 0; i < G.N; i++) {
    if (exclude.includes(i)) continue;
    let s = 0; const o = i * D;
    for (let j = 0; j < D; j++) s += G.vecs[o + j] * qv[j];
    s /= qn;
    if (top.length < k || s > top[top.length - 1].cos) {
      top.push({ i, cos: s });
      top.sort((a, b) => b.cos - a.cos);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

export function neighbours(G, i, k = 8) {
  return nearestTo(G, vec(G, i), k, [i]);
}

/** a − b + c, computed in all 300 dimensions. */
export function analogy(G, a, b, c, k = 5) {
  const D = G.D; const q = new Float32Array(D);
  for (let j = 0; j < D; j++) q[j] = G.vecs[a * D + j] - G.vecs[b * D + j] + G.vecs[c * D + j];
  return { q, ranks: nearestTo(G, q, k, [a, b, c]) };
}

/** Where an arbitrary vector "would sit" in the 3D map: weighted mean of its nearest stars. */
export function placeVector(G, ranks, out) {
  let x = 0, y = 0, z = 0, w = 0;
  for (const r of ranks) {
    const ww = Math.pow(Math.max(0.001, r.cos), 6);
    x += G.pos[r.i * 3] * ww; y += G.pos[r.i * 3 + 1] * ww; z += G.pos[r.i * 3 + 2] * ww; w += ww;
  }
  out[0] = x / w; out[1] = y / w; out[2] = z / w;
  return out;
}

export function lookup(G, word) {
  if (!word) return -1;
  const w = String(word).trim().toLowerCase();
  return G.index.has(w) ? G.index.get(w) : -1;
}

export function suggest(G, prefix, n = 6) {
  const p = String(prefix || '').trim().toLowerCase();
  if (!p) return [];
  const out = [];
  for (let i = 0; i < G.N && out.length < n; i++) if (G.words[i].startsWith(p)) out.push(G.words[i]);
  return out;
}

/**
 * A 3-D "lens" onto the analogy: a LINEAR projection of the real 300-D vectors onto
 *   e1 = direction b → c,  e2 = (a − b) ⟂ e1,  e3 = the leftover gap between a − b + c and the answer.
 * Being linear, the parallelogram is exact: lens(a − b + c) = lens(a) − lens(b) + lens(c).
 * Returns local coords for [a, b, c, l (= a − b + c), r (answer)], centred and scaled to ~`size`.
 */
export function lensLayout(G, a, b, c, r, size = 6.5) {
  const D = G.D;
  const va = vec(G, a), vb = vec(G, b), vc = vec(G, c), vr = vec(G, r);
  const vl = new Float32Array(D);
  for (let j = 0; j < D; j++) vl[j] = va[j] - vb[j] + vc[j];
  const sub = (x, y) => { const o = new Float32Array(D); for (let j = 0; j < D; j++) o[j] = x[j] - y[j]; return o; };
  const dt = (x, y) => { let s = 0; for (let j = 0; j < D; j++) s += x[j] * y[j]; return s; };
  const norm = (x) => { const n = Math.sqrt(dt(x, x)) || 1; for (let j = 0; j < D; j++) x[j] /= n; return x; };
  const orth = (x, basis) => { for (const e of basis) { const s = dt(x, e); for (let j = 0; j < D; j++) x[j] -= s * e[j]; } return x; };
  const e1 = norm(sub(vc, vb));
  const e2 = norm(orth(sub(va, vb), [e1]));
  let g = orth(sub(vr, vl), [e1, e2]);
  if (Math.sqrt(dt(g, g)) < 1e-4) { g = new Float32Array(D); g[0] = 1; orth(g, [e1, e2]); }
  const e3 = norm(g);
  const pts = [va, vb, vc, vl, vr].map((v) => [dt(v, e1), dt(v, e2), dt(v, e3)]);
  const m = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  let ext = 0;
  for (const p of pts) { for (let k = 0; k < 3; k++) p[k] -= m[k]; ext = Math.max(ext, Math.hypot(p[0], p[1], p[2])); }
  const s = size / (ext || 1);
  // depth (e3) is exaggerated a touch less so the parallelogram reads face-on
  return pts.map((p) => [p[0] * s, p[1] * s, p[2] * s * 0.8]);
}
