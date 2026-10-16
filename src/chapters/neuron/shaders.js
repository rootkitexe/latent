/* GLSL for the neuron chapter. All colours are converted sRGB → linear in-shader (the composer
 * converts back on output), and anything that should bloom is pushed above 1.0. */

export const COMMON = /* glsl */ `
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
// Thin-film iridescence: view-angle hue shift ice -> frost -> violet -> faint signal at grazing.
vec3 thinFilm(float ndv){
  float f = 1.0 - clamp(ndv, 0.0, 1.0);
  vec3 ice = lin(vec3(0.659, 0.941, 1.0));
  vec3 frost = lin(vec3(0.361, 0.486, 0.980));
  vec3 violet = lin(vec3(0.56, 0.38, 0.96));
  vec3 sig = lin(vec3(1.0, 0.31, 0.12));
  vec3 c = mix(ice, frost, smoothstep(0.15, 0.5, f));
  c = mix(c, violet, smoothstep(0.5, 0.82, f));
  c = mix(c, sig, smoothstep(0.86, 1.0, f) * 0.55);
  return c;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

/* ---------- Glass shell (soma, orbs): transparent thin-film fresnel ---------- */
export const shellVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const shellFrag = /* glsl */ `
${COMMON}
uniform float uFire; uniform float uOpacity; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndv = abs(dot(n, normalize(vV)));
  float f = pow(1.0 - ndv, 2.4);
  vec3 film = thinFilm(ndv + 0.06 * sin(vP.y * 9.0 + uTime * 0.6));
  // key light highlight (fixed, top-left-front)
  vec3 L = normalize(vec3(-0.5, 0.8, 0.6));
  vec3 H = normalize(L + normalize(vV));
  float spec = pow(max(dot(n, H), 0.0), 260.0) * 0.75;
  vec3 L2 = normalize(vec3(0.9, -0.2, 0.3));
  float spec2 = pow(max(dot(n, normalize(L2 + normalize(vV))), 0.0), 40.0) * 0.35;
  vec3 col = film * (0.05 + f * 1.1) + vec3(spec + spec2);
  col += lin(vec3(1.0, 0.31, 0.12)) * uFire * (0.25 + f * 1.8);
  float a = clamp(0.05 + f * 0.85 + spec, 0.0, 1.0) * uOpacity;
  if (!gl_FrontFacing) { col *= 0.35; a *= 0.45; }
  gl_FragColor = vec4(col, a);
}`;

/* ---------- Liquid inside the soma: level = z, cut surface rendered from back faces ---------- */
export const liquidVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const liquidFrag = /* glsl */ `
${COMMON}
uniform float uLevel; uniform float uBias; uniform vec3 uColor; uniform float uGlow; uniform float uFire; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  float wave = sin(vP.x * 7.0 + uTime * 2.1) * 0.016 + sin(vP.z * 9.0 - uTime * 1.7) * 0.012
             + sin((vP.x + vP.z) * 15.0 + uTime * 3.3) * 0.006 * (0.5 + uFire);
  float lv = uLevel + wave;
  if (vP.y > lv) discard;
  vec3 n = normalize(vN);
  float ndv = abs(dot(n, normalize(vV)));
  float depth = lv - vP.y;
  vec3 col;
  vec3 hot = lin(vec3(1.0, 0.70, 0.54));
  if (!gl_FrontFacing) {
    // the cut surface (we see the inside back faces through the opening)
    float ripple = 0.5 + 0.5 * sin(length(vP.xz) * 26.0 - uTime * 3.0);
    col = uColor * (0.75 + uGlow * 0.3 + uFire * 1.2) + hot * uFire * 0.5 + uColor * 0.12 * ripple;
  } else {
    float bubbles = step(0.985, hash(floor(vec2(atan(vP.z, vP.x) * 18.0, (vP.y - uTime * 0.35) * 22.0))));
    float swirl = sin(vP.x * 5.0 + sin(vP.y * 7.0 + uTime * 0.8) * 1.6 + uTime * 0.6) * 0.5 + 0.5;
    col = uColor * (0.1 + 0.55 * exp(-depth * 3.2) + 0.1 * swirl) * (0.75 + uGlow * 0.35);
    col += uColor * pow(1.0 - ndv, 3.0) * 0.7;
    col += vec3(bubbles) * 0.25 * uColor;
    // meniscus line
    col += uColor * smoothstep(0.035, 0.0, depth) * 0.6;
    // bias line: where the liquid "started"
    col += vec3(0.9) * smoothstep(0.008, 0.0, abs(vP.y - uBias)) * 0.6;
    col += uColor * uFire * (0.4 + 1.2 * exp(-depth * 3.0)) + hot * uFire * 0.15;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/* ---------- Dendrite: glass tube; light = x before the weight ring, = w·x after ---------- */
export const tubeVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const tubeFrag = /* glsl */ `
${COMMON}
uniform float uX; uniform float uContrib; uniform vec3 uCColor; uniform float uRing; uniform float uTime; uniform float uFocus;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  float t = vUv.x;
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - ndv, 2.2);
  vec3 col = thinFilm(ndv) * rim * 0.75;
  float core = pow(ndv, 4.0);
  float pre = 1.0 - smoothstep(uRing - 0.012, uRing + 0.012, t);
  // travelling packets of light
  float speedPre = 0.6 + uX * 1.6;
  float pk = fract(t * 9.0 - uTime * speedPre);
  float packet = smoothstep(0.0, 0.08, pk) * smoothstep(0.55, 0.12, pk);
  float k = abs(uContrib);
  float pk2 = fract(t * 9.0 - uTime * (0.5 + k * 1.2));
  float packet2 = smoothstep(0.0, 0.08, pk2) * smoothstep(0.55, 0.12, pk2);
  vec3 ice = lin(vec3(0.75, 0.96, 1.0));
  vec3 preCol = ice * uX * (0.22 + 0.95 * packet);
  vec3 postCol = uCColor * min(k, 1.6) * (0.25 + 0.95 * packet2) * 0.95;
  vec3 light = mix(postCol, preCol, pre);
  // fade in from the orb, fade into the soma
  float ends = smoothstep(0.0, 0.05, t);
  col += light * (core * 1.1 + 0.12) * ends;
  float a = clamp(rim * 0.85 + core * length(light) * 1.2 + 0.03, 0.0, 1.0);
  col *= 0.6 + 0.4 * uFocus;
  gl_FragColor = vec4(col, a);
}`;

/* ---------- Axon: carries firing pulses (HDR orange → bloom) ---------- */
export const axonFrag = /* glsl */ `
${COMMON}
uniform vec4 uPulse; uniform vec4 uAmp; uniform float uTime; uniform float uLevel;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
float pulse(float t, float p, float a){
  if (p < 0.0) return 0.0;
  float head = exp(-pow((t - p) * 55.0, 2.0));
  float tail = step(t, p) * exp(-(p - t) * 14.0) * 0.55;
  return (head * 2.2 + tail) * a;
}
void main(){
  float t = vUv.x;
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - ndv, 2.2);
  vec3 col = thinFilm(ndv) * rim * 0.55;
  float core = pow(ndv, 3.0);
  float e = pulse(t, uPulse.x, uAmp.x) + pulse(t, uPulse.y, uAmp.y) + pulse(t, uPulse.z, uAmp.z) + pulse(t, uPulse.w, uAmp.w);
  vec3 sig = lin(vec3(1.0, 0.31, 0.12));
  vec3 hot = lin(vec3(1.0, 0.70, 0.54));
  col += mix(sig, hot, clamp(e - 1.0, 0.0, 1.0)) * e * (core * 2.6 + 0.25);
  // idle glow proportional to output level, very dim
  col += sig * uLevel * 0.05 * core;
  float fade = 1.0 - smoothstep(0.75, 1.0, t);
  float a = clamp(rim * 0.7 + e * core + 0.02, 0.0, 1.0) * fade;
  gl_FragColor = vec4(col * fade, a);
}`;

/* ---------- Activation ribbon: the curve is computed in the vertex shader and morphs ---------- */
export const ACT_GLSL = /* glsl */ `
float tanhF(float x){ float e = exp(2.0 * clamp(x, -10.0, 10.0)); return (e - 1.0) / (e + 1.0); }
float actF(float id, float z){
  if (id < 0.5) return z > 0.0 ? 1.0 : 0.0;
  if (id < 1.5) return 1.0 / (1.0 + exp(-z));
  if (id < 2.5) return tanhF(z);
  return max(0.0, z);
}`;
export const ribbonVert = /* glsl */ `
${ACT_GLSL}
uniform float uFrom; uniform float uTo; uniform float uMix; uniform float uW; uniform float uZMax; uniform float uDepth;
varying vec2 vUv; varying float vY; varying float vZ;
void main(){
  vUv = uv;
  float z = mix(-uZMax, uZMax, uv.x);
  float y = mix(actF(uFrom, z), actF(uTo, z), uMix);
  // screen-ish thickness: offset along the curve normal (finite difference) + depth for a 3D ribbon
  float dz = 2.0 * uZMax / 400.0;
  float y2 = mix(actF(uFrom, z + dz), actF(uTo, z + dz), uMix);
  float y0 = mix(actF(uFrom, z - dz), actF(uTo, z - dz), uMix);
  vec2 tng = normalize(vec2(2.0 * dz * uW / (2.0 * uZMax), y2 - y0));
  vec2 nrm = vec2(-tng.y, tng.x);
  float v = uv.y - 0.5;
  vY = y; vZ = z;
  vec3 p = vec3((uv.x - 0.5) * uW + nrm.x * v * 0.05, y + nrm.y * v * 0.05, v * uDepth);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
export const ribbonFrag = /* glsl */ `
${COMMON}
uniform float uZ; uniform float uYMax; uniform float uYMin; uniform float uFire; uniform float uTime;
varying vec2 vUv; varying float vY; varying float vZ;
void main(){
  if (vY > uYMax || vY < uYMin) discard;
  float edge = smoothstep(0.38, 0.5, abs(vUv.y - 0.5));
  float centre = 1.0 - smoothstep(0.0, 0.08, abs(vUv.y - 0.5));
  vec3 ice = lin(vec3(0.659, 0.941, 1.0));
  vec3 frost = lin(vec3(0.361, 0.486, 0.980));
  vec3 sig = lin(vec3(1.0, 0.31, 0.12));
  vec3 base = mix(frost, ice, smoothstep(-4.0, 4.0, vZ));
  // the part of the curve already "swept" by the current z glows
  float swept = 1.0 - smoothstep(uZ - 0.02, uZ + 0.02, vZ);
  float near = exp(-pow((vZ - uZ) * 2.2, 2.0));
  vec3 col = base * (0.10 + edge * 0.5 + centre * 0.35);
  col += base * swept * 0.25;
  col += mix(ice, sig, uFire) * near * (0.5 + uFire * 0.9);
  // scanning shimmer
  col += ice * 0.12 * smoothstep(0.96, 1.0, sin(vZ * 2.0 - uTime * 2.5));
  float a = clamp(0.18 + edge * 0.7 + centre * 0.4 + near * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

/* ---------- Dial ticks around the soma (output gauge) ---------- */
export const tickVert = /* glsl */ `
attribute float aIdx;
varying float vIdx;
void main(){ vIdx = aIdx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const tickFrag = /* glsl */ `
${COMMON}
uniform float uVal; uniform float uFire; uniform float uN; uniform float uOpacity;
varying float vIdx;
void main(){
  float f = vIdx / uN;
  float lit = step(f, uVal);
  vec3 ice = lin(vec3(0.659, 0.941, 1.0));
  vec3 sig = lin(vec3(1.0, 0.31, 0.12));
  vec3 col = mix(vec3(0.07), mix(ice * 0.6, sig * (0.8 + uFire * 1.2), clamp(uFire * 1.6, 0.0, 1.0)), lit);
  float major = step(0.5, fract(vIdx / 10.0 + 0.05) ) ;
  gl_FragColor = vec4(col, (0.35 + lit * 0.65) * uOpacity);
}`;

/* ---------- Decision plane: clipped to the data cube, glowing where it cuts the walls ---------- */
export const planeVert = /* glsl */ `
uniform mat4 uBoxInv;
varying vec3 vB; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vB = (uBoxInv * wp).xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const planeFrag = /* glsl */ `
${COMMON}
uniform float uHalf; uniform float uTime; uniform float uOpacity; uniform float uPulse;
varying vec3 vB; varying vec2 vUv;
void main(){
  vec3 d = uHalf - abs(vB);
  float m = min(d.x, min(d.y, d.z));
  if (m < 0.0) discard;
  float edge = smoothstep(0.045, 0.0, m);
  vec2 g = abs(fract(vUv * 28.0) - 0.5);
  float grid = smoothstep(0.47, 0.5, max(g.x, g.y));
  vec3 sig = lin(vec3(1.0, 0.31, 0.12));
  vec3 ice = lin(vec3(0.659, 0.941, 1.0));
  vec3 side = gl_FrontFacing ? sig : ice;
  float scan = smoothstep(0.985, 1.0, sin((vUv.x + vUv.y) * 40.0 - uTime * 2.0));
  vec3 col = side * 0.10 + ice * grid * 0.16 + side * scan * 0.15;
  col += mix(ice, sig, 0.55) * edge * (1.6 + uPulse * 1.5);
  float a = (0.16 + grid * 0.18 + edge * 0.8 + scan * 0.1) * uOpacity;
  gl_FragColor = vec4(col, a);
}`;

/* ---------- Halo: fresnel sphere that reads as a ring from any angle ---------- */
export const haloFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime;
varying vec3 vN; varying vec3 vV;
void main(){
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float r = smoothstep(0.45, 0.1, ndv) * smoothstep(0.0, 0.1, ndv);
  float blink = 0.55 + 0.45 * sin(uTime * 7.0);
  gl_FragColor = vec4(uColor * r * blink, r * blink);
}`;
export const haloVert = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/* ---------- Dust ---------- */
export const dustVert = /* glsl */ `
uniform float uTime; uniform float uSize;
attribute float aSeed;
varying float vA;
void main(){
  vec3 p = position;
  p.y += sin(uTime * 0.13 + aSeed * 6.28) * 0.35;
  p.x += cos(uTime * 0.09 + aSeed * 12.0) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.4 + aSeed) * (8.0 / -mv.z);
  vA = (0.25 + 0.75 * fract(aSeed * 7.31)) * smoothstep(40.0, 6.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
export const dustFrag = /* glsl */ `
${COMMON}
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA * 0.5;
  gl_FragColor = vec4(lin(vec3(0.66, 0.9, 1.0)) * 0.6, a);
}`;
