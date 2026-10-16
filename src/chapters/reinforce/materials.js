import * as THREE from 'three';

/**
 * Glass floor tile, shaded by the learned Q-values (instanced).
 *   aQ    vec4  displayed Q(s, north/east/south/west)
 *   aInfo vec4  x kind (0 floor 1 wall 2 pit 3 goal), y visit pulse, z tile index, w on-route (0..1)
 * Heat uses the house diverging scale: frost (−) → #1A1B20 (0) → signal (+).
 * uQuad blends between "tile = V(s)" and "four triangles = Q(s,a)" (the classic Q-table picture).
 */
export function makeTileMaterial({ quad = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0c0d11'),
    roughness: 0.16,
    metalness: 0.25,
    envMapIntensity: 1.1,
  });
  const uniforms = {
    uTime: { value: 0 },
    uHover: { value: -1 },
    uHoverColor: { value: new THREE.Color(1, 1, 1) },
    uQuad: { value: quad },
    uHeat: { value: 1 },
    uLabels: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aQ;
        attribute vec4 aInfo;
        uniform float uHover;
        varying vec4 vQ;
        varying vec4 vInfo;
        varying vec3 vLocal;
        varying vec3 vObjN;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vQ = aQ; vInfo = aInfo; vLocal = position; vObjN = normal;
        float hov = 1.0 - step(0.5, abs(aInfo.z - uHover));
        transformed.y += hov * 0.06;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uHover;
        uniform vec3 uHoverColor;
        uniform float uQuad;
        uniform float uHeat;
        varying vec4 vQ;
        varying vec4 vInfo;
        varying vec3 vLocal;
        varying vec3 vObjN;
        const vec3 SIGNAL = vec3(1.0, 0.078, 0.013);
        const vec3 SIGNAL_HOT = vec3(1.0, 0.45, 0.25);
        const vec3 FROST = vec3(0.09, 0.16, 0.75);
        const vec3 ICE = vec3(0.392, 0.871, 1.0);
        const vec3 ZERO = vec3(0.010, 0.011, 0.014);
        vec3 heatCol(float v) {
          float a = pow(clamp(abs(v), 0.0, 1.0), 0.9);
          return v >= 0.0 ? mix(ZERO, mix(SIGNAL, SIGNAL_HOT, smoothstep(0.75, 1.0, v)), a) : mix(ZERO, FROST, a);
        }
        float heatAmt(float v) { return pow(clamp(abs(v), 0.0, 1.0), 1.35); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float kind = vInfo.x;
        float isTop = step(0.6, vObjN.y);
        vec2 P = vLocal.xz / 0.47;
        float edge = max(abs(P.x), abs(P.y));
        float Vs = max(max(vQ.x, vQ.y), max(vQ.z, vQ.w));
        float qv;
        if (abs(P.x) > abs(P.y)) qv = P.x > 0.0 ? vQ.y : vQ.w; else qv = P.y < 0.0 ? vQ.x : vQ.z;
        float val = mix(Vs, qv, uQuad);
        float diagD = abs(abs(P.x) - abs(P.y));
        float sep = (1.0 - smoothstep(0.0, 0.05, diagD)) * uQuad * step(kind, 0.5);
        float isFloor = 1.0 - step(0.5, kind);
        float isPit = step(1.5, kind) * (1.0 - step(2.5, kind));
        float isGoal = step(2.5, kind);
        // pits: a dark well
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.006, 0.01), isPit * isTop);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.004, 0.0), isGoal * isTop);
        // heat also tints the albedo a little so it reads under reflections
        diffuseColor.rgb += heatCol(val) * 0.18 * isFloor * isTop * uHeat;
        diffuseColor.rgb *= 1.0 - sep * 0.7;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, isPit);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float t = uTime;
          // value heat on floor tops
          vec3 h = heatCol(val) * heatAmt(val) * 1.05 * uHeat;
          float inner = 1.0 - smoothstep(0.80, 0.98, edge);
          totalEmissiveRadiance += h * isFloor * isTop * (0.55 + 0.45 * inner) * (1.0 - sep);
          // hairline rim on every floor tile (lab-instrument grid)
          float rim = smoothstep(0.90, 0.97, edge) * (1.0 - smoothstep(0.985, 1.0, edge));
          totalEmissiveRadiance += ICE * rim * 0.06 * isFloor * isTop;
          // visit breadcrumbs: an ice dot that fades
          float d = length(P);
          float crumb = (1.0 - smoothstep(0.10, 0.22, d)) + rim * 2.0;
          totalEmissiveRadiance += ICE * vInfo.y * crumb * 0.55 * isFloor * isTop;
          // greedy route glow
          totalEmissiveRadiance += SIGNAL_HOT * vInfo.w * (1.0 - smoothstep(0.08, 0.2, d)) * 1.6 * isFloor * isTop;
          // pits: an ice ring and a faint caustic well
          float pr = smoothstep(0.62, 0.86, edge) * (1.0 - smoothstep(0.9, 0.99, edge));
          float well = pow(1.0 - clamp(edge, 0.0, 1.0), 2.0);
          float ripple = 0.5 + 0.5 * sin(d * 14.0 - t * 2.2);
          totalEmissiveRadiance += ICE * isPit * isTop * (pr * 0.75 + well * (0.08 + 0.16 * ripple));
          totalEmissiveRadiance += FROST * isPit * (1.0 - isTop) * 0.25;
          // goal: concentric reward rings
          float rings = 0.5 + 0.5 * sin(d * 18.0 - t * 4.0);
          totalEmissiveRadiance += SIGNAL * isGoal * isTop * (1.4 + 1.6 * rings * (1.0 - d * 0.6));
          totalEmissiveRadiance += SIGNAL * isGoal * (1.0 - isTop) * 0.9;
          // hover: preview the tool colour
          float hov = 1.0 - step(0.5, abs(vInfo.z - uHover));
          totalEmissiveRadiance += uHoverColor * hov * (smoothstep(0.82, 0.96, edge) * 1.6 + 0.08);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'latent-rl-tile';
  return mat;
}

/** Graphite wall block with a faint ice hairline on its top edge. */
export function makeWallMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#121318'),
    roughness: 0.62,
    metalness: 0.2,
    envMapIntensity: 0.45,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLoc; varying vec3 vN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLoc = position; vN = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLoc; varying vec3 vN;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float top = step(0.6, vN.y);
          diffuseColor.rgb *= 0.35 + 0.65 * smoothstep(0.0, 0.75, vLoc.y);
          float e = max(abs(vLoc.x), abs(vLoc.z)) / 0.48;
          float line = smoothstep(0.88, 0.95, e) * (1.0 - smoothstep(0.97, 1.0, e));
          totalEmissiveRadiance += vec3(0.392, 0.871, 1.0) * line * top * 0.12;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'latent-rl-wall';
  return mat;
}

/** Additive vertical gradient (goal light column, agent glow disc). */
export function makeBeamMaterial(color = [1, 0.078, 0.013], strength = 1) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uStrength: { value: strength }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; uniform float uTime; varying vec2 vUv;
      void main(){
        float a = pow(1.0 - vUv.y, 2.4) * (0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 3.0));
        float side = sin(vUv.x * 3.14159);
        gl_FragColor = vec4(uColor * a * side * uStrength, 1.0);
      }`,
  });
}

/** Soft additive radial disc (contact glow / shockwave ring). */
export function makeDiscMaterial(color = [0.392, 0.871, 1.0], ring = 0) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uOpacity: { value: 1 }, uRing: { value: ring } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uRing; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float disc = pow(max(0.0, 1.0 - d), 2.0);
        float ring = smoothstep(0.78, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
        float a = mix(disc, ring, uRing);
        gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
      }`,
  });
}
