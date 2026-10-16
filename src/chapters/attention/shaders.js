import * as THREE from 'three';

/** Shared fog uniforms (mutated by the scene; every custom material references these objects). */
export const fogU = {
  uFogColor: { value: new THREE.Color('#050506') },
  uFogDensity: { value: 0.028 },
};
export const timeU = { value: 0 };

const FOG = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 c, float d){ float f = 1.0 - exp(-uFogDensity*uFogDensity*d*d); return mix(c, uFogColor, clamp(f,0.,1.)); }
`;

// linear-space house palette
const PALETTE = /* glsl */ `
  const vec3 ICE = vec3(0.392, 0.871, 1.0);
  const vec3 FROST = vec3(0.107, 0.202, 0.955);
  const vec3 VIOLET = vec3(0.456, 0.262, 1.0);
  const vec3 SIGNAL = vec3(1.0, 0.078, 0.0137);
  const vec3 SIGNAL_HOT = vec3(1.0, 0.45, 0.25);
  vec3 film(float x){
    x = fract(x);
    vec3 c = mix(ICE, FROST, smoothstep(0.0, 0.32, x));
    c = mix(c, VIOLET, smoothstep(0.32, 0.6, x));
    c = mix(c, SIGNAL * 0.55, smoothstep(0.62, 0.8, x));
    c = mix(c, ICE, smoothstep(0.82, 1.0, x));
    return c;
  }
  float hash11(float p){ p = fract(p*0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
`;

/* ------------------------------------------------------------------------------------------ glass slab
 * Thin-film iridescent smoked glass with bevel fresnel, a fake softbox reflection, and emissive rims
 * that light up with attention weight (uAttn, in the head colour) or selection (uSel, signal orange).
 */
const slabVert = /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN; varying float vDepth;
  varying float vLayer; varying float vRand;
  #ifdef TOWER
    attribute float aLayer; attribute float aRand;
    uniform float uStack;
  #endif
  void main(){
    vec3 p = position;
    vL = position; vLN = normal;
    vLayer = 0.0; vRand = 0.0;
    vec4 lp = vec4(p, 1.0);
    mat3 nm = mat3(modelMatrix);
    #ifdef USE_INSTANCING
      #ifdef TOWER
        float rv = clamp(uStack - aLayer, 0.0, 1.0);
        rv = 1.0 - pow(1.0 - rv, 3.0);
        lp.xyz *= vec3(1.0, rv, mix(0.2, 1.0, rv));
        vLayer = aLayer; vRand = aRand;
      #endif
      lp = instanceMatrix * lp;
      nm = nm * mat3(instanceMatrix);
    #endif
    vec4 wp = modelMatrix * lp;
    vW = wp.xyz;
    vN = normalize(nm * normal);
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const slabFrag = /* glsl */ `
  uniform vec3 uHalf; uniform float uTime; uniform float uSel; uniform float uAttn; uniform float uHover;
  uniform float uFlash; uniform float uDim; uniform vec3 uAttnColor;
  varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN; varying float vDepth;
  varying float vLayer; varying float vRand;
  ${PALETTE}
  ${FOG}
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.2);
    float front = smoothstep(0.6, 0.95, vLN.z);
    float bevel = 1.0 - front;
    float th = 0.32 + 0.22*sin(vL.x*2.3 + vL.y*3.1 + uTime*0.15) + 0.14*sin(vW.x*0.7 + vW.y*0.4 - uTime*0.05);
    vec3 irid = film(th + fres*1.1 + (1.0 - ndv)*0.3);
    vec3 R = reflect(-V, N);
    float soft = smoothstep(0.35, 0.95, R.y);
    float strip = smoothstep(0.06, 0.0, abs(R.x + 0.25 - 0.15*R.y)) * smoothstep(-0.3, 0.4, R.y);
    // distance to the face border (local units)
    vec2 a = uHalf.xy - abs(vL.xy);
    float dE = min(a.x, a.y);
    float rim = 1.0 - smoothstep(0.0, 0.06, dE);
    float inner = 1.0 - smoothstep(0.0, 1.0, length(vL.xy / uHalf.xy));
    float vy = clamp(vL.y / uHalf.y * 0.5 + 0.5, 0.0, 1.0);
    #ifdef TOWER
      float filmK = 0.45;
    #else
      float filmK = 1.0;
    #endif
    // smoked glass body: a sky gradient caught in the glass, film colour mostly at grazing angles & bevels
    vec3 col = mix(vec3(0.003, 0.004, 0.006), vec3(0.016, 0.02, 0.032), vy);
    col += irid * (0.022 + 0.42 * fres) * filmK;
    col += irid * bevel * (0.22 + 0.55 * fres) * filmK;
    col += mix(vec3(0.7, 0.8, 1.0), irid, 0.5) * (soft * 0.12 + strip * 0.22) * filmK;
    col += irid * rim * front * 0.16;
    // a slow sheen sweeping across the glass
    float sw = fract(vL.x / uHalf.x * 0.18 + vL.y / uHalf.y * 0.32 + vW.x * 0.035 - uTime * 0.06);
    col += mix(vec3(0.8, 0.9, 1.0), irid, 0.4) * exp(-pow((sw - 0.5) * 14.0, 2.0)) * front * 0.05;
    // a faint scanline grain inside the glass
    col += irid * 0.008 * step(0.5, fract(vL.y * 38.0));
    #ifdef TOWER
      float on = step(0.88, hash11(vRand*91.7 + floor(uTime*1.7 + vRand*13.0)));
      vec3 hc = vRand < 0.25 ? SIGNAL : vRand < 0.5 ? ICE : vRand < 0.75 ? VIOLET : vec3(0.22,1.0,0.65);
      col += hc * on * (rim * 2.2 + 0.08);
      col += ICE * rim * 0.035;
    #else
      float g = uAttn;
      col += uAttnColor * g * (0.22 * inner + 0.06 + rim * (1.4 + 2.6 * g));
      col += SIGNAL * uSel * (rim * 3.2 + inner * 0.3 + 0.05);
      col += SIGNAL_HOT * uSel * rim * front * 0.6;
      col += ICE * uHover * (rim * 0.9 + 0.04);
      col += ICE * uFlash * (rim * 2.5 + 0.4);
      col *= 1.0 - 0.72 * uDim;
    #endif
    col = applyFog(col, vDepth);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function makeSlabUniforms(half) {
  return {
    uHalf: { value: new THREE.Vector3(...half) },
    uTime: timeU,
    uSel: { value: 0 },
    uAttn: { value: 0 },
    uHover: { value: 0 },
    uFlash: { value: 0 },
    uDim: { value: 0 },
    uAttnColor: { value: new THREE.Color('#FF4F1F') },
    ...fogU,
  };
}
export const slabShader = { vertexShader: slabVert, fragmentShader: slabFrag };

export function makeTowerMaterial() {
  return new THREE.ShaderMaterial({
    defines: { TOWER: '' },
    uniforms: { ...makeSlabUniforms([0.5, 0.5, 0.5]), uStack: { value: 0 } },
    vertexShader: slabVert,
    fragmentShader: slabFrag,
  });
}

/* ------------------------------------------------------------------------------------- attention beams
 * Instanced camera-facing ribbons along a cubic Bézier. Per instance: start A (query), end B (key),
 * params (weight, arc height, forward bulge, phase) and colour. Pulses travel key → query: information
 * flows from the attended word into the one asking.
 */
const beamVert = /* glsl */ `
  attribute vec3 iA; attribute vec3 iB; attribute vec3 iC; attribute vec4 iP;
  uniform float uWidth; uniform float uGrow;
  varying float vT; varying float vSide; varying vec3 vC; varying float vWgt; varying float vPhase; varying float vDepth;
  vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float u = 1.0 - t; return u*u*u*a + 3.0*u*u*t*b + 3.0*u*t*t*c + t*t*t*d; }
  void main(){
    float t = position.x; float side = position.y;
    vec3 off = vec3(0.0, iP.y, iP.z);
    vec3 a = iA, d = iB, b = iA + off, c = iB + off;
    vec3 p = bez(a, b, c, d, t);
    vec3 T = bez(a, b, c, d, min(t + 0.01, 1.0)) - bez(a, b, c, d, max(t - 0.01, 0.0));
    T = normalize(T + 1e-5);
    vec3 V = normalize(cameraPosition - (modelMatrix * vec4(p, 1.0)).xyz);
    vec3 S = normalize(cross(T, V) + 1e-5);
    float w = uWidth * (0.22 + 1.25 * sqrt(iP.x));
    w *= mix(0.35, 1.0, smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t));
    p += S * side * w;
    vT = t; vSide = side; vC = iC; vWgt = iP.x; vPhase = iP.w;
    vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const beamFrag = /* glsl */ `
  uniform float uTime; uniform float uGrow; uniform float uIntensity; uniform float uFlowDir;
  varying float vT; varying float vSide; varying vec3 vC; varying float vWgt; varying float vPhase; varying float vDepth;
  ${FOG}
  void main(){
    float reveal = smoothstep(uGrow * 1.15, uGrow * 1.15 - 0.15, vT);
    if (reveal <= 0.001) discard;
    float core = 1.0 - abs(vSide);
    float prof = pow(core, 2.0) * 0.55 + pow(core, 10.0) * 1.4;
    float f = fract(vT * 5.0 + uFlowDir * uTime * 0.55 + vPhase);
    float pulse = smoothstep(0.0, 0.08, f) * smoothstep(0.42, 0.08, f);
    float I = (0.05 + 2.2 * vWgt) * uIntensity;
    vec3 col = vC * I * prof * (0.55 + 1.1 * pulse);
    col += vec3(1.0, 0.85, 0.75) * pow(core, 16.0) * vWgt * pulse * uIntensity * 0.9;
    float fogF = 1.0 - exp(-uFogDensity*uFogDensity*vDepth*vDepth);
    col *= reveal * (1.0 - clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SEG = 72;
export function makeBeams(max, { width = 0.05, intensity = 1, flowDir = 1 } = {}) {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    pos.push(t, -1, 0, t, 1, 0);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
  const attrs = { iA: mk(3), iB: mk(3), iC: mk(3), iP: mk(4) };
  for (const k in attrs) g.setAttribute(k, attrs[k]);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeU,
      uGrow: { value: 1 },
      uWidth: { value: width },
      uIntensity: { value: intensity },
      uFlowDir: { value: flowDir },
      ...fogU,
    },
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const write = (list) => {
    const n = Math.min(max, list.length);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      attrs.iA.array.set(b.a, i * 3);
      attrs.iB.array.set(b.b, i * 3);
      attrs.iC.array[i * 3] = b.c.r; attrs.iC.array[i * 3 + 1] = b.c.g; attrs.iC.array[i * 3 + 2] = b.c.b;
      attrs.iP.array[i * 4] = b.w; attrs.iP.array[i * 4 + 1] = b.h; attrs.iP.array[i * 4 + 2] = b.z || 0; attrs.iP.array[i * 4 + 3] = b.phase || 0;
    }
    for (const k in attrs) {
      attrs[k].needsUpdate = true;
      attrs[k].clearUpdateRanges?.();
    }
    g.instanceCount = n;
  };
  return { geometry: g, material: mat, write, max };
}

/* --------------------------------------------------------------------------------------------- floor */
const floorVert = /* glsl */ `
  varying vec3 vW; varying float vDepth;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mv = viewMatrix * wp; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
`;
const floorFrag = /* glsl */ `
  uniform float uTime; uniform float uGlow; uniform vec3 uGlowColor;
  varying vec3 vW; varying float vDepth;
  ${FOG}
  float grid(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) * s; vec2 fw = fwidth(p) * 1.2; vec2 l = 1.0 - smoothstep(vec2(w) - fw, vec2(w) + fw, g); return max(l.x, l.y); }
  void main(){
    vec2 p = vW.xz;
    float fine = grid(p, 0.5, 0.004) * 0.35;
    float major = grid(p, 2.5, 0.008);
    float r = length(p * vec2(0.09, 0.22));
    float fade = 1.0 - smoothstep(0.2, 1.4, r);
    vec3 col = vec3(0.035, 0.05, 0.075) * (fine + major * 0.55) * fade;
    col += uGlowColor * uGlow * 0.012 * (1.0 - smoothstep(0.0, 1.0, r));
    float f = 1.0 - exp(-uFogDensity*uFogDensity*vDepth*vDepth);
    gl_FragColor = vec4(col * (1.0 - clamp(f, 0.0, 1.0)), 1.0);
  }
`;
export function makeFloorMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, uGlow: { value: 0 }, uGlowColor: { value: new THREE.Color('#A8F0FF') }, ...fogU },
    vertexShader: floorVert,
    fragmentShader: floorFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
