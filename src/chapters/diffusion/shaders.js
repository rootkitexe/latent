import { GLSL_ALPHABAR } from './schedule';

/**
 * Every particle evaluates the forward process in closed form:
 *   x_t = √ᾱ_t · x_0 + √(1 − ᾱ_t) · ε
 * ε is a rotation of two independent standard normals (cos φ·ε₁ + sin φ·ε₂), which is itself
 * exactly N(0, I) for any φ — rotating φ during sampling re-injects fresh noise (stochastic sampler)
 * without breaking the marginal q(x_t | x_0).
 * Per-particle timestep t_i = clamp(uT + brushDelta_i, 0, T) lets the brush denoise locally.
 */
const COMMON = /* glsl */ `
uniform float uT;
uniform float uPhi;
uniform float uTime;
uniform float uLight;
attribute vec3 aE1;
attribute vec3 aE2;
attribute vec4 aR;   // x size rand · y highlight · z phase rand · w flicker rand
attribute vec2 aB;   // x brush Δt · y heat
${GLSL_ALPHABAR}
vec3 noiseVec(out float ab, out float tl) {
  tl = clamp(uT + aB.x, 0.0, 1000.0);
  ab = alphaBar(tl);
  float phi = uPhi * (0.55 + 0.9 * aR.z);
  return cos(phi) * aE1 + sin(phi) * aE2;
}
`;

export const pointsVert = /* glsl */ `
${COMMON}
uniform float uSize;
uniform float uPR;
uniform float uAct;
uniform float uHi;
uniform vec3 uInk;
uniform vec3 uPaper;
varying vec3 vCol;
varying float vA;
varying float vGlow;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float ab, tl;
  vec3 eps = noiseVec(ab, tl);
  vec3 p = sqrt(max(ab, 1e-9)) * position + sqrt(max(1.0 - ab, 1e-9)) * eps;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  float clean = smoothstep(0.35, 1.0, ab);
  float sz = uSize * (0.55 + 0.9 * aR.x) * uPR * (7.0 / d);
  sz *= mix(1.15, 1.0, clean);
  // depth cue: far = smaller + lighter
  float fog = smoothstep(4.0, 10.0, d);
  // ink on paper (or paper-white on void before the lights come on)
  vec3 ink = mix(uPaper * 0.92, uInk, uLight);
  // activation: highlight features as they resolve, brushed particles, sampler sparkle
  float hiOn = aR.y * smoothstep(0.93, 0.998, ab) * uHi;
  float spark = step(1.0 - 0.012 * uAct, hash(aR.w * 91.7 + floor(uTime * 9.0 + aR.w * 7.0)));
  float glow = max(max(hiOn, aB.y * 0.45), spark * 0.8);
  vGlow = glow;
  vCol = ink;
  vA = mix(0.78, 0.5, 1.0 - clean) * mix(1.0, 0.35, fog);
  gl_PointSize = max(1.0, sz * mix(1.0, 1.6, glow));
}
`;

export const pointsFrag = /* glsl */ `
uniform vec3 uSignal;
uniform float uHdr;
varying vec3 vCol;
varying float vA;
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.28, r) * vA;
  vec3 col = mix(vCol, uSignal * uHdr, vGlow);
  gl_FragColor = vec4(col, mix(a, smoothstep(0.5, 0.0, r), vGlow));
}
`;

/** −ε̂ vectors: from x_t along the step the denoiser takes (scaled up to be visible). */
export const vecVert = /* glsl */ `
${COMMON}
attribute float aEnd;
uniform float uLen;
uniform float uShow;
varying float vA;
varying float vEnd;
void main() {
  float ab, tl;
  vec3 eps = noiseVec(ab, tl);
  vec3 p = sqrt(max(ab, 1e-9)) * position + sqrt(max(1.0 - ab, 1e-9)) * eps;
  // one-step x̂_0 direction: −√(1−ᾱ)·ε̂, drawn at uLen of its full length
  p -= aEnd * uLen * sqrt(max(1.0 - ab, 1e-9)) * eps;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vEnd = aEnd;
  vA = uShow * smoothstep(0.0, 0.25, 1.0 - ab) * mix(1.0, 0.35, smoothstep(4.0, 10.0, -mv.z));
}
`;

export const vecFrag = /* glsl */ `
uniform vec3 uSignal;
uniform vec3 uInk;
varying float vA;
varying float vEnd;
void main() {
  vec3 col = mix(uInk, uSignal * 1.4, vEnd);
  gl_FragColor = vec4(col, vA * mix(0.08, 0.32, vEnd));
}
`;
