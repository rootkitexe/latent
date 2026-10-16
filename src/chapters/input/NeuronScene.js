'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { live, damp } from '@/lib/store';
import { sim, step, MAX_PULSES, TRAVEL } from './sim';

const vert = /* glsl */ `
  attribute vec4 color;
  varying vec3 vData;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vData = color.rgb;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  #define MAXP ${MAX_PULSES}
  uniform float uTime;
  uniform vec4 uPulse[MAXP];   // t0, branch, kind, weight
  uniform int uCount;
  uniform float uTravel;
  uniform float uSpikeAge;
  uniform float uIdle;
  uniform float uV;
  varying vec3 vData;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;

  vec3 thinFilm(float t) {
    // ice -> frost -> violet -> faint signal at grazing angles
    // strictly cold: orange is reserved for activation
    vec3 a = vec3(0.66, 0.94, 1.0);
    vec3 b = vec3(0.36, 0.49, 0.98);
    vec3 c = vec3(0.50, 0.36, 0.92);
    t = fract(t);
    if (t < 0.33) return mix(a, b, t / 0.33);
    if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
    return mix(c, a, (t - 0.66) / 0.34);
  }
  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    if (!gl_FrontFacing) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.2);

    float d = vData.r;        // normalised path distance
    float br = vData.g;       // branch id
    float comp = vData.b;     // 0 soma, .5 dendrite, 1 axon
    bool axon = comp > 0.75;
    bool soma = comp < 0.25;

    // --- surface: graphite with thin-film rim and two cold lights
    vec3 L1 = normalize(vec3(0.6, 0.7, 0.5));
    vec3 L2 = normalize(vec3(-0.7, -0.3, 0.4));
    float diff = max(dot(N, L1), 0.0) * 0.35 + max(dot(N, L2), 0.0) * 0.12;
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 140.0) * 0.55;
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 40.0) * 0.12;
    // obsidian: almost black, a sharp cold highlight, and a thin-film rim only at grazing angles
    vec3 base = vec3(0.010, 0.011, 0.016) * (0.5 + diff);
    float rim = pow(1.0 - ndv, 3.6);
    vec3 film = thinFilm(rim * 0.8 + vW.y * 0.05 + d * 0.35 + uTime * 0.012) * rim * 1.15;
    vec3 col = base + film + spec * vec3(0.8, 0.95, 1.0) + spec2 * vec3(0.36, 0.49, 0.98);

    // --- activity
    float e = 0.0;
    for (int i = 0; i < MAXP; i++) {
      if (i >= uCount) break;
      vec4 p = uPulse[i];
      float age = uTime - p.x;
      if (p.z < 0.5) {
        // dendritic input: a front running from the tips (d=1) to the soma (d=0) on a sector of branches
        if (!axon && !soma) {
          float sector = 1.0 - smoothstep(0.035, 0.07, abs(fract(br - p.y + 0.5) - 0.5));
          float front = 1.0 - age / ${TRAVEL.toFixed(3)};
          float band = exp(-pow((d - front) / 0.035, 2.0));
          float tail = smoothstep(front - 0.01, front + 0.02, d) * exp(-max(d - front, 0.0) * 14.0) * 0.5;
          e += (band * 2.6 + tail) * sector * (0.8 + p.w) * step(-0.05, front);
        }
        if (soma) e += exp(-pow((age - ${TRAVEL.toFixed(3)}) / 0.08, 2.0)) * 0.6 * p.w;
      } else {
        // action potential: the soma flashes, then a bright front runs down the axon to every terminal
        if (soma) e += exp(-age * 5.0) * 3.0;
        if (axon) {
          float front = age * 0.85;
          e += exp(-pow((d - front) / 0.05, 2.0)) * 3.2;
          e += smoothstep(front, front - 0.3, d) * exp(-age * 1.6) * 0.35;
        }
        if (!axon && !soma) e += exp(-age * 3.0) * 0.25 * (1.0 - d);
      }
    }
    // idle sparks: faint packets wandering on random branches, always alive
    float lane = floor(br * 37.0);
    float ph = fract(uTime * (0.08 + hash(lane) * 0.12) + hash(lane * 3.1));
    float spark = exp(-pow((d - (1.0 - ph)) / 0.02, 2.0)) * step(0.82, hash(lane * 7.7 + floor(uTime * 0.2 + hash(lane))));
    if (!axon && !soma) e += spark * 0.5 * uIdle;

    // the soma charges visibly with the membrane potential
    if (soma) e += uV * uV * 1.1 * (0.6 + 0.4 * sin(uTime * 9.0 * uV));
    vec3 signal = vec3(1.0, 0.31, 0.12);
    vec3 hot = vec3(1.0, 0.75, 0.6);
    col += mix(signal, hot, clamp(e - 1.0, 0.0, 1.0)) * e * 1.6;
    // soma glows faintly with the membrane potential (set in uIdle's sibling below)
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function Neuron() {
  const { scene } = useGLTF('/models/neuron.glb', '/draco/');
  const geo = useMemo(() => {
    let g = null;
    scene.traverse((o) => { if (o.isMesh && !g) g = o.geometry; });
    return g;
  }, [scene]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uTime: { value: 0 },
          uPulse: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector4(-99, 0, 0, 0)) },
          uCount: { value: 0 },
          uTravel: { value: TRAVEL },
          uSpikeAge: { value: 99 },
          uIdle: { value: 1 },
          uV: { value: 0 },
        },
        side: THREE.DoubleSide,
      }),
    []
  );

  // dendrite tips for each branch sector, used to aim typed letters at the right branch
  const tips = useMemo(() => {
    if (!geo) return [];
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const out = [];
    for (let i = 0; i < pos.count; i += 7) {
      const d = col.getX(i), comp = col.getZ(i);
      if (comp > 0.25 && comp < 0.75 && d > 0.8) out.push({ b: col.getY(i), v: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)) });
    }
    return out;
  }, [geo]);

  const group = useRef();
  const { camera, size } = useThree();

  useEffect(() => {
    const tmp = new THREE.Vector3();
    sim.project = (branch) => {
      if (!tips.length || !group.current) return null;
      let best = tips[0], bd = 9;
      for (const t of tips) {
        const dd = Math.abs(((t.b - branch + 1.5) % 1) - 0.5);
        if (dd < bd) { bd = dd; best = t; }
      }
      tmp.copy(best.v).applyMatrix4(group.current.matrixWorld).project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height };
    };
    return () => { sim.project = null; };
  }, [tips, camera, size]);

  useFrame((state, dt) => {
    step(Math.min(dt, 0.05));
    const u = mat.uniforms;
    u.uTime.value = sim.time;
    const n = Math.min(sim.pulses.length, MAX_PULSES);
    for (let i = 0; i < n; i++) {
      const p = sim.pulses[i];
      u.uPulse.value[i].set(p.t0, p.branch, p.kind, p.w);
    }
    u.uCount.value = n;
    u.uIdle.value = live.idle ? 1.6 : 1;
    u.uV.value = sim.V;
  });

  if (!geo) return null;
  return (
    <group ref={group}>
      <mesh geometry={geo} material={mat} frustumCulled={false} />
    </group>
  );
}

useGLTF.preload('/models/neuron.glb', '/draco/');

/** Drifting dust: depth cues in the void. */
function Dust({ count = 1400 }) {
  const ref = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 22;
      p[i * 3 + 1] = (Math.random() - 0.5) * 14;
      p[i * 3 + 2] = (Math.random() - 0.5) * 16 - 2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.006; });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.018} color="#a8f0ff" transparent opacity={0.35} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/**
 * Camera path over scroll: a wide hero composition (neuron right of centre), then a dive toward the
 * soma and down along the axon, ending close on the terminals as the next layer begins.
 */
function Rig({ progress }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3());
  const rigRoot = useRef();
  const P = useMemo(
    () => ({
      pos: [new THREE.Vector3(-1.2, 0.35, 7.2), new THREE.Vector3(0.2, -0.2, 3.4), new THREE.Vector3(1.6, -2.6, 1.6)],
      at: [new THREE.Vector3(-0.15, 0.2, 0), new THREE.Vector3(0.05, -0.1, 0), new THREE.Vector3(1.2, -3.0, 0)],
    }),
    []
  );
  const tPos = useMemo(() => new THREE.Vector3(), []);
  const tAt = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const p = progress.current;
    const k = Math.min(1, p * 2);
    const k2 = Math.max(0, p * 2 - 1);
    const e = (x) => x * x * (3 - 2 * x);
    tPos.copy(P.pos[0]).lerp(P.pos[1], e(k)).lerp(P.pos[2], e(k2));
    tAt.copy(P.at[0]).lerp(P.at[1], e(k)).lerp(P.at[2], e(k2));
    // portrait screens: pull back and centre the cell
    const portrait = Math.max(0, Math.min(1, (1.2 - size.width / size.height) / 0.7));
    tPos.z *= 1 + portrait * 0.9 * (1 - p * 0.6);
    tPos.x += portrait * 1.2 * (1 - p);
    tPos.x += live.pointer.x * 0.35 * (1 - p);
    tPos.y += live.pointer.y * 0.22 * (1 - p);
    camera.position.lerp(tPos, damp(0.06));
    look.current.lerp(tAt, damp(0.08));
    camera.lookAt(look.current);
  });
  return null;
}

export default function NeuronScene({ progress }) {
  const spin = useRef();
  useFrame((state, dt) => {
    if (!spin.current) return;
    const kick = Math.max(0, 1 - (sim.time - sim.lastSpike) * 2);
    spin.current.rotation.y += dt * (0.05 + kick * 0.15) * (1 - progress.current * 0.8);
    spin.current.rotation.z = 0.12 + Math.sin(state.clock.elapsedTime * 0.2) * 0.03;
  });
  return (
    <>
      <color attach="background" args={['#050506']} />
      <fog attach="fog" args={['#050506', 6, 16]} />
      <Rig progress={progress} />
      <group ref={spin} position={[1.15, 0.15, 0]} rotation={[0.05, -0.6, 0.12]} scale={1.25}>
        <Neuron />
      </group>
      <Dust />
      <EffectComposer multisampling={0} disableNormalPass>
        <Bloom mipmapBlur intensity={1.25} luminanceThreshold={0.62} luminanceSmoothing={0.2} radius={0.75} />
        <ChromaticAberration offset={[0.0006, 0.0004]} radialModulation modulationOffset={0.4} blendFunction={BlendFunction.NORMAL} />
        <Noise opacity={0.045} premultiply />
        <Vignette eskil={false} offset={0.22} darkness={0.75} />
      </EffectComposer>
    </>
  );
}
