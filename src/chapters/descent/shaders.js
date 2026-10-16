/** GLSL for the descent chapter: terrain, trail ribbons, step markers, sky. */

const HV = /* glsl */ `
  // Visual height: loss is shown 1:1 up to 3, then compressed so the far walls stay on screen.
  float hv(float L) { return L < 3.0 ? L : 3.0 + 10.0 * (1.0 - exp(-(L - 3.0) / 10.0)); }
  float hvd(float L) { return L < 3.0 ? 1.0 : exp(-(L - 3.0) / 10.0); }
`;

export const terrainVert = /* glsl */ `
  attribute vec2 aP;   // weight-space (w1, w2)
  attribute vec3 aL;   // loss, dL/dw1, dL/dw2
  uniform float uRise;
  uniform vec2 uMin;
  uniform float uH;
  uniform float uS;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec2 vP;
  varying float vL;
  varying float vSlope;
  varying float vFront;
  ${HV}
  void main() {
    float d = length(aP - uMin);
    float fr = uRise * 15.0;
    float k = clamp((fr - d) / 2.0, 0.0, 1.0);
    float rf = k * k * (3.0 - 2.0 * k);
    vec3 pos = vec3(position.x, hv(aL.x) * uH * rf, position.z);
    float sc = uH * rf * hvd(aL.x) / uS;
    vN = normalize(vec3(-aL.y * sc, 1.0, aL.z * sc));
    vP = aP;
    vL = aL.x;
    vSlope = length(aL.yz);
    vFront = fr - d - 1.0;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const terrainFrag = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  uniform float uPlay;
  uniform vec4 uHover;      // w1, w2, strength
  uniform vec4 uTarget;     // w1, w2, strength
  uniform vec4 uGlow[4];    // w1, w2, strength
  uniform vec3 uGlowCol[4];
  uniform vec4 uPulse[6];   // w1, w2, t0, kind (0 signal, 1 ice)
  uniform vec3 uIce;
  uniform vec3 uFrost;
  uniform vec3 uSignal;
  uniform vec3 uFog;
  uniform vec3 uBase;
  uniform float uFogD;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec2 vP;
  varying float vL;
  varying float vSlope;
  varying float vFront;

  float iso(float x, float w) {
    float d = fwidth(x);
    float f = abs(fract(x - 0.5) - 0.5);
    return 1.0 - smoothstep(d * (w - 0.5), d * (w + 0.5), f);
  }
  float ringAt(float r, float R, float w) {
    float d = fwidth(r);
    return 1.0 - smoothstep(d * (w - 0.5), d * (w + 0.5), abs(r - R));
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(vWorld - cameraPosition);

    // graphite, lit by a cold low key from behind + hemisphere fill + a fresnel rim
    vec3 key = normalize(vec3(-0.45, 0.5, -0.75));
    float dif = max(dot(N, key), 0.0);
    float hemi = 0.5 + 0.5 * N.y;
    vec3 col = uBase * (0.55 * hemi + 1.6 * dif);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col += uFrost * fres * 0.05;

    // topographic isolines: minor every 0.2 loss, major every 1.0
    float slope = smoothstep(0.08, 1.3, vSlope);
    vec3 cCol = mix(uFrost * 0.55, uIce, slope);
    float fw = fwidth(vL * 5.0);
    float fadeC = 1.0 - smoothstep(0.28, 0.75, fw);
    float minor = iso(vL * 5.0, 1.0);
    float major = iso(vL, 1.7);
    float near = exp(-dist * 0.012);
    col += cCol * (minor * 0.16 + major * 0.34) * fadeC * (0.55 + 0.45 * near);
    // the global valley floor glows faintly
    col += uIce * 0.035 * exp(-vL * 7.0);

    // weight grid every 0.5 (fine) — the instrument's graticule
    vec2 g = vP * 2.0;
    float gfade = 1.0 - smoothstep(0.25, 0.6, max(fwidth(g.x), fwidth(g.y)));
    float grid = max(iso(g.x, 0.8), iso(g.y, 0.8));
    float inPlay = step(max(abs(vP.x), abs(vP.y)), uPlay);
    col += vec3(0.5, 0.6, 0.75) * grid * 0.022 * gfade * (0.35 + 0.65 * inPlay);

    // playable boundary + ticks
    float bx = max(abs(vP.x), abs(vP.y));
    float bline = 1.0 - smoothstep(0.0, fwidth(bx) * 1.5, abs(bx - uPlay));
    col += vec3(0.55, 0.62, 0.75) * bline * 0.12;

    // hover probe: crosshair along both weight axes + ring
    vec2 dh = vP - uHover.xy;
    float rh = length(dh);
    float cx = 1.0 - smoothstep(0.0, fwidth(vP.x) * 1.2, abs(dh.x));
    float cy = 1.0 - smoothstep(0.0, fwidth(vP.y) * 1.2, abs(dh.y));
    float cross = min(cx + cy, 1.0) * exp(-rh * 0.7) * inPlay;
    col += uIce * cross * 0.16 * uHover.z;
    col += uIce * ringAt(rh, 0.16, 1.4) * 0.7 * uHover.z;
    col += uIce * ringAt(rh, 0.3 + 0.04 * sin(uTime * 3.0), 1.0) * 0.18 * uHover.z;

    // next-step target (orange): where w − lr·∇L will land
    vec2 dt = vP - uTarget.xy;
    float rt = length(dt);
    col += uSignal * ringAt(rt, 0.085, 1.6) * 1.6 * uTarget.z;
    col += uSignal * exp(-rt * rt * 900.0) * 1.2 * uTarget.z;

    // warm glow under live balls
    for (int i = 0; i < 4; i++) {
      vec2 d = vP - uGlow[i].xy;
      col += uGlowCol[i] * uGlow[i].z * exp(-dot(d, d) * 26.0) * 0.5;
    }

    // expanding rings (landings, convergence)
    for (int i = 0; i < 6; i++) {
      float age = uTime - uPulse[i].z;
      if (age > 0.0 && age < 2.2) {
        float r = length(vP - uPulse[i].xy);
        float R = 0.05 + age * 0.75;
        float a = pow(1.0 - age / 2.2, 2.0);
        vec3 pc = uPulse[i].w < 0.5 ? uSignal * 2.2 : uIce * 1.1;
        col += pc * ringAt(r, R, 1.8) * a;
      }
    }

    // rising wave front
    col += uIce * 0.5 * exp(-abs(vFront) * 2.5) * (1.0 - smoothstep(0.85, 1.0, uRise)) * step(0.001, uRise);

    // fog into the void
    float fog = 1.0 - exp(-pow(dist * uFogD, 1.7));
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Screen-space ribbons, one instanced quad per trail segment, ring-buffered. */
export const trailVert = /* glsl */ `
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec3 iColor;
  attribute vec4 iMeta;    // birth, life, half-width px, intensity
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uClear;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vY;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(iA, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(iB, 1.0);
    vec2 sa = a.xy / a.w;
    vec2 sb = b.xy / b.w;
    vec2 dir = (sb - sa) * uRes;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 p = mix(a, b, position.x);
    p.xy += nrm * position.y * iMeta.z * 2.0 / uRes * p.w;
    gl_Position = p;
    float age = uTime - iMeta.x;
    float al = iMeta.w * exp(-age / max(iMeta.y, 1e-4));
    if (iMeta.x < uClear) al *= clamp(1.0 - (uTime - uClear) / 0.6, 0.0, 1.0);
    vAlpha = al;
    vColor = iColor;
    vY = position.y;
  }
`;

export const trailFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vY;
  void main() {
    if (vAlpha < 0.003) discard;
    float prof = 1.0 - vY * vY;
    gl_FragColor = vec4(vColor * vAlpha * prof, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Step markers: tiny glowing ticks where each step landed. */
export const markVert = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aMeta;    // birth, life, size, intensity
  uniform float uTime;
  uniform float uClear;
  uniform float uPx;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float age = uTime - aMeta.x;
    float pop = smoothstep(0.0, 0.12, age);
    float al = aMeta.w * exp(-age / max(aMeta.y, 1e-4));
    if (aMeta.x < uClear) al *= clamp(1.0 - (uTime - uClear) / 0.6, 0.0, 1.0);
    vAlpha = al;
    vColor = aColor;
    gl_PointSize = aMeta.z * uPx * (0.6 + 0.4 * pop) / -mv.z;
  }
`;

export const markFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.003) discard;
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float core = 1.0 - smoothstep(0.18, 0.32, r);
    float ring = (1.0 - smoothstep(0.06, 0.14, abs(r - 0.7))) * 0.6;
    float a = max(core, ring) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Sky dome: near-black with a faint cold horizon band so the terrain's silhouette reads. */
export const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

export const skyFrag = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    float band = exp(-abs(h - 0.02) * 9.0);
    vec3 col = mix(uFog, uHorizon, band);
    col *= 1.0 - smoothstep(0.1, 0.8, h) * 0.6;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
