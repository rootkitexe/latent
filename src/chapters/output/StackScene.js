'use client'

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { live, damp } from '@/lib/store';
import { CHAPTERS } from '@/chapters/registry';
import { finale } from './state';

/**
 * The whole forward pass seen at once: nine layers (one per chapter) stacked along Y, each a lattice
 * of neurons, wired to the next by fine connections. Forward-pass waves rise through the stack.
 * The top layer — the output — reorganises into the text the visitor typed at the very start.
 */
const LAYERS = CHAPTERS.length; // 9
const G = 44;                    // grid per layer
const PER = G * G;
const GAP = 1.15;

const pointsVert = /* glsl */ `
  attribute vec3 aGrid;     // x, z on the lattice, layer index
  attribute vec3 aTarget;   // output-layer text position (only meaningful on the last layer)
  attribute float aSeed;
  uniform float uTime;
  uniform float uMorph;     // 0 lattice → 1 text (last layer)
  uniform float uSpread;    // 0 collapsed stack → 1 full height
  uniform float uHover;     // highlighted layer index, −1 none
  uniform float uPixel;
  varying float vAct;
  varying float vLayer;
  varying float vHover;
  varying float vOut;
  varying float vDim;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float L = aGrid.z;
    vLayer = L;
    float y = (L - ${(LAYERS - 1) / 2}.0) * ${GAP} * uSpread;
    vec3 p = vec3(aGrid.x, y, aGrid.y);
    // each layer has its own breathing pattern
    float r = length(aGrid.xy);
    p.y += sin(r * 3.0 - uTime * 1.2 + L) * 0.03 + (hash(aSeed) - 0.5) * 0.04;
    // forward-pass wave climbing the stack
    float wave = fract(uTime * 0.16) * ${LAYERS + 2}.0 - 1.0;
    float act = exp(-pow((L - wave) * 1.6, 2.0)) * step(0.55, hash(aSeed * 1.7 + floor(uTime * 0.16)));
    vAct = act;
    vHover = 1.0 - step(0.5, abs(L - uHover));
    float isOut = step(${LAYERS - 1}.0 - 0.5, L);
    vOut = isOut * uMorph;
    vDim = mix(1.0 - 0.88 * uMorph, 1.0, isOut);
    p = mix(p, aTarget + vec3(0.0, y, 0.0), isOut * uMorph);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = mix(0.9 + act * 2.2 + vHover * 1.0, 0.42, vOut);
    gl_PointSize = s * uPixel * (7.0 / -mv.z);
  }
`;

const pointsFrag = /* glsl */ `
  varying float vAct;
  varying float vLayer;
  varying float vHover;
  varying float vOut;
  varying float vDim;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.1, d);
    vec3 cold = mix(vec3(0.66, 0.94, 1.0), vec3(0.36, 0.49, 0.98), vLayer / ${LAYERS - 1}.0);
    vec3 col = cold * 0.5;
    col = mix(col, vec3(1.0, 0.31, 0.12) * 2.2, vAct);
    col = mix(col, vec3(1.0, 0.45, 0.25) * 1.3, vHover * 0.8);
    col = mix(col, vec3(1.0, 0.8, 0.7) * 1.2, vOut);
    gl_FragColor = vec4(col, a * (0.16 + vAct * 0.7 + vHover * 0.35 + vOut * 0.3) * vDim);
  }
`;

const linesVert = /* glsl */ `
  attribute float aLayer;   // source layer of the segment (both vertices)
  attribute float aEnd;     // 0 source vertex, 1 destination vertex
  attribute float aSeed;
  uniform float uTime;
  uniform float uSpread;
  uniform float uHover;
  uniform float uMorph;
  varying float vA;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 p = position;
    p.y = (aLayer + aEnd - ${(LAYERS - 1) / 2}.0) * ${GAP} * uSpread;
    float wave = fract(uTime * 0.16) * ${LAYERS + 2}.0 - 1.0;
    float t = aLayer + aEnd;
    vA = 0.018 + exp(-pow((t - wave) * 1.4, 2.0)) * 0.22 * step(0.6, hash(aSeed))
       + (1.0 - step(0.5, abs(aLayer - uHover))) * 0.1;
    vA *= 1.0 - 0.85 * uMorph;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const linesFrag = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(mix(vec3(0.66, 0.94, 1.0), vec3(1.0, 0.4, 0.2), smoothstep(0.2, 0.6, vA)) * 1.2, vA); }
`;

function sampleText(text, count) {
  const c = document.createElement('canvas');
  const W = 1024, H = 256;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const probe = document.createElement('span');
  probe.className = 'font-display';
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  let size = 200;
  ctx.font = `900 ${size}px ${family}`;
  while (ctx.measureText(text).width > W * 0.92 && size > 30) { size -= 6; ctx.font = `900 ${size}px ${family}`; }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
  const data = ctx.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
  const out = new Float32Array(count * 3);
  const span = 4.6;
  for (let i = 0; i < count; i++) {
    const p = pts.length ? pts[Math.floor(Math.random() * pts.length)] : [W / 2, H / 2];
    out[i * 3] = (p[0] / W - 0.5) * span;
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = (p[1] / H - 0.5) * span * (H / W);
  }
  return out;
}

function Stack({ progress }) {
  const { gl } = useThree();
  const text = useMemo(() => finale.outputText(), []);

  const pointsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = PER * LAYERS;
    const grid = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const target = new Float32Array(n * 3);
    const textPts = sampleText(text, PER);
    for (let L = 0; L < LAYERS; L++) {
      for (let i = 0; i < PER; i++) {
        const k = L * PER + i;
        const gx = (i % G) / (G - 1) - 0.5;
        const gz = Math.floor(i / G) / (G - 1) - 0.5;
        const s = 2.6 - L * 0.12; // the stack narrows as it goes up, like a funnel to the answer
        grid[k * 3] = gx * s;
        grid[k * 3 + 1] = gz * s;
        grid[k * 3 + 2] = L;
        seed[k] = Math.random() * 1000;
        if (L === LAYERS - 1) target.set(textPts.subarray(i * 3, i * 3 + 3), k * 3);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 3));
    g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [text]);

  const linesGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const M = 520; // connections per layer pair
    const segs = M * (LAYERS - 1);
    const pos = new Float32Array(segs * 6);
    const layer = new Float32Array(segs * 2);
    const end = new Float32Array(segs * 2);
    const seed = new Float32Array(segs * 2);
    let k = 0;
    for (let L = 0; L < LAYERS - 1; L++) {
      const s0 = 2.6 - L * 0.12, s1 = 2.6 - (L + 1) * 0.12;
      for (let m = 0; m < M; m++) {
        const ax = (Math.random() - 0.5) * s0, az = (Math.random() - 0.5) * s0;
        const bx = ax * (s1 / s0) + (Math.random() - 0.5) * 0.9, bz = az * (s1 / s0) + (Math.random() - 0.5) * 0.9;
        pos.set([ax, 0, az, bx, 0, bz], k * 6);
        layer[k * 2] = layer[k * 2 + 1] = L;
        end[k * 2] = 0; end[k * 2 + 1] = 1;
        seed[k * 2] = seed[k * 2 + 1] = Math.random() * 1000;
        k++;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uSpread: { value: 0.2 },
      uHover: { value: -1 },
      uPixel: { value: gl.getPixelRatio() * 10 },
    }),
    [gl]
  );

  const pointsMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: pointsVert, fragmentShader: pointsFrag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [uniforms]
  );
  const linesMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: linesVert, fragmentShader: linesFrag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [uniforms]
  );

  const group = useRef();
  const spin = useRef(0);
  useFrame((state, dt) => {
    const p = progress.current;
    uniforms.uTime.value += dt;
    uniforms.uSpread.value += (Math.min(1, 0.25 + p * 2.2) - uniforms.uSpread.value) * damp(0.06);
    const morphT = Math.min(1, Math.max(0, (p - 0.42) / 0.2));
    uniforms.uMorph.value += (morphT - uniforms.uMorph.value) * damp(0.05);
    const h = finale.hover;
    uniforms.uHover.value = h;
    // spin while exploring; unwind to a readable orientation as the output decodes
    spin.current += dt * 0.05 * (1 - morphT);
    const a = ((spin.current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (group.current) group.current.rotation.y = a * (1 - uniforms.uMorph.value);
  });

  return (
    <group ref={group}>
      <points geometry={pointsGeo} material={pointsMat} frustumCulled={false} />
      <lineSegments geometry={linesGeo} material={linesMat} frustumCulled={false} />
    </group>
  );
}

function Rig({ progress }) {
  const { camera, size } = useThree();
  const at = useRef(new THREE.Vector3());
  const tPos = useMemo(() => new THREE.Vector3(), []);
  const tAt = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const p = progress.current;
    const portrait = size.width < size.height ? 1.55 : 1;
    // low side view → rising orbit → top-down over the output layer
    const k = Math.min(1, Math.max(0, (p - 0.3) / 0.35));
    const e = k * k * (3 - 2 * k);
    const ang = -0.6 + p * 0.9;
    const R = (9.5 - e * 3.2) * portrait;
    tPos.set(Math.sin(ang) * R * (1 - e * 0.98), -1.2 + e * 12.5, Math.cos(ang) * R * (1 - e * 0.98) + e * 0.6);
    tAt.set(0, e * 4.6, 0);
    tPos.x += live.pointer.x * 0.4;
    tPos.y += live.pointer.y * 0.3;
    camera.up.set(0, 1 - e, -e).normalize();
    camera.position.lerp(tPos, damp(0.05));
    at.current.lerp(tAt, damp(0.07));
    camera.lookAt(at.current);
  });
  return null;
}

export default function StackScene({ progress }) {
  return (
    <>
      <color attach="background" args={['#050506']} />
      <fog attach="fog" args={['#050506', 8, 26]} />
      <Rig progress={progress} />
      <Stack progress={progress} />
      <EffectComposer multisampling={0} disableNormalPass>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.75} luminanceSmoothing={0.2} radius={0.65} />
        <Noise opacity={0.045} premultiply />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
}
