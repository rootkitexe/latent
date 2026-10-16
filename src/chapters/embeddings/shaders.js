// Stars: one GL point per word. aState: 0 idle · 1 neighbour · 2 focus/query · 3 operand · 4 answer
export const starVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aState;
  uniform float uTime, uReveal, uDim, uGlow, uPx, uHover, uPulse, uAmp;
  uniform vec3 uOrigin, uSignal, uIce;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCore;

  void main() {
    float r = clamp(uReveal * 1.55 - aSeed * 0.55, 0.0, 1.0);
    r = 1.0 - pow(1.0 - r, 3.0);
    vec3 p = mix(uOrigin, position, r);
    // slow drift so the galaxy breathes
    p += 0.07 * vec3(sin(uTime * 0.31 + aSeed * 40.0), cos(uTime * 0.27 + aSeed * 31.0), sin(uTime * 0.23 + aSeed * 17.0)) * r;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;

    bool hover = abs(float(gl_VertexID) - uHover) < 0.5;
    float s = aSize;
    vec3 c = aColor;
    float a = 1.0;
    float core = 0.0;
    if (aState > 3.5) {            // answer — fires
      s *= 4.2 + uPulse * 1.2; c = uSignal * (2.4 + uPulse * 1.2); core = 1.0;
    } else if (aState > 2.5) {     // operands of the arithmetic
      s *= 3.0; c = mix(uIce, vec3(1.0), 0.35) * 1.5; core = 0.6;
    } else if (aState > 1.5) {     // query word — fires
      s *= 4.0 * uAmp; c = uSignal * (0.6 + 1.7 * uAmp); core = 1.0;
    } else if (aState > 0.5) {     // neighbours
      s *= 2.5; c = mix(aColor, uIce, 0.6) * 1.45; core = 0.6;
    } else {
      c *= (1.0 - uDim * 0.75) * (1.2 + uGlow * 0.7);
      s *= 1.0 + uGlow * 0.35;
      a = mix(1.0, 0.55, uDim);
    }
    if (hover) { s *= 1.9; c = max(c, vec3(1.25)); core = max(core, 0.5); }
    // visible only once released from the origin (except highlighted words)
    float vis = aState > 0.5 ? 1.0 : smoothstep(0.02, 0.35, r);
    // depth fog: far stars sink into the void, too-near stars fade instead of covering the screen
    float fog = smoothstep(150.0, 25.0, depth) * smoothstep(0.6, 3.5, depth);
    vColor = c;
    vAlpha = a * vis * fog;
    vCore = core;
    gl_PointSize = clamp(s * uPx / depth, 1.4, 110.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const starFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCore;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d2 = dot(q, q);
    if (d2 > 0.25) discard;
    float core = exp(-d2 * 70.0);
    float halo = exp(-d2 * 14.0) * (0.28 + vCore * 0.3);
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

// Nebulae: huge soft sprites behind each cluster.
export const nebulaVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime, uPx, uAmt;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec3 p = position + vec3(sin(uTime * 0.05 + aSeed * 6.28), cos(uTime * 0.04 + aSeed * 5.0), 0.0) * 0.8;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    vColor = aColor;
    vSeed = aSeed;
    vAlpha = uAmt * smoothstep(160.0, 30.0, depth) * smoothstep(2.0, 14.0, depth);
    gl_PointSize = min(aSize * uPx * 1.1 / depth, 900.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const nebulaFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d2 = dot(q, q) * 4.0;
    if (d2 > 1.0) discard;
    // soft gaussian with a slightly lumpy edge
    float ang = atan(q.y, q.x);
    float lump = 1.0 + 0.18 * sin(ang * 3.0 + vSeed * 20.0) + 0.1 * sin(ang * 5.0 - vSeed * 13.0);
    float a = exp(-d2 * 3.2 * lump) * (1.0 - d2) * 0.05 * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;
