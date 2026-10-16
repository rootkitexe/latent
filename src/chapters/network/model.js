'use client'

/**
 * A real 784-64-32-10 ReLU MLP, trained offline on MNIST (60k digits, affine augmentation) and
 * shipped as int8-quantized weights in /network/mlp.json. Everything here runs on the CPU in the
 * browser: preprocessing (MNIST-style centring), the forward pass, and real backprop/SGD steps.
 */

export const LAYERS = [784, 64, 32, 10];
export const OFFSETS = [0, 784, 848, 880]; // global neuron index of each layer's first neuron
export const N_NEURONS = 890;
export const N_PARAMS = 784 * 64 + 64 + 64 * 32 + 32 + 32 * 10 + 10; // 52,650

function b64ToInt8(s) {
  const bin = atob(s);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}
function b64ToU8(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cached = null;
export async function loadModel() {
  if (cached) return cached;
  const res = await fetch('/network/mlp.json');
  const j = await res.json();
  const W = j.w.map((s, l) => {
    const q = b64ToInt8(s);
    const f = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) f[i] = q[i] * j.ws[l];
    return f;
  });
  const B = j.b.map((b) => Float32Array.from(b));
  const samples = j.samples.map((s) => {
    const u = b64ToU8(s.x);
    return { y: s.y, x: Float32Array.from(u, (v) => v / 255) };
  });
  cached = {
    acc: j.acc,
    W0: W.map((w) => Float32Array.from(w)), // pristine copy for "reset"
    B0: B.map((b) => Float32Array.from(b)),
    W,
    B,
    samples,
  };
  return cached;
}

export function resetWeights(m) {
  m.W.forEach((w, l) => w.set(m.W0[l]));
  m.B.forEach((b, l) => b.set(m.B0[l]));
}

/** Network state: activations of every layer (pre-allocated, reused). */
export function createState() {
  return {
    x: new Float32Array(784),
    a1: new Float32Array(64),
    a2: new Float32Array(32),
    z: new Float32Array(10),
    p: new Float32Array(10),
    d1: new Float32Array(64), // dLoss/dz per layer (backprop deltas)
    d2: new Float32Array(32),
    d3: new Float32Array(10),
    pred: -1,
    conf: 0,
    active: 0,
    empty: true,
    target: -1,
    loss: 0,
  };
}

export function forward(m, s) {
  const ins = [s.x, s.a1, s.a2];
  const outs = [s.a1, s.a2, s.z];
  for (let l = 0; l < 3; l++) {
    const nin = LAYERS[l], nout = LAYERS[l + 1], w = m.W[l], b = m.B[l], inp = ins[l], o = outs[l];
    for (let j = 0; j < nout; j++) {
      let sum = b[j];
      const off = j * nin;
      for (let i = 0; i < nin; i++) sum += w[off + i] * inp[i];
      o[j] = l < 2 ? (sum > 0 ? sum : 0) : sum;
    }
  }
  let mx = -Infinity;
  for (let k = 0; k < 10; k++) mx = Math.max(mx, s.z[k]);
  let se = 0;
  for (let k = 0; k < 10; k++) { s.p[k] = Math.exp(s.z[k] - mx); se += s.p[k]; }
  let best = 0;
  for (let k = 0; k < 10; k++) { s.p[k] /= se; if (s.p[k] > s.p[best]) best = k; }
  s.pred = best;
  s.conf = s.p[best];
  let act = 0;
  for (let i = 0; i < 64; i++) if (s.a1[i] > 0) act++;
  for (let i = 0; i < 32; i++) if (s.a2[i] > 0) act++;
  s.active = act;
  let ink = 0;
  for (let i = 0; i < 784; i++) ink += s.x[i];
  s.empty = ink < 0.5;
  return s;
}

/**
 * Backpropagation of the cross-entropy loss for `target`. Fills the deltas; when lr > 0 also
 * applies one SGD step to the live weights (a real training step on this one example).
 */
export function backward(m, s, target, lr = 0) {
  s.target = target;
  s.loss = -Math.log(Math.max(1e-9, s.p[target]));
  for (let k = 0; k < 10; k++) s.d3[k] = s.p[k] - (k === target ? 1 : 0);
  const acts = [s.x, s.a1, s.a2];
  const deltas = [s.d1, s.d2, s.d3];
  // deltas first (using the current weights), then the update
  for (let l = 2; l >= 1; l--) {
    const nin = LAYERS[l], nout = LAYERS[l + 1], w = m.W[l], d = deltas[l], inp = acts[l], dp = deltas[l - 1];
    for (let i = 0; i < nin; i++) {
      if (inp[i] <= 0) { dp[i] = 0; continue; }
      let sum = 0;
      for (let j = 0; j < nout; j++) sum += w[j * nin + i] * d[j];
      dp[i] = sum;
    }
  }
  if (lr > 0) {
    for (let l = 0; l < 3; l++) {
      const nin = LAYERS[l], nout = LAYERS[l + 1], w = m.W[l], b = m.B[l], d = deltas[l], inp = acts[l];
      for (let j = 0; j < nout; j++) {
        const dj = d[j];
        if (dj === 0) continue;
        b[j] -= lr * dj;
        const off = j * nin;
        for (let i = 0; i < nin; i++) if (inp[i] !== 0) w[off + i] -= lr * dj * inp[i];
      }
    }
  }
  return s;
}

/**
 * MNIST-style preprocessing of a hand drawing: crop to the ink, scale so the longer side is 20px,
 * and place it in a 28×28 frame with its centre of mass at the centre. Area-averaged resampling via
 * an integral image (anti-aliased like the original dataset).
 */
const integ = { w: 0, h: 0, buf: null };
export function preprocess(gray, w, h, out) {
  out.fill(0);
  let minx = w, miny = h, maxx = -1, maxy = -1, sum = 0, sx = 0, sy = 0;
  if (!integ.buf || integ.w !== w || integ.h !== h) {
    integ.w = w; integ.h = h; integ.buf = new Float64Array((w + 1) * (h + 1));
  }
  const I = integ.buf;
  const W1 = w + 1;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      if (v > 0.05) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        sum += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
      }
      row += v;
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
    }
  }
  if (maxx < 0 || sum < 1) return false;
  const bw = maxx - minx + 1, bh = maxy - miny + 1;
  const scale = 20 / Math.max(bw, bh); // dest px per source px
  const cx = sx / sum, cy = sy / sum;
  const inv = 1 / scale;
  const area = inv * inv;
  const S = (x, y) => {
    x = Math.max(0, Math.min(w, x)); y = Math.max(0, Math.min(h, y));
    // bilinear lookup in the integral image (fractional box edges)
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const x1 = Math.min(w, x0 + 1), y1 = Math.min(h, y0 + 1);
    const a = I[y0 * W1 + x0], b = I[y0 * W1 + x1], c = I[y1 * W1 + x0], d = I[y1 * W1 + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  for (let py = 0; py < 28; py++) {
    const y0 = (py - 14) * inv + cy, y1 = y0 + inv;
    for (let px = 0; px < 28; px++) {
      const x0 = (px - 14) * inv + cx, x1 = x0 + inv;
      const v = (S(x1, y1) - S(x0, y1) - S(x1, y0) + S(x0, y0)) / area;
      out[py * 28 + px] = Math.min(1, Math.max(0, v * 1.15));
    }
  }
  return true;
}

/** 28×28 "what does this neuron look for": first-layer weights, or a linear composite for layer 2. */
export function featureMap(m, layer, idx, out) {
  if (layer === 1) {
    const w = m.W[0];
    for (let i = 0; i < 784; i++) out[i] = w[idx * 784 + i];
  } else {
    out.fill(0);
    const w2 = m.W[1], w1 = m.W[0];
    for (let j = 0; j < 64; j++) {
      const c = w2[idx * 64 + j];
      if (c <= 0) continue; // positive paths: the strokes that excite it through layer 1
      for (let i = 0; i < 784; i++) out[i] += c * w1[j * 784 + i];
    }
  }
  let mx = 1e-6;
  for (let i = 0; i < 784; i++) mx = Math.max(mx, Math.abs(out[i]));
  for (let i = 0; i < 784; i++) out[i] /= mx;
  return out;
}
