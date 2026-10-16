/**
 * GLSL for the network. All per-neuron numbers live in one 32×32 float texture (uAct):
 *   r = activation (normalised per layer, 0..1)
 *   g = |backprop delta| (normalised per layer, 0..1)
 *   b = feature weight of the selected hidden neuron (input neurons only, −1..1)
 * Waves: uFwd runs 0 → 3.6 (layer coordinate), uBwd runs 3.2 → −0.6.
 */

const common = /* glsl */ `
  uniform sampler2D uAct;
  uniform float uFwd;
  uniform float uBwd;
  uniform float uBwdAmt;
  uniform float uFeature;
  uniform float uSel;
  uniform float uTime;
  vec4 neuron(float idx) {
    int i = int(idx + 0.5);
    return texelFetch(uAct, ivec2(i - (i / 32) * 32, i / 32), 0);
  }
  float layerOf(float idx) {
    return idx < 783.5 ? 0.0 : (idx < 847.5 ? 1.0 : (idx < 879.5 ? 2.0 : 3.0));
  }
`;

export const neuronVert = /* glsl */ `
  ${common}
  attribute float aIdx;
  uniform float uScale;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vRing;
  varying float vHot;
  void main() {
    vec4 n = neuron(aIdx);
    float L = layerOf(aIdx);
    float act = n.r;
    float lit = smoothstep(L - 0.05, L + 0.12, uFwd);
    float flare = exp(-pow((uFwd - L) * 5.0, 2.0)) * step(0.02, act);
    float bl = smoothstep(L + 0.12, L - 0.05, uBwd) * uBwdAmt;
    float bflare = exp(-pow((uBwd - L) * 5.0, 2.0)) * uBwdAmt;

    vec3 signal = vec3(1.0, 0.31, 0.12);
    vec3 hot = vec3(1.0, 0.70, 0.54);
    vec3 ice = vec3(0.66, 0.94, 1.0);
    vec3 frost = vec3(0.36, 0.49, 0.98);

    // dormant neuron: a cold, dim glass bead
    vec3 base = vec3(0.075, 0.09, 0.125) * (L < 0.5 ? 0.8 : 1.5);
    float a = act * lit;
    vec3 fire = signal * a * (L < 0.5 ? 1.05 : 1.35) * (1.0 + flare * 1.6);
    vHot = a * a * (L < 0.5 ? 0.35 : 0.8) + flare * 0.8;
    float sel = step(abs(aIdx - uSel), 0.5);
    float feat = (L < 0.5) ? n.b * uFeature : 0.0;
    float dim = 1.0 - uFeature * (L < 0.5 ? 0.9 : 0.55) * (1.0 - sel);
    vec3 col = base + fire * dim;
    // feature heatmap painted onto the input plane: orange excites, frost inhibits
    col += (feat > 0.0 ? signal * 1.25 : frost * 1.1) * abs(feat);
    // backward wave of error, ice blue
    col += ice * (n.g * bl * 1.1 + bflare * 0.5 * n.g) * (L < 0.5 ? 0.0 : 1.0);
    col += ice * sel * uFeature * 1.2;

    vec3 pos = position;
    pos.z += L < 0.5 ? a * 0.45 : 0.0; // lit pixels lift off the input plane
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;
    float size = (L < 0.5 ? 0.17 : (L < 2.5 ? 0.28 : 0.42));
    size *= 1.0 + a * 0.6 + flare * 0.5 + sel * uFeature * 1.2 + abs(feat) * 0.5;
    gl_PointSize = clamp(size * uScale / dist, 1.0, 70.0);
    gl_Position = projectionMatrix * mv;
    vCol = col;
    vRing = sel * uFeature;
    vAlpha = smoothstep(1.2, 5.0, dist) * (1.0 - smoothstep(55.0, 90.0, dist));
  }
`;

export const neuronFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vAlpha;
  varying float vRing;
  varying float vHot;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    float core = smoothstep(0.52, 0.38, d);
    float halo = exp(-d * d * 5.0) * 0.55;
    float ring = smoothstep(0.08, 0.0, abs(d - 0.82)) * vRing;
    float k = core + halo + ring * 1.6;
    vec3 c = vCol * k + vec3(1.0, 0.75, 0.6) * vHot * smoothstep(0.3, 0.0, d);
    gl_FragColor = vec4(c * vAlpha, 1.0);
  }
`;

export const lineVert = /* glsl */ `
  ${common}
  attribute vec4 aInfo; // weight (−1..1), src index, dst index, end (0 at src, 1 at dst)
  varying float vPos;
  varying float vW;
  varying float vFlow;
  varying float vGrad;
  varying float vSel;
  varying float vFade;
  varying float vHash;
  void main() {
    float L = layerOf(aInfo.y);
    vec4 s = neuron(aInfo.y);
    vec4 d = neuron(aInfo.z);
    vPos = L + aInfo.w;
    vW = aInfo.x;
    vFlow = aInfo.x * s.r;                 // signal carried = weight × source activation
    vGrad = d.g * s.r;                     // |dLoss/dw| ∝ |delta_dst| × activation_src
    vSel = step(abs(aInfo.z - uSel), 0.5);
    vHash = fract(sin(aInfo.y * 12.9898 + aInfo.z * 78.233) * 43758.5453);
    vec3 pos = position;
    if (L < 0.5 && aInfo.w < 0.5) pos.z += s.r * smoothstep(-0.05, 0.12, uFwd) * 0.45;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;
    vFade = smoothstep(0.3, 2.5, dist) * (1.0 - smoothstep(50.0, 85.0, dist));
    gl_Position = projectionMatrix * mv;
  }
`;

export const lineFrag = /* glsl */ `
  uniform float uFwd;
  uniform float uBwd;
  uniform float uBwdAmt;
  uniform float uFeature;
  uniform float uTime;
  uniform float uIdle;
  uniform vec3 uGain; // per-layer brightness of the three weight matrices
  varying float vPos;
  varying float vW;
  varying float vFlow;
  varying float vGrad;
  varying float vSel;
  varying float vFade;
  varying float vHash;
  void main() {
    vec3 signal = vec3(1.0, 0.31, 0.12);
    vec3 hot = vec3(1.0, 0.70, 0.54);
    vec3 ice = vec3(0.66, 0.94, 1.0);
    vec3 frost = vec3(0.36, 0.49, 0.98);
    float L = floor(vPos + 1e-3);
    float gain = L < 0.5 ? uGain.x : (L < 1.5 ? uGain.y : uGain.z);
    float aw = abs(vW);

    // idle: the learned weights, cold. pale = positive, frost = negative
    vec3 col = (vW > 0.0 ? vec3(0.32, 0.42, 0.62) : frost * 0.8) * aw * aw * uIdle;

    // forward: lines that carry signal light up behind the wavefront
    float lit = smoothstep(vPos - 0.02, vPos + 0.06, uFwd);
    float head = exp(-pow((uFwd - vPos) * 9.0, 2.0));
    float f = abs(vFlow);
    vec3 flowCol = vFlow > 0.0 ? mix(signal, hot, head * 0.5) : frost * 0.3;
    col += flowCol * f * (lit * 0.5 + head * 2.2) * (1.0 - uFeature * (1.0 - vSel) * 0.9);

    // feature view: the selected neuron's incoming weights, diverging
    col += (vW > 0.0 ? signal : frost) * aw * vSel * uFeature * 1.6;

    // backward: error flows from output to input; gradients flicker as weights adjust
    float bl = smoothstep(vPos + 0.06, vPos - 0.02, uBwd) * uBwdAmt;
    float bhead = exp(-pow((uBwd - vPos) * 9.0, 2.0)) * uBwdAmt;
    float flick = 0.45 + 0.55 * step(0.5, fract(vHash * 7.0 + uTime * (2.0 + vHash * 5.0)));
    vec3 cold = mix(frost, ice, 0.35);
    col += cold * vGrad * (bl * 0.75 * flick + bhead * 2.0);

    float e = fract(vPos + 1e-3);
    float conv = L < 0.5 ? 1.0 - smoothstep(0.35, 0.97, e) * 0.92 : 1.0 - smoothstep(0.5, 1.0, e) * 0.6;
    gl_FragColor = vec4(col * gain * vFade * conv, 1.0);
  }
`;

export const planeVert = /* glsl */ `
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const planeFrag = /* glsl */ `
  uniform vec2 uSize;
  uniform float uGlow;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vec2 px = vUv * uSize;
    vec2 e = min(px, uSize - px);
    float edge = min(e.x, e.y);
    float border = smoothstep(0.035, 0.0, edge);
    // corner brackets
    float corner = step(edge, 0.05) * step(max(e.x, e.y), 0.7);
    vec3 ice = vec3(0.66, 0.94, 1.0);
    float fill = 0.022 + 0.03 * (1.0 - smoothstep(0.0, 0.6, length(vUv - 0.5)));
    vec3 col = ice * (fill + border * 0.10 + corner * 0.55) + vec3(1.0, 0.31, 0.12) * uGlow * fill * 2.5;
    float fade = smoothstep(0.6, 3.0, vDist) * (1.0 - smoothstep(55.0, 90.0, vDist));
    gl_FragColor = vec4(col * fade * uOpacity, 1.0);
  }
`;

export const dustVert = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute float aSeed;
  varying float vA;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.2 + aSeed * 6.28) * 0.4;
    p.x += cos(uTime * 0.17 + aSeed * 4.0) * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_PointSize = clamp((0.05 + aSeed * 0.07) * uScale / dist, 1.0, 6.0);
    vA = smoothstep(0.5, 4.0, dist) * (1.0 - smoothstep(30.0, 70.0, dist)) * (0.25 + aSeed * 0.5);
    gl_Position = projectionMatrix * mv;
  }
`;

export const dustFrag = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(vec3(0.55, 0.7, 0.9) * smoothstep(1.0, 0.0, d) * vA * 0.5, 1.0);
  }
`;
