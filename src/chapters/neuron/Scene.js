'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard, Environment, Lightformer, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { live, damp, useStore } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import { ACTS, ACT_INDEX, DATA, N_POINTS, dot, diverging, fmt, useNeuron, W_RANGE, B_RANGE } from './state';
import {
  shellVert, shellFrag, liquidVert, liquidFrag, tubeVert, tubeFrag, axonFrag, ribbonVert, ribbonFrag,
  tickVert, tickFrag, planeVert, planeFrag, haloVert, haloFrag, dustVert, dustFrag,
} from './shaders';

const MONO = '/fonts/JetBrainsMono-Medium.ttf';
const SERIF = '/fonts/InstrumentSerif-Italic.ttf';
const ICE = '#A8F0FF';
const SIGNAL = '#FF4F1F';

/* ------------------------------------------------------------------------------------------------
 * Per-frame simulation snapshot shared by every part of the machine (no React state per frame).
 * ---------------------------------------------------------------------------------------------- */
const S = {
  z: 0, a: 0, rate: 0, zD: 0, xD: [0, 0, 0], wD: [0, 0, 0], bD: 0,
  fire: 0, prevZ: 0, timer: 0, morph: 1, dataT: 0, step: 0, time: 0,
  pulses: [{ p: -1, a: 0 }, { p: -1, a: 0 }, { p: -1, a: 0 }, { p: -1, a: 0 }],
  planePulse: 0, dragging: false, hovered: null, wave: 9, waveAmp: 0,
};
const SOMA_R = 1.0;
const LIQ_R = 0.9;
const Z_VIS = 3.6;
const levelY = (z) => Math.max(-1, Math.min(1, z / Z_VIS)) * 0.8;

/** Normalised output 0..1 used for the dial, glow and firing rate. */
function normOut(act, a) {
  if (act === 'tanh') return (a + 1) / 2;
  if (act === 'relu') return Math.min(1, a / 2.5);
  return a;
}

const ORBS = [
  [-4.4, 1.9, 0.55],
  [-4.95, 0.0, -0.35],
  [-4.4, -1.9, 0.45],
];
const RING_T = 0.46;

/* ------------------------------------------------------------------------------------------------ */

function useCursorLabel() {
  const gl = useThree((s) => s.gl);
  return (label) => {
    const el = gl.domElement;
    if (label) el.setAttribute('data-cursor', label);
    else el.removeAttribute('data-cursor');
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  };
}

/** Vertical drag on a 3D handle → value. Pointer capture keeps the drag alive off the object. */
function useDragValue({ get, set, perPx, label = 'Drag', onHover }) {
  const cursor = useCursorLabel();
  const drag = useRef(null);
  const touch = useStore((s) => s.touch);
  return {
    onPointerOver: (e) => { e.stopPropagation(); if (!touch) cursor(label); onHover?.(true); },
    onPointerOut: () => { if (!drag.current) { cursor(null); onHover?.(false); } },
    onPointerDown: (e) => {
      if (touch) return;
      e.stopPropagation();
      e.target.setPointerCapture?.(e.pointerId);
      drag.current = { y: e.clientY, v: get() };
      S.dragging = true;
      window.__lenis?.stop?.();
    },
    onPointerMove: (e) => {
      if (!drag.current) return;
      e.stopPropagation();
      set(drag.current.v + (drag.current.y - e.clientY) * perPx);
    },
    onPointerUp: (e) => {
      if (!drag.current) return;
      e.target.releasePointerCapture?.(e.pointerId);
      drag.current = null;
      S.dragging = false;
      window.__lenis?.start?.();
      cursor(null);
      onHover?.(false);
    },
  };
}

/** drei <Text> whose string is pulled every frame (only re-laid-out when it changes). */
function LiveText({ get, font = MONO, ...props }) {
  const ref = useRef();
  const last = useRef(null);
  const init = useMemo(() => get(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    const s = get();
    if (s !== last.current && ref.current) {
      last.current = s;
      ref.current.text = s;
      ref.current.sync();
    }
  });
  return (
    <Text ref={ref} font={font} material-toneMapped={false} {...props}>
      {init}
    </Text>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Simulation tick: computes z, output, firing, damped visual values. Runs before everything else.
 * ---------------------------------------------------------------------------------------------- */
function Sim() {
  const reduced = useStore((s) => s.reducedMotion);
  useFrame((state, dt) => {
    dt = Math.min(dt, 0.05);
    S.time += dt;
    const st = useNeuron.getState();
    S.step = st.step;
    const z = dot(st.w, st.x, st.b);
    const a = ACTS[st.act].fn(z);
    S.z = z; S.a = a;
    S.rate = Math.max(0, Math.min(1, normOut(st.act, a)));
    const k = damp(1 - Math.exp(-dt * 9));
    S.zD += (z - S.zD) * k;
    for (let i = 0; i < 3; i++) {
      S.xD[i] += (st.x[i] - S.xD[i]) * k;
      S.wD[i] += (st.w[i] - S.wD[i]) * damp(1 - Math.exp(-dt * (st.learning ? 5 : 9)));
    }
    S.bD += (st.b - S.bD) * damp(1 - Math.exp(-dt * (st.learning ? 5 : 9)));
    // activation morph (0→1 after a switch)
    const since = (performance.now() - st.actChangedAt) / 900;
    S.morph = live.snap ? 1 : Math.min(1, since < 0 ? 1 : 1 - Math.pow(1 - Math.min(1, since), 4));
    // step-5 data space blend
    const target = st.step >= 4 ? 1 : 0;
    S.dataT += (target - S.dataT) * damp(1 - Math.exp(-dt * 3.2));

    // Firing: the neuron fires while z > 0; pulse rate follows the output.
    const firing = z > 0;
    if (firing && S.prevZ <= 0) {
      spawnPulse(1.25);
      S.fire = 1;
      S.wave = 0; S.waveAmp = 1.3;
      playBlip(0.75 + 0.2 * S.rate, 0.6);
      S.timer = 1.6 - 1.15 * S.rate;
    } else if (firing && !reduced) {
      S.timer -= dt;
      if (S.timer <= 0) {
        spawnPulse(0.55 + 0.6 * S.rate);
        S.fire = Math.max(S.fire, 0.25 + 0.25 * S.rate);
        S.wave = 0; S.waveAmp = 0.45 + 0.3 * S.rate;
        playBlip(0.45 + 0.4 * S.rate, 0.25);
        S.timer = 1.6 - 1.15 * S.rate;
      }
    }
    S.prevZ = z;
    S.fire = Math.max(0, S.fire - dt * 2.2);
    for (const p of S.pulses) {
      if (p.p >= 0) {
        p.p += dt * 0.62;
        if (p.p > 1.05) p.p = -1;
      }
    }
    S.planePulse = Math.max(0, S.planePulse - dt * 2);
    S.wave += dt;
  }, -2);
  return null;
}
function spawnPulse(a) {
  let slot = S.pulses.find((p) => p.p < 0);
  if (!slot) slot = S.pulses.reduce((m, p) => (p.p > m.p ? p : m), S.pulses[0]);
  slot.p = 0;
  slot.a = a;
}

/* ------------------------------------------------------------------------------------------------
 * Camera rig: damped per-step framing + pointer parallax + desktop view offset (scene sits right of the copy).
 * ---------------------------------------------------------------------------------------------- */
const SHOTS = [
  { pos: [-1.0, 1.0, 12.2], look: [-1.7, 0.0, 0] }, // inputs
  { pos: [-0.8, 2.4, 10.2], look: [-2.0, 0.0, 0] }, // weights
  { pos: [7.4, 1.9, 4.6], look: [0.2, -0.1, 0] }, // sum + bias
  { pos: [8.6, 2.2, 8.8], look: [2.1, 0.35, 0], mlook: [2.75, 1.25, 0], mpos: [5.2, 2.0, 10.6] }, // activation
  { pos: [2.0, 3.2, 12.4], look: [1.0, -0.3, 0], mlook: [1.25, 0.35, 0], mpos: [2.0, 3.2, 14.2] }, // decision plane
];
function Rig() {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(-2, 0, 0));
  const tPos = useMemo(() => new THREE.Vector3(), []);
  const tLook = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const aspect = size.width / size.height;
    const shift = aspect > 1.15 ? 0.18 : 0;
    camera.setViewOffset(size.width, size.height, -shift * size.width, 0, size.width, size.height);
    camera.updateProjectionMatrix();
    return () => camera.clearViewOffset();
  }, [camera, size]);
  useFrame((state, dt) => {
    const shot = SHOTS[S.step] || SHOTS[0];
    const aspect = size.width / size.height;
    const far = aspect < 1 ? Math.min(1.6, 0.8 / aspect) : aspect < 1.15 ? 1.2 : 1;
    const mob = aspect < 1;
    const L = mob && shot.mlook ? shot.mlook : shot.look;
    const P = mob && shot.mpos ? shot.mpos : shot.pos;
    tLook.set(L[0], L[1], L[2]);
    if (mob && !shot.mlook) tLook.x = L[0] * 0.6;
    tPos.set(P[0], P[1], P[2]).sub(tLook).multiplyScalar(far).add(tLook);
    tPos.x += live.pointer.x * 0.45;
    tPos.y += live.pointer.y * 0.3;
    const k = damp(1 - Math.exp(-Math.min(dt, 0.05) * 2.4));
    camera.position.lerp(tPos, k);
    look.current.lerp(tLook, k);
    camera.lookAt(look.current);
  });
  return null;
}

/* ------------------------------------------------------------------------------------------------ */

function Shell({ radius = 1, opacity = 1, fireRef, seg = 64 }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uFire: { value: 0 }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    }),
    [opacity],
  );
  useFrame(() => {
    mat.uniforms.uTime.value = S.time;
    mat.uniforms.uFire.value = fireRef ? fireRef() : 0;
  });
  return (
    <mesh material={mat} renderOrder={5}>
      <sphereGeometry args={[radius, seg, Math.round(seg * 0.75)]} />
    </mesh>
  );
}

/* ---------- Input orbs ---------- */
function InputOrb({ i, pos }) {
  const core = useRef();
  const coreMat = useRef();
  const arc = useRef();
  const hov = useRef(false);
  const grp = useRef();
  const handlers = useDragValue({
    get: () => useNeuron.getState().x[i],
    set: (v) => useNeuron.getState().setX(i, v),
    perPx: 1 / 170,
    onHover: (h) => (hov.current = h),
  });
  const arcMat = useMemo(
    () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uVal: { value: 0 }, uC: { value: new THREE.Color(ICE) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uVal; uniform vec3 uC; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float ang = atan(p.x, p.y) / 6.28318 + 0.5; float r = length(p);
          float ring = smoothstep(0.5, 0.47, r) * smoothstep(0.42, 0.45, r);
          float lit = step(1.0 - uVal, ang);
          float tick = step(0.9, fract(ang * 20.0)) * smoothstep(0.5, 0.48, r) * smoothstep(0.39, 0.41, r);
          vec3 c = uC * (lit * 0.9 + 0.1) + vec3(0.25) * tick;
          gl_FragColor = vec4(c, ring * (0.25 + lit * 0.75) + tick * 0.35); }`,
    }),
    [],
  );
  const tmp = useMemo(() => new THREE.Color(), []);
  const ice = useMemo(() => new THREE.Color(ICE), []);
  useFrame((_, dt) => {
    const x = S.xD[i];
    arcMat.uniforms.uVal.value = x;
    if (coreMat.current) {
      tmp.copy(ice).multiplyScalar(0.15 + x * 1.05);
      coreMat.current.color.copy(tmp);
    }
    if (core.current) core.current.scale.setScalar(0.45 + x * 0.55);
    if (grp.current) {
      const s = hov.current ? 1.12 : 1;
      const cur = grp.current.scale.x;
      grp.current.scale.setScalar(cur + (s - cur) * damp(0.2));
    }
  });
  return (
    <group position={pos}>
      <group ref={grp}>
        <mesh ref={core}>
          <sphereGeometry args={[0.2, 32, 24]} />
          <meshBasicMaterial ref={coreMat} toneMapped={false} />
        </mesh>
        <Shell radius={0.32} seg={40} />
        <Billboard>
          <mesh material={arcMat}>
            <planeGeometry args={[1.0, 1.0]} />
          </mesh>
        </Billboard>
        {/* hit volume */}
        <mesh {...handlers}>
          <sphereGeometry args={[0.55, 12, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <Billboard position={[0, 0.66, 0]}>
        <LiveText get={() => `X${i + 1}  ${S.xD[i].toFixed(2)}`} fontSize={0.11} color={ICE} anchorX="center" letterSpacing={0.1} fillOpacity={0.8} />
      </Billboard>
    </group>
  );
}

/* ---------- Dendrite + weight ring ---------- */
function Dendrite({ i, start }) {
  const curve = useMemo(() => {
    const [x, y, z] = start;
    const end = new THREE.Vector3(-1, y * 0.42, z * 0.3).normalize().multiplyScalar(SOMA_R * 0.96);
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + 0.3, y, z),
      new THREE.Vector3(x + 1.5, y * 0.92, z * 0.9),
      new THREE.Vector3(-2.2, y * 0.52, z * 0.55),
      new THREE.Vector3(end.x * 1.35, end.y * 1.3, end.z * 1.3),
      end,
    ], false, 'centripetal');
  }, [start]);
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 160, 0.075, 18, false), [curve]);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: tubeVert, fragmentShader: tubeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uX: { value: 0 }, uContrib: { value: 0 }, uCColor: { value: new THREE.Color() }, uRing: { value: RING_T },
        uTime: { value: 0 }, uFocus: { value: 1 },
      },
    }),
    [],
  );
  const ringPos = useMemo(() => curve.getPointAt(RING_T), [curve]);
  const ringQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(RING_T)), [curve]);
  const ring = useRef();
  const ringMat = useRef();
  const hov = useRef(false);
  const handlers = useDragValue({
    get: () => useNeuron.getState().w[i],
    set: (v) => useNeuron.getState().setW(i, v),
    perPx: (2 * W_RANGE) / 300,
    onHover: (h) => (hov.current = h),
  });
  const c3 = useMemo(() => [0, 0, 0], []);
  useFrame(() => {
    const w = S.wD[i];
    const x = S.xD[i];
    const contrib = w * x;
    mat.uniforms.uTime.value = S.time;
    mat.uniforms.uX.value = x;
    mat.uniforms.uContrib.value = contrib;
    diverging(Math.sign(contrib) * Math.min(1, Math.abs(contrib) * 0.7 + 0.35), c3);
    mat.uniforms.uCColor.value.setRGB(c3[0], c3[1], c3[2], THREE.SRGBColorSpace);
    mat.uniforms.uFocus.value = S.step === 2 || S.step === 3 ? 0.7 : 1;
    if (ring.current) {
      const m = Math.abs(w) / W_RANGE;
      const hs = hov.current ? 1.12 : 1;
      ring.current.scale.set((1 + m * 0.35) * hs, (1 + m * 0.35) * hs, 0.35 + m * 3.6);
    }
    if (ringMat.current) {
      diverging(w / W_RANGE * 1.4, c3);
      ringMat.current.emissive.setRGB(c3[0], c3[1], c3[2], THREE.SRGBColorSpace);
      ringMat.current.emissiveIntensity = 0.35 + Math.min(1, Math.abs(w) / 2) * 0.9;
    }
  });
  const labelPos = useMemo(() => [ringPos.x, ringPos.y + 0.48, ringPos.z], [ringPos]);
  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={3} />
      <group position={ringPos} quaternion={ringQuat}>
        <mesh ref={ring}>
          <torusGeometry args={[0.2, 0.05, 20, 48]} />
          <meshPhysicalMaterial ref={ringMat} color="#121318" metalness={1} roughness={0.22} clearcoat={1} clearcoatRoughness={0.1} iridescence={0.6} iridescenceIOR={1.4} />
        </mesh>
        <mesh {...handlers}>
          <cylinderGeometry args={[0.42, 0.42, 0.5, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <Billboard position={labelPos}>
        <LiveText
          get={() => `W${i + 1} ${S.wD[i] >= 0 ? '+' : ''}${fmt(S.wD[i])}`}
          fontSize={0.105}
          color="#ffffff"
          fillOpacity={0.6}
          anchorX="center"
          letterSpacing={0.08}
        />
      </Billboard>
    </group>
  );
}

/* ---------- Soma: glass sphere with a liquid whose level is z ---------- */
function Soma() {
  const liq = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: liquidVert, fragmentShader: liquidFrag, side: THREE.DoubleSide,
      uniforms: {
        uLevel: { value: 0 }, uBias: { value: 0 }, uColor: { value: new THREE.Color() }, uGlow: { value: 0 },
        uFire: { value: 0 }, uTime: { value: 0 },
      },
    }),
    [],
  );
  const c3 = useMemo(() => [0, 0, 0], []);
  const biasRing = useRef();
  const hov = useRef(false);
  const handlers = useDragValue({
    get: () => useNeuron.getState().b,
    set: (v) => useNeuron.getState().setB(v),
    perPx: (2 * B_RANGE) / 300,
    onHover: (h) => (hov.current = h),
  });
  const biasLabel = useRef();
  useFrame(() => {
    const lv = levelY(S.zD) * (LIQ_R / 0.9);
    liq.uniforms.uLevel.value = lv;
    const by = levelY(S.bD);
    liq.uniforms.uBias.value = by;
    // liquid colour: diverging on z, lifted so it reads as light
    // liquid colour: diverging on z (frost below zero, signal above), never fully dark
    const zt = Math.max(-1, Math.min(1, S.zD / 1.6));
    diverging(Math.sign(zt) * (0.55 + 0.45 * Math.abs(zt)), c3);
    liq.uniforms.uColor.value.setRGB(c3[0], c3[1], c3[2], THREE.SRGBColorSpace);
    liq.uniforms.uGlow.value = S.rate;
    liq.uniforms.uFire.value = S.fire;
    liq.uniforms.uTime.value = S.time;
    if (biasRing.current) {
      const r = Math.sqrt(Math.max(0.01, SOMA_R * SOMA_R * 1.02 - by * by));
      biasRing.current.position.y = by;
      const hs = hov.current ? 1.04 : 1;
      biasRing.current.scale.set(r * hs, r * hs, r * hs);
    }
    if (biasLabel.current) biasLabel.current.position.y = by;
  });
  return (
    <group>
      <mesh material={liq}>
        <sphereGeometry args={[LIQ_R, 72, 54]} />
      </mesh>
      <Shell radius={SOMA_R} fireRef={() => S.fire} />
      {/* zero line */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[SOMA_R * 1.01, 0.004, 6, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.22} toneMapped={false} />
      </mesh>
      {/* bias ring (drag) */}
      <group ref={biasRing}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.012, 8, 96]} />
          <meshBasicMaterial color={ICE} transparent opacity={0.85} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} {...handlers}>
          <torusGeometry args={[1, 0.12, 6, 32]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={biasLabel}>
        <Billboard position={[-1.8, 0, 0]}>
          <LiveText get={() => `b ${fmt(S.bD)}`} fontSize={0.1} color={ICE} anchorX="right" anchorY="middle" letterSpacing={0.08} />
        </Billboard>
      </group>
      <Billboard position={[0, -1.32, 0]}>
        <LiveText get={() => `Σ  z = ${fmt(S.z)}`} fontSize={0.11} color="#ffffff" fillOpacity={0.8} anchorX="center" letterSpacing={0.08} />
      </Billboard>
      <Dial />
      <Shockwave />
    </group>
  );
}

/* ---------- Shockwave: an expanding ring each time the neuron fires ---------- */
function Shockwave() {
  const m = useRef();
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uT: { value: 9 }, uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uT; uniform float uA; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; float R = 0.42 + uT * 0.75; float w = 0.02 + uT * 0.06;
          float ring = exp(-pow((r - R) / w, 2.0)); float fade = exp(-uT * 3.2) * uA * smoothstep(1.0, 0.8, R) * smoothstep(1.0, 0.92, r);
          vec3 c = mix(vec3(1.0, 0.09, 0.012), vec3(1.0, 0.45, 0.25), ring) * 2.4;
          gl_FragColor = vec4(c * ring * fade, ring * fade); }`,
    }),
    [],
  );
  useFrame(() => {
    mat.uniforms.uT.value = S.wave;
    mat.uniforms.uA.value = S.waveAmp;
    if (m.current) m.current.visible = S.wave < 1.6;
  });
  return (
    <Billboard>
      <mesh ref={m} material={mat} renderOrder={7}>
        <planeGeometry args={[5, 5]} />
      </mesh>
    </Billboard>
  );
}

/* ---------- Output dial around the soma ---------- */
function Dial() {
  const N = 60;
  const geo = useMemo(() => {
    const pos = [];
    const idx = [];
    const ids = [];
    const a0 = Math.PI * 1.25;
    const span = Math.PI * 1.5;
    for (let i = 0; i < N; i++) {
      const a = a0 - (i / (N - 1)) * span;
      const major = i % 10 === 0 || i === N - 1;
      const r0 = 1.34;
      const r1 = major ? 1.5 : 1.43;
      const w = 0.011;
      const cx = Math.cos(a), cy = Math.sin(a);
      const px = -cy * w, py = cx * w;
      const v = pos.length / 3;
      pos.push(cx * r0 - px, cy * r0 - py, 0, cx * r1 - px, cy * r1 - py, 0, cx * r1 + px, cy * r1 + py, 0, cx * r0 + px, cy * r0 + py, 0);
      ids.push(i, i, i, i);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aIdx', new THREE.Float32BufferAttribute(ids, 1));
    g.setIndex(idx);
    return g;
  }, []);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: tickVert, fragmentShader: tickFrag, transparent: true, depthWrite: false,
      uniforms: { uVal: { value: 0 }, uFire: { value: 0 }, uN: { value: N - 1 }, uOpacity: { value: 1 } },
    }),
    [],
  );
  const val = useRef(0);
  useFrame((_, dt) => {
    val.current += (S.rate - val.current) * damp(1 - Math.exp(-Math.min(dt, 0.05) * 8));
    mat.uniforms.uVal.value = val.current + 0.001;
    mat.uniforms.uFire.value = S.fire;
  });
  return (
    <Billboard>
      <mesh geometry={geo} material={mat} />
      <LiveText
        get={() => `OUT ${ACTS[useNeuron.getState().act].sym}(z) = ${fmt(S.a)}`}
        position={[1.12, -1.18, 0]}
        fontSize={0.095}
        color="#ffffff"
        fillOpacity={0.75}
        anchorX="left"
        letterSpacing={0.08}
      />
    </Billboard>
  );
}

/* ---------- Axon with firing pulses ---------- */
function Axon() {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.95, -0.25, 0.05),
      new THREE.Vector3(1.9, -0.75, 0.25),
      new THREE.Vector3(3.6, -1.35, 0.1),
      new THREE.Vector3(6.2, -1.7, -0.9),
      new THREE.Vector3(10.5, -1.6, -3.4),
      new THREE.Vector3(16, -1.2, -7),
    ], false, 'centripetal'),
    [],
  );
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 260, 0.085, 18, false), [curve]);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: tubeVert, fragmentShader: axonFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPulse: { value: new THREE.Vector4(-1, -1, -1, -1) }, uAmp: { value: new THREE.Vector4() }, uTime: { value: 0 }, uLevel: { value: 0 } },
    }),
    [],
  );
  const sparks = useRef([]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const P = S.pulses;
    mat.uniforms.uPulse.value.set(P[0].p, P[1].p, P[2].p, P[3].p);
    mat.uniforms.uAmp.value.set(P[0].a, P[1].a, P[2].a, P[3].a);
    mat.uniforms.uTime.value = S.time;
    mat.uniforms.uLevel.value = S.rate;
    for (let i = 0; i < 4; i++) {
      const m = sparks.current[i];
      if (!m) continue;
      if (P[i].p < 0 || P[i].p > 1) { m.visible = false; continue; }
      m.visible = true;
      curve.getPointAt(Math.min(1, P[i].p), v);
      m.position.copy(v);
      m.scale.setScalar(0.6 + P[i].a * 0.5);
    }
  });
  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={3} />
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => (sparks.current[i] = el)} visible={false}>
          <sphereGeometry args={[0.1, 16, 12]} />
          <meshBasicMaterial color={new THREE.Color(4, 1.6, 0.8)} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- Activation function plot (3D ribbon that morphs) ---------- */
const PLOT_W = 3.2;
const Z_MAX = 5;
const Y_MIN = -1.05;
const Y_MAX = 1.6;
function Plot() {
  const ribbon = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFrom: { value: 1 }, uTo: { value: 1 }, uMix: { value: 1 }, uW: { value: PLOT_W }, uZMax: { value: Z_MAX }, uDepth: { value: 0.34 },
        uZ: { value: 0 }, uYMax: { value: Y_MAX }, uYMin: { value: Y_MIN }, uFire: { value: 0 }, uTime: { value: 0 },
      },
    }),
    [],
  );
  const ribbonGeo = useMemo(() => new THREE.PlaneGeometry(1, 1, 400, 6), []);
  const bead = useRef();
  const beadGlow = useRef();
  const dropV = useRef();
  const dropH = useRef();
  const grp = useRef();
  const beadMat = useRef();
  const axes = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = [];
    // z axis, y axis
    p.push(-PLOT_W / 2, 0, 0, PLOT_W / 2, 0, 0);
    p.push(0, Y_MIN, 0, 0, Y_MAX, 0);
    // ticks on z
    for (let z = -4; z <= 4; z++) {
      const x = (z / Z_MAX) * (PLOT_W / 2);
      const h = z % 2 === 0 ? 0.06 : 0.03;
      p.push(x, -h, 0, x, h, 0);
    }
    // gridlines at y = 1 and y = -1
    for (const y of [1, -1]) for (let k = -16; k < 16; k += 2) p.push((k / 16) * (PLOT_W / 2), y, 0, ((k + 1) / 16) * (PLOT_W / 2), y, 0);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, []);
  const c = useMemo(() => new THREE.Color(), []);
  const ice = useMemo(() => new THREE.Color(ICE), []);
  const hot = useMemo(() => new THREE.Color(3.2, 1.0, 0.45), []);
  useFrame(() => {
    const st = useNeuron.getState();
    const from = ACT_INDEX[st.prevAct];
    const to = ACT_INDEX[st.act];
    const m = S.morph;
    ribbon.uniforms.uFrom.value = from;
    ribbon.uniforms.uTo.value = to;
    ribbon.uniforms.uMix.value = m;
    const zc = Math.max(-Z_MAX, Math.min(Z_MAX, S.zD));
    ribbon.uniforms.uZ.value = zc;
    ribbon.uniforms.uFire.value = S.z > 0 ? Math.max(0.35, S.fire) : 0;
    ribbon.uniforms.uTime.value = S.time;
    const y = ACTS[st.prevAct].fn(zc) * (1 - m) + ACTS[st.act].fn(zc) * m;
    const yc = Math.max(Y_MIN, Math.min(Y_MAX, y));
    const x = (zc / Z_MAX) * (PLOT_W / 2);
    if (bead.current) bead.current.position.set(x, yc, 0);
    if (beadGlow.current) {
      beadGlow.current.position.set(x, yc, 0);
      beadGlow.current.scale.setScalar(1 + S.fire * 1.4);
    }
    if (beadMat.current) beadMat.current.color.copy(S.z > 0 ? c.copy(hot).multiplyScalar(0.6 + S.fire * 0.7) : c.copy(ice).multiplyScalar(1.1));
    if (dropV.current) { dropV.current.position.set(x, yc / 2, 0); dropV.current.scale.set(1, Math.abs(yc) + 1e-4, 1); }
    if (dropH.current) { dropH.current.position.set(x / 2, yc, 0); dropH.current.scale.set(Math.abs(x) + 1e-4, 1, 1); }
    // fade the whole plot out in the data step
    if (grp.current) {
      const s = 1 - S.dataT;
      grp.current.scale.setScalar(0.0001 + s);
      grp.current.visible = s > 0.02;
    }
  });
  return (
    <group position={[3.3, 1.15, -0.5]} rotation={[0, 0.32, 0]}>
      <group ref={grp}>
        <lineSegments geometry={axes}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.28} toneMapped={false} />
        </lineSegments>
        <mesh geometry={ribbonGeo} material={ribbon} renderOrder={4} />
        <mesh ref={dropV}>
          <boxGeometry args={[0.008, 1, 0.008]} />
          <meshBasicMaterial color={ICE} transparent opacity={0.45} toneMapped={false} />
        </mesh>
        <mesh ref={dropH}>
          <boxGeometry args={[1, 0.008, 0.008]} />
          <meshBasicMaterial color={ICE} transparent opacity={0.3} toneMapped={false} />
        </mesh>
        <mesh ref={bead}>
          <sphereGeometry args={[0.075, 24, 16]} />
          <meshBasicMaterial ref={beadMat} toneMapped={false} />
        </mesh>
        <mesh ref={beadGlow}>
          <sphereGeometry args={[0.16, 24, 16]} />
          <meshBasicMaterial color={SIGNAL} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
        </mesh>
        <Text font={MONO} fontSize={0.11} color="#ffffff" fillOpacity={0.45} position={[PLOT_W / 2 + 0.08, 0, 0]} anchorX="left" anchorY="middle" letterSpacing={0.1}>z</Text>
        <Text font={MONO} fontSize={0.1} color="#ffffff" fillOpacity={0.35} position={[-0.08, 1, 0]} anchorX="right" anchorY="middle">1</Text>
        <Text font={MONO} fontSize={0.1} color="#ffffff" fillOpacity={0.35} position={[-0.08, -1, 0]} anchorX="right" anchorY="middle">−1</Text>
        {[-4, -2, 2, 4].map((z) => (
          <Text key={z} font={MONO} fontSize={0.09} color="#ffffff" fillOpacity={0.3} position={[(z / Z_MAX) * (PLOT_W / 2), -0.17, 0]} anchorX="center">{z < 0 ? `−${-z}` : `${z}`}</Text>
        ))}
        <LiveText
          get={() => ACTS[useNeuron.getState().act].name.toUpperCase()}
          fontSize={0.2}
          color="#ffffff"
          position={[-PLOT_W / 2, Y_MAX + 0.32, 0]}
          anchorX="left"
          letterSpacing={0.12}
        />
        <LiveText
          get={() => ACTS[useNeuron.getState().act].formula}
          font={MONO}
          fontSize={0.105}
          color={ICE}
          fillOpacity={0.75}
          position={[-PLOT_W / 2, Y_MAX + 0.08, 0]}
          anchorX="left"
          letterSpacing={0.04}
        />
        <LiveText
          get={() => `z ${fmt(S.zD)} → ${fmt(ACTS[useNeuron.getState().act].fn(S.zD))}`}
          fontSize={0.1}
          color={ICE}
          fillOpacity={0.8}
          position={[PLOT_W / 2, Y_MIN - 0.1, 0]}
          anchorX="right"
          letterSpacing={0.08}
        />
      </group>
    </group>
  );
}

/* ---------- The whole neuron machine (moves aside for the data step) ---------- */
function NeuronMachine() {
  const g = useRef();
  useFrame(() => {
    const t = S.dataT;
    if (!g.current) return;
    g.current.position.set(-2.5 * t, -0.6 * t, -1.5 * t);
    g.current.scale.setScalar(Math.max(0.0001, 1 - t));
    g.current.visible = t < 0.98;
  });
  return (
    <group ref={g}>
      {ORBS.map((p, i) => <InputOrb key={i} i={i} pos={p} />)}
      {ORBS.map((p, i) => <Dendrite key={i} i={i} start={p} />)}
      <Soma />
      <Axon />
      <Plot />
    </group>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Step 5: the three inputs as a point in space. The decision boundary w·x + b = 0 is a plane.
 * ---------------------------------------------------------------------------------------------- */
const BOX = 3.0;
function DataSpace() {
  const grp = useRef();
  const spin = useRef();
  const pts = useRef();
  const halos = useRef();
  const probe = useRef();
  const plane = useRef();
  const cursor = useCursorLabel();
  const touch = useStore((s) => s.touch);
  const planeMat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: planeVert, fragmentShader: planeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uBoxInv: { value: new THREE.Matrix4() }, uHalf: { value: BOX / 2 }, uTime: { value: 0 }, uOpacity: { value: 0 }, uPulse: { value: 0 } },
    }),
    [],
  );
  const haloMat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: haloVert, fragmentShader: haloFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(1.4, 1.4, 1.5) }, uTime: { value: 0 } },
    }),
    [],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX, BOX, BOX)), []);
  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpV = useMemo(() => new THREE.Vector3(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpS = useMemo(() => new THREE.Vector3(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const nrm = useMemo(() => new THREE.Vector3(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const sig = useMemo(() => new THREE.Color(SIGNAL), []);
  const ice = useMemo(() => new THREE.Color(ICE), []);
  const drag = useRef(null);
  const rotY = useRef(0.55);

  useEffect(() => {
    if (!pts.current) return;
    for (let i = 0; i < N_POINTS; i++) {
      const d = DATA[i];
      tmpM.makeTranslation((d.p[0] - 0.5) * BOX, (d.p[1] - 0.5) * BOX, (d.p[2] - 0.5) * BOX);
      pts.current.setMatrixAt(i, tmpM);
      col.copy(d.label ? sig : ice);
      pts.current.setColorAt(i, col);
    }
    pts.current.instanceMatrix.needsUpdate = true;
    pts.current.instanceColor.needsUpdate = true;
  }, [tmpM, col, sig, ice]);

  useFrame((state, dt) => {
    const t = S.dataT;
    if (!grp.current) return;
    grp.current.visible = t > 0.01;
    if (!grp.current.visible) return;
    const e = 1 - Math.pow(1 - t, 3);
    grp.current.scale.setScalar(0.4 + 0.6 * e);
    grp.current.position.set(1.2, 0.35 - (1 - e) * 1.5, 0);
    if (!drag.current && !useStore.getState().reducedMotion) rotY.current += Math.min(dt, 0.05) * 0.05;
    if (spin.current) spin.current.rotation.y = rotY.current;
    planeMat.uniforms.uTime.value = S.time;
    planeMat.uniforms.uOpacity.value = e;
    planeMat.uniforms.uPulse.value = S.planePulse;
    haloMat.uniforms.uTime.value = S.time;
    // decision plane from the damped weights: w·p + b = 0, p in [0,1]^3
    const w = S.wD;
    const b = S.bD;
    const ww = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
    if (plane.current) {
      if (ww < 1e-4) plane.current.visible = false;
      else {
        plane.current.visible = true;
        const s = (w[0] * 0.5 + w[1] * 0.5 + w[2] * 0.5 + b) / ww;
        plane.current.position.set((0.5 - s * w[0] - 0.5) * BOX, (0.5 - s * w[1] - 0.5) * BOX, (0.5 - s * w[2] - 0.5) * BOX);
        nrm.set(w[0], w[1], w[2]).normalize();
        plane.current.quaternion.setFromUnitVectors(zAxis, nrm);
      }
    }
    if (spin.current) {
      spin.current.updateMatrixWorld();
      planeMat.uniforms.uBoxInv.value.copy(spin.current.matrixWorld).invert();
    }
    // mistakes get a blinking halo
    if (halos.current) {
      for (let i = 0; i < N_POINTS; i++) {
        const d = DATA[i];
        const pred = w[0] * d.p[0] + w[1] * d.p[1] + w[2] * d.p[2] + b > 0 ? 1 : 0;
        const sc = pred === d.label ? 0 : 1;
        tmpV.set((d.p[0] - 0.5) * BOX, (d.p[1] - 0.5) * BOX, (d.p[2] - 0.5) * BOX);
        tmpS.setScalar(sc);
        tmpM.compose(tmpV, tmpQ, tmpS);
        halos.current.setMatrixAt(i, tmpM);
      }
      halos.current.instanceMatrix.needsUpdate = true;
    }
    const pi = useNeuron.getState().probe;
    if (probe.current) {
      probe.current.visible = pi >= 0;
      if (pi >= 0) {
        const d = DATA[pi];
        probe.current.position.set((d.p[0] - 0.5) * BOX, (d.p[1] - 0.5) * BOX, (d.p[2] - 0.5) * BOX);
        probe.current.scale.setScalar(1 + Math.sin(S.time * 6) * 0.08);
      }
    }
  });

  const onPtMove = (e) => {
    if (drag.current) return;
    e.stopPropagation();
    if (e.instanceId != null && useNeuron.getState().probe !== e.instanceId) {
      useNeuron.getState().setProbe(e.instanceId);
      playBlip(DATA[e.instanceId].label ? 0.7 : 0.35, 0.2);
    }
  };

  return (
    <group ref={grp} visible={false}>
      <group ref={spin} rotation={[0, 0.55, 0]}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.16} toneMapped={false} />
        </lineSegments>
        {/* orbit-drag volume */}
        <mesh
          onPointerOver={() => !touch && cursor('Rotate')}
          onPointerOut={() => !drag.current && cursor(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.target.setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, r: rotY.current };
            window.__lenis?.stop?.();
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            rotY.current = drag.current.r + (e.clientX - drag.current.x) * 0.008;
          }}
          onPointerUp={(e) => {
            e.target.releasePointerCapture?.(e.pointerId);
            drag.current = null;
            window.__lenis?.start?.();
          }}
        >
          <boxGeometry args={[BOX, BOX, BOX]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
        </mesh>
        <instancedMesh ref={pts} args={[null, null, N_POINTS]} onPointerMove={onPtMove} onPointerDown={onPtMove}>
          <sphereGeometry args={[0.042, 14, 10]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
        <instancedMesh ref={halos} args={[null, null, N_POINTS]} material={haloMat} raycast={() => null}>
          <sphereGeometry args={[0.1, 16, 12]} />
        </instancedMesh>
        <mesh ref={probe} visible={false} raycast={() => null}>
          <torusGeometry args={[0.11, 0.006, 8, 48]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh ref={plane} material={planeMat} renderOrder={6} raycast={() => null}>
          <planeGeometry args={[BOX * 2, BOX * 2, 1, 1]} />
        </mesh>
        <Text font={MONO} fontSize={0.13} color="#ffffff" fillOpacity={0.45} position={[BOX / 2 + 0.1, -BOX / 2, BOX / 2]} anchorX="left" letterSpacing={0.1}>X1 →</Text>
        <Text font={MONO} fontSize={0.13} color="#ffffff" fillOpacity={0.45} position={[-BOX / 2, BOX / 2 + 0.12, BOX / 2]} anchorX="center" letterSpacing={0.1}>X2 ↑</Text>
        <Text font={MONO} fontSize={0.13} color="#ffffff" fillOpacity={0.45} position={[-BOX / 2 - 0.1, -BOX / 2, -BOX / 2]} anchorX="right" letterSpacing={0.1}>X3</Text>
      </group>
    </group>
  );
}

/* ---------- Dust for depth ---------- */
function Dust({ count }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 34;
      p[i * 3 + 1] = (Math.random() - 0.5) * 18;
      p[i * 3 + 2] = -Math.random() * 22 + 4;
      s[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    return g;
  }, [count]);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: 3.2 } },
    }),
    [],
  );
  useFrame(() => (mat.uniforms.uTime.value = S.time));
  return <points geometry={geo} material={mat} />;
}

/* ---------- Flash: a soft light that blooms the soma when it fires ---------- */
function FireLight() {
  const l = useRef();
  useFrame(() => {
    if (l.current) l.current.intensity = S.fire * 18;
  });
  return <pointLight ref={l} color={SIGNAL} position={[0.4, 0.3, 1.2]} distance={7} decay={2} />;
}

export default function NeuronScene() {
  const gpuTier = useStore((s) => s.gpuTier);
  const touch = useStore((s) => s.touch);
  useEffect(() => () => { S.dragging = false; }, []);
  const learning = useNeuron((s) => s.learning);
  useEffect(() => {
    if (!learning) S.planePulse = 1;
  }, [learning]);
  return (
    <>
      <color attach="background" args={['#050506']} />
      <fog attach="fog" args={['#050506', 10, 28]} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[-3, 5, 4]} intensity={1.2} color="#dff6ff" />
      <FireLight />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#A8F0FF" position={[0, 6, 2]} scale={[10, 2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} color="#5C7CFA" position={[-6, 0, 2]} scale={[2, 8, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="ring" intensity={1.5} color="#ffffff" position={[4, 2, 5]} scale={2.5} />
        <Lightformer form="rect" intensity={0.5} color="#ffffff" position={[0, -5, 0]} scale={[10, 10, 1]} rotation-x={-Math.PI / 2} />
      </Environment>
      <Sim />
      <Rig />
      <NeuronMachine />
      <DataSpace />
      <Dust count={gpuTier >= 2 ? 700 : 300} />
      <EffectComposer multisampling={gpuTier >= 2 && !touch ? 4 : 0} disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.18} intensity={1.15} radius={0.72} />
        <Noise opacity={0.045} />
        <Vignette offset={0.28} darkness={0.78} />
      </EffectComposer>
    </>
  );
}

export { playChord };
