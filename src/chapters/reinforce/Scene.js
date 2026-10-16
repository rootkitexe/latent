'use client'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard, Environment, Lightformer, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette, ToneMapping, TiltShift2 } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { live, damp, useStore } from '@/lib/store';
import { useChapter } from '@/lib/chapter';
import { playBlip, playChord } from '@/lib/audio';
import { FLOOR, WALL, PIT, GOAL, DC, DR, GridWorld, mulberry } from './rl';
import { makeTileMaterial, makeWallMaterial, makeBeamMaterial, makeDiscMaterial } from './materials';
import { STEPS } from './copy';

const FONT = '/fonts/JetBrainsMono-Medium.ttf';
export const BASE_RATE = 11; // visible steps per second at 1×
const SHOW_RATE = 5.5;
const AGENT_Y = 0.3;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function tileXZ(world, i, out) {
  const r = (i / world.w) | 0;
  const c = i % world.w;
  out.x = c - (world.w - 1) / 2;
  out.z = r - (world.h - 1) / 2;
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * Camera: keyframes per scroll step, smoothly blended, damped, with a little pointer parallax.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
const KEYS = [
  { pos: [12, 16.5, 18.5], look: [0, -0.6, 0.4], fog: [24, 52] },
  { pos: [-11.5, 12, 19], look: [0, -0.4, 0.8], fog: [22, 50] },
  { pos: [2, 25, 11.5], look: [0, -0.8, 0.8], fog: [24, 54] },
  { pos: [15.5, 14, 14.5], look: [0, -0.6, 0.2], fog: [22, 50] },
  { pos: [26, 56, 62], look: [2, -2, 3], fog: [62, 160] },
];

function CameraRig({ progress, reduced }) {
  const { camera, size, scene } = useThree();
  const cur = useRef({ pos: new THREE.Vector3(...KEYS[0].pos), look: new THREE.Vector3(...KEYS[0].look), init: false, fogN: 22, fogF: 46, ox: 0, oy: 0 });
  const tgtPos = useMemo(() => new THREE.Vector3(), []);
  const tgtLook = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    scene.fog = new THREE.Fog('#050506', 22, 46);
    scene.background = new THREE.Color('#050506');
    return () => { scene.fog = null; };
  }, [scene]);
  useFrame((_, dt) => {
    const p = progress.current;
    const s = Math.min(STEPS.length - 1, Math.max(0, p * STEPS.length - 0.5));
    const i = Math.min(STEPS.length - 2, Math.floor(s));
    const f = smooth(0.2, 0.8, s - i);
    const A = KEYS[i];
    const B = KEYS[i + 1];
    const aspect = size.width / size.height;
    const portrait = aspect < 1;
    const mult = portrait ? Math.min(2.6, Math.max(1, 0.7 / aspect)) : aspect < 1.35 ? 1.18 : 1;
    tgtPos.set(
      THREE.MathUtils.lerp(A.pos[0], B.pos[0], f),
      THREE.MathUtils.lerp(A.pos[1], B.pos[1], f),
      THREE.MathUtils.lerp(A.pos[2], B.pos[2], f),
    );
    tgtLook.set(
      THREE.MathUtils.lerp(A.look[0], B.look[0], f),
      THREE.MathUtils.lerp(A.look[1], B.look[1], f),
      THREE.MathUtils.lerp(A.look[2], B.look[2], f),
    );
    tgtPos.sub(tgtLook).multiplyScalar(mult).add(tgtLook);
    if (!reduced) {
      tgtPos.x += live.pointer.x * 0.7;
      tgtPos.y += live.pointer.y * 0.4;
    }
    const k = damp(reduced ? 1 : 1 - Math.exp(-dt * 2.6));
    const c = cur.current;
    if (!c.init) { c.pos.copy(tgtPos); c.look.copy(tgtLook); c.init = true; }
    c.pos.lerp(tgtPos, k);
    c.look.lerp(tgtLook, k);
    camera.position.copy(c.pos);
    camera.lookAt(c.look);
    const fn = THREE.MathUtils.lerp(A.fog[0], B.fog[0], f) * mult;
    const ff = THREE.MathUtils.lerp(A.fog[1], B.fog[1], f) * mult;
    c.fogN += (fn - c.fogN) * k;
    c.fogF += (ff - c.fogF) * k;
    if (scene.fog) { scene.fog.near = c.fogN; scene.fog.far = c.fogF; }
    // frame the diorama where the overlay leaves room: right on desktop, lower-middle on phones
    const tx = portrait ? 0 : -size.width * (aspect < 1.35 ? 0.1 : 0.15) * (1 - f * (i === 3 ? 0.6 : 0) - (i === 4 ? 0.6 : 0));
    const ty = portrait ? -size.height * 0.12 : -size.height * 0.02;
    c.ox += (tx - c.ox) * k;
    c.oy += (ty - c.oy) * k;
    const fov = portrait ? 34 : 30;
    if (camera.fov !== fov) camera.fov = fov;
    camera.setViewOffset(size.width, size.height, c.ox, c.oy, size.width, size.height);
    camera.updateProjectionMatrix();
  });
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * Route: a chain of thin instanced bars between tile centres (no per-frame allocation).
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
function useRouteMesh(max, color, y) {
  return useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 0.025, 0.07);
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.raycast = () => null;
    mesh.userData.y = y;
    return mesh;
  }, [max, color, y]);
}

function layoutRoute(mesh, world, pts, n, drawn) {
  // pts: tile indices; draws segments k=0..floor(drawn) with the last one partially
  const a = new THREE.Vector3();
  let count = 0;
  for (let k = 0; k < n - 1 && k < drawn; k++) {
    const frac = Math.min(1, drawn - k);
    tileXZ(world, pts[k], _p);
    tileXZ(world, pts[k + 1], a);
    const dx = a.x - _p.x;
    const dz = a.z - _p.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const L = len * frac + 0.07;
    _s.set(L, 1, 1);
    _e.set(0, -Math.atan2(dz, dx), 0);
    _q.setFromEuler(_e);
    _p.x += (dx / len) * (len * frac) * 0.5;
    _p.z += (dz / len) * (len * frac) * 0.5;
    _p.y = mesh.userData.y;
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(count++, _m);
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * The hero world.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
function World({ sim, progress, wrapRef, reduced, tier }) {
  const world = sim.world;
  const N = world.n;
  const tilesRef = useRef();
  const wallsRef = useRef();
  const arrowsRef = useRef();
  const orbRef = useRef();
  const orbLight = useRef();
  const orbGlow = useRef();
  const beaconRef = useRef();
  const beaconMesh = useRef();
  const goalLight = useRef();
  const beamRef = useRef();
  const shockRefs = useRef([]);
  const labelsRef = useRef();
  const [layout, setLayout] = useState({ v: -1, pits: [], goal: world.goal, start: world.start });

  const tileGeo = useMemo(() => {
    const g = new RoundedBoxGeometry(0.94, 0.2, 0.94, 2, 0.04);
    g.translate(0, -0.1, 0);
    g.setAttribute('aQ', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [N]);
  const tileMat = useMemo(() => makeTileMaterial({ quad: 0 }), []);
  const wallGeo = useMemo(() => { const g = new RoundedBoxGeometry(0.94, 1, 0.94, 3, 0.05); g.translate(0, 0.5, 0); return g; }, []);
  const wallMat = useMemo(() => makeWallMaterial(), []);
  const arrowGeo = useMemo(() => {
    const s = new THREE.Shape();
    // a chevron pointing toward −z (north) after rotation
    s.moveTo(0, 0.2); s.lineTo(0.15, 0.02); s.lineTo(0.09, 0.02); s.lineTo(0, 0.11); s.lineTo(-0.09, 0.02); s.lineTo(-0.15, 0.02); s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.translate(0, -0.08, 0);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const arrowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }), []);
  const orbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0b0d10', emissive: new THREE.Color('#bfefff'), emissiveIntensity: 3.2, roughness: 0.2, metalness: 0 }), []);
  const glowMat = useMemo(() => makeDiscMaterial([0.392, 0.871, 1.0], 0), []);
  const beamMat = useMemo(() => makeBeamMaterial([1, 0.078, 0.013], 0.9), []);
  const shockMats = useMemo(() => [0, 1, 2, 3].map(() => makeDiscMaterial([1, 0.2, 0.05], 1)), []);
  const policyRoute = useRouteMesh(96, new THREE.Color(0.392 * 1.1, 0.871 * 1.1, 1.1), 0.012);
  const showRoute = useRouteMesh(160, new THREE.Color(4, 1.3, 0.5), 0.03);

  const st = useMemo(() => ({
    acc: 0, phase: 'move', endT: 0, outcome: 0, spawn: 1,
    pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
    dq: new Float32Array(N * 4), pulse: new Float32Array(N), route: new Float32Array(N), routeT: new Float32Array(N),
    wallH: new Float32Array(N), pitY: new Float32Array(N), arrowA: new Float32Array(N), arrowS: new Float32Array(N),
    routePts: [], routeCheck: 0, routeKey: '', routeOK: false, policyOp: 0,
    showPts: new Int16Array(200), showN: 0, showOp: 0,
    beaconFlash: 0, orbHot: 0, goalPos: new THREE.Vector3(), goalInit: false,
    shocks: [0, 1, 2, 3].map(() => ({ t: 1, x: 0, z: 0, hot: true })), shockI: 0,
    quad: 0, labelOp: 1, version: -1, hover: -1, down: null, painting: false, paintKind: 0,
  }), [N]);

  // initial instance placement
  useEffect(() => {
    const t = tilesRef.current;
    for (let i = 0; i < N; i++) {
      tileXZ(world, i, _p);
      _p.y = 0;
      _m.makeTranslation(_p.x, 0, _p.z);
      t.setMatrixAt(i, _m);
      st.arrowA[i] = 0;
    }
    t.instanceMatrix.needsUpdate = true;
    // fixed bounds so raycasts reach every tile / wall regardless of their animated scale
    t.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 9);
    wallsRef.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 9);
  }, [N, world, st]);

  // shock helper
  const fire = (i, hot) => {
    const s = st.shocks[st.shockI++ % st.shocks.length];
    tileXZ(world, i, _p);
    s.x = _p.x; s.z = _p.z; s.t = 0; s.hot = hot;
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const p = progress.current;
    const step = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
    sim.scrollStep = step;
    const k6 = damp(1 - Math.exp(-dt * 6));

    // ── simulation ───────────────────────────────────────────────────────────
    // Scrolling into "values spread backward" with an agent that has barely learned: give it a
    // short visible burst of training so the step shows what it says.
    // (not under reduced motion: there the simulation only moves when the visitor asks it to)
    if (step === 2 && !sim.autoTrained && sim.mode === 'train' && !useStore.getState().reducedMotion) {
      sim.autoTrained = true;
      if (world.goals < 6) { sim.ffPending = true; sim.ffCount = 160; sim.ffShow = false; }
    }
    if (sim.ffPending) {
      sim.ffPending = false;
      sim.ffTotal = sim.ffLeft = sim.ffCount || 500;
      sim.ffCount = 0;
      sim.mode = 'ff';
      st.phase = 'move'; st.acc = 0;
      st.showOp = 0;
    }
    if (sim.mode === 'ff') {
      // train in visible chunks (~1.4 s) so the value heat washes backward from the goal
      const n = Math.min(sim.ffLeft, Math.max(1, Math.ceil(sim.ffTotal / (live.snap ? 1 : 85))));
      world.train(n);
      sim.ffLeft -= n;
      st.spawn = 0;
      if (sim.ffLeft <= 0) {
        if (sim.ffShow !== false) {
          // showcase: walk the learned policy greedily, drawing its path in light
          sim.mode = 'show';
          world.newEpisode(false);
          st.showN = 0; st.showPts[st.showN++] = world.s; st.showOp = 1;
          st.beaconFlash = 1;
          playChord();
        } else {
          sim.mode = 'train';
          world.newEpisode(false);
        }
        sim.ffShow = true;
        st.phase = 'move'; st.acc = 0;
      }
    }
    if (sim.resetPending) {
      sim.resetPending = false;
      st.phase = 'move'; st.acc = 0; st.spawn = 0; sim.mode = 'train';
    }
    const ffing = sim.mode === 'ff';
    const show = sim.mode === 'show';
    const rate = show ? SHOW_RATE : BASE_RATE * sim.speed;
    if (ffing) { /* stepping happens in bulk above */ }
    else if (st.phase === 'move') {
      if (sim.playing || show || sim.stepOnce) st.acc += sim.stepOnce ? 1 : dt * rate;
      sim.stepOnce = false;
      let guard = 0;
      while (st.acc >= 1 && guard++ < 600) {
        st.acc -= 1;
        world.step(show ? 0 : -1, !show);
        st.pulse[world.s] = 1;
        if (show && st.showN < st.showPts.length) st.showPts[st.showN++] = world.s;
        if (show && world.steps > 60) { world.done = true; world.outcome = 0; }
        if (world.done) {
          st.phase = 'end'; st.endT = 0; st.outcome = world.outcome; st.acc = 0;
          if (world.outcome === 1) {
            fire(world.s, true); st.beaconFlash = 1; st.orbHot = 1;
            if (sim.speed <= 1 || show) playChord();
          } else if (world.outcome === -1) {
            fire(world.s, false);
            if (sim.speed <= 1) playBlip(0.05, 0.6);
          }
          break;
        }
      }
    } else {
      st.endT += dt;
      const endDur = show ? 1.8 : 0.6 / Math.sqrt(sim.speed);
      if (st.endT > endDur) {
        if (show) { sim.mode = 'train'; world.newEpisode(false); }
        else world.newEpisode(true);
        st.phase = 'move'; st.acc = 0; st.spawn = 0;
      }
    }

    // ── layout change → React labels ─────────────────────────────────────────
    if (world.version !== st.version) {
      st.version = world.version;
      const pits = [];
      for (let i = 0; i < N; i++) if (world.tiles[i] === PIT) pits.push(i);
      setLayout({ v: world.version, pits, goal: world.goal, start: world.start });
      st.routeCheck = 1; // recompute route now
    }

    // ── greedy route (the policy, drawn) ─────────────────────────────────────
    st.routeCheck -= dt;
    if (st.routeCheck <= 0) {
      st.routeCheck = 0.25;
      world.greedyPath(st.routePts);
      const last = st.routePts[st.routePts.length - 1];
      st.routeOK = world.tiles[last] === GOAL;
      st.route.fill(0);
      if (st.routeOK) for (let k = 1; k < st.routePts.length - 1; k++) st.route[st.routePts[k]] = 1;
      const key = st.routeOK ? st.routePts.join(',') : '';
      if (key !== st.routeKey) {
        st.routeKey = key;
        if (st.routeOK) layoutRoute(policyRoute, world, st.routePts, st.routePts.length, 999);
      }
    }
    const routeVis = step >= 2 && st.routeOK && !show ? 1 : 0;
    st.policyOp += (routeVis * 0.55 - st.policyOp) * k6;
    policyRoute.material.opacity = st.policyOp;
    policyRoute.visible = st.policyOp > 0.01;

    // showcase trail
    if (show || st.showOp > 0.01) {
      const drawn = st.phase === 'end' || !show ? st.showN - 1 : Math.max(0, st.showN - 2 + Math.min(1, st.acc));
      layoutRoute(showRoute, world, st.showPts, st.showN, drawn);
      if (!show) st.showOp += (0 - st.showOp) * damp(1 - Math.exp(-dt * 1.2));
      showRoute.material.opacity = st.showOp;
    }
    showRoute.visible = st.showOp > 0.01;

    // ── tiles: heat, kinds, pulses, hover ────────────────────────────────────
    const aQ = tileGeo.attributes.aQ;
    const aI = tileGeo.attributes.aInfo;
    const Q = world.Q;
    const kq = damp(1 - Math.exp(-dt * (show ? 3 : 7)));
    for (let j = 0; j < N * 4; j++) st.dq[j] += (Q[j] - st.dq[j]) * kq;
    aQ.array.set(st.dq);
    aQ.needsUpdate = true;
    const decay = Math.exp(-dt * (show ? 0.15 : 1.1));
    const tilesM = tilesRef.current;
    const wallsM = wallsRef.current;
    const arrowsM = arrowsRef.current;
    const kw = damp(1 - Math.exp(-dt * 9));
    for (let i = 0; i < N; i++) {
      const kind = world.tiles[i];
      st.pulse[i] *= decay;
      st.routeT[i] += ((st.route[i] && step >= 2 && !show ? 0.55 : 0) - st.routeT[i]) * k6;
      const o = i * 4;
      aI.array[o] = kind;
      aI.array[o + 1] = st.pulse[i];
      aI.array[o + 2] = i;
      aI.array[o + 3] = st.routeT[i];
      // pit tiles sink; walls rise
      const pitT = kind === PIT ? -0.16 : 0;
      st.pitY[i] += (pitT - st.pitY[i]) * kw;
      tileXZ(world, i, _p);
      _p.y = st.pitY[i];
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      tilesM.setMatrixAt(i, _m);
      const wh = kind === WALL ? 0.45 + hash(i) * 0.75 : 0;
      st.wallH[i] += (wh - st.wallH[i]) * kw;
      const h = st.wallH[i];
      _p.y = 0;
      _s.set(h > 0.01 ? 1 : 0, Math.max(h, 0.001), h > 0.01 ? 1 : 0);
      _m.compose(_p, _q, _s);
      wallsM.setMatrixAt(i, _m);
      // arrows: greedy action, scaled by how decided the agent is
      const conf = kind === FLOOR ? world.confidence(i) : 0;
      const target = smooth(0.004, 0.06, conf) * (i === world.start && false ? 0 : 1);
      st.arrowS[i] += (target - st.arrowS[i]) * k6;
      const a = world.argmax(i);
      const goalA = -a * Math.PI / 2;
      let d = goalA - st.arrowA[i];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      st.arrowA[i] += d * damp(1 - Math.exp(-dt * 8));
      const sc = st.arrowS[i] * (0.85 + 0.15 * (step >= 2 ? 1 : 0));
      _p.y = st.pitY[i] + 0.006 + (sim.hover === i ? 0.06 : 0);
      _e.set(0, st.arrowA[i], 0);
      _q.setFromEuler(_e);
      _s.set(sc, 1, sc);
      _m.compose(_p, _q, _s);
      arrowsM.setMatrixAt(i, _m);
      const v = world.maxQ(i);
      _c.setRGB(0.55 + 0.45 * Math.max(0, v), 0.62 + 0.3 * Math.max(0, v), 0.68 + 0.2 * Math.max(0, v));
      arrowsM.setColorAt(i, _c);
    }
    aI.needsUpdate = true;
    tilesM.instanceMatrix.needsUpdate = true;
    wallsM.instanceMatrix.needsUpdate = true;
    arrowsM.instanceMatrix.needsUpdate = true;
    if (arrowsM.instanceColor) arrowsM.instanceColor.needsUpdate = true;
    arrowMat.opacity = 0.3 + 0.45 * smooth(0, 1, st.quad);

    // uniforms
    const U = tileMat.userData.uniforms;
    U.uTime.value = t;
    U.uHover.value = sim.hover;
    st.quad += ((step >= 2 && step < 4 ? 1 : 0) - st.quad) * damp(1 - Math.exp(-dt * 3));
    U.uQuad.value = st.quad;
    U.uHoverColor.value.set(sim.tool === WALL ? '#d9dde6' : sim.tool === PIT ? '#a8f0ff' : '#ff4f1f');
    if (sim.tool === GOAL) U.uHoverColor.value.multiplyScalar(1.4);

    // ── agent orb ────────────────────────────────────────────────────────────
    tileXZ(world, world.prev, st.from);
    tileXZ(world, world.s, st.to);
    let u = st.phase === 'move' ? Math.min(1, st.acc) : Math.min(1, st.endT * rate);
    if (st.phase === 'move' && !sim.playing && !show) u = 1;
    const e = easeInOut(u);
    st.pos.lerpVectors(st.from, st.to, e);
    let y = AGENT_Y + Math.sin(Math.PI * u) * 0.24;
    if (world.prev === world.s && world.steps > 0 && st.phase === 'move') {
      // bumped a wall: a small nudge toward it
      const b = Math.sin(Math.PI * u) * 0.22;
      st.pos.x += DC[world.lastA] * b;
      st.pos.z += DR[world.lastA] * b;
    }
    st.spawn = Math.min(1, st.spawn + dt * 3.5);
    let scale = easeInOut(st.spawn);
    if (st.phase === 'end') {
      const q = Math.max(0, st.endT * rate - 1) * 2.2;
      if (st.outcome === -1) { y -= Math.min(1, q) * 0.75; scale *= 1 - Math.min(1, q * 0.9); }
      else if (st.outcome === 1) { y += Math.min(1, q) * 0.5; scale *= 1 + Math.min(1, q) * 0.4 - Math.max(0, q - 1.2) * 1.4; }
      else scale *= 1 - Math.min(1, q);
    }
    scale = Math.max(0.0001, scale);
    const orb = orbRef.current;
    orb.position.set(st.pos.x, y + 0.02 * Math.sin(t * 3), st.pos.z);
    orb.scale.setScalar(scale);
    st.orbHot *= Math.exp(-dt * 1.6);
    const hot = st.orbHot;
    orbMat.emissive.setRGB(0.75 + 0.25 * hot, 0.94 - 0.62 * hot, 1 - 0.9 * hot);
    orbMat.emissiveIntensity = 3.2 + 3 * hot;
    orbLight.current.position.copy(orb.position);
    orbLight.current.color.copy(orbMat.emissive);
    orbLight.current.intensity = 2.2 * scale;
    orbGlow.current.position.set(st.pos.x, 0.006 + st.pitY[world.s] * u, st.pos.z);
    orbGlow.current.scale.setScalar(1.3 * scale * (1 - Math.max(0, y - AGENT_Y) * 0.8));
    glowMat.uniforms.uOpacity.value = 0.5;

    // ── goal beacon ──────────────────────────────────────────────────────────
    tileXZ(world, world.goal, _p);
    if (!st.goalInit) { st.goalPos.set(_p.x, 0, _p.z); st.goalInit = true; }
    st.goalPos.x += (_p.x - st.goalPos.x) * kw;
    st.goalPos.z += (_p.z - st.goalPos.z) * kw;
    st.beaconFlash *= Math.exp(-dt * 1.8);
    const bf = st.beaconFlash;
    beaconRef.current.position.set(st.goalPos.x, 0, st.goalPos.z);
    beaconMesh.current.position.y = 0.72 + Math.sin(t * 1.6) * 0.06;
    beaconMesh.current.rotation.y = t * 0.8;
    beaconMesh.current.scale.setScalar(1 + bf * 0.5);
    goalLight.current.intensity = 5 + bf * 18;
    beamMat.uniforms.uTime.value = t;
    beamMat.uniforms.uStrength.value = 0.55 + bf * 1.6;

    // ── shock rings ──────────────────────────────────────────────────────────
    for (let j = 0; j < st.shocks.length; j++) {
      const s = st.shocks[j];
      const m = shockRefs.current[j];
      if (!m) continue;
      s.t = Math.min(1, s.t + dt * 0.9);
      m.visible = s.t < 1;
      if (!m.visible) continue;
      m.position.set(s.x, 0.02, s.z);
      m.scale.setScalar(0.5 + easeInOut(s.t) * 2.6);
      shockMats[j].uniforms.uColor.value.set(...(s.hot ? [2.4, 0.4, 0.08] : [0.6, 1.4, 2.0]));
      shockMats[j].uniforms.uOpacity.value = (1 - s.t) * (1 - s.t);
    }

    // labels fade after the intro
    st.labelOp += ((step <= 1 ? 1 : 0.45) - st.labelOp) * k6;
    if (labelsRef.current) labelsRef.current.userData.op = st.labelOp;
  });

  // ── pointer: hover, click, drag-to-paint ───────────────────────────────────
  const setCursor = (label) => {
    const el = wrapRef.current;
    if (!el) return;
    const cur = el.getAttribute('data-cursor');
    if ((label || null) === cur) return;
    if (label) el.setAttribute('data-cursor', label); else el.removeAttribute('data-cursor');
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  };
  const toolLabel = () => (sim.tool === WALL ? 'Wall' : sim.tool === PIT ? 'Pit' : 'Goal');
  const applyEdit = (i, first) => {
    if (i == null || i < 0) return;
    let changed = false;
    if (first) {
      const before = world.tiles[i];
      changed = world.edit(i, sim.tool);
      st.paintKind = world.tiles[i] === before ? before : world.tiles[i];
    } else if (sim.tool !== GOAL) {
      changed = world.setTile(i, st.paintKind === GOAL ? FLOOR : st.paintKind);
    }
    if (changed) {
      sim.edits++;
      if (world.tiles[i] === GOAL) st.beaconFlash = 0.6;
      playBlip(sim.tool === PIT ? 0.2 : sim.tool === GOAL ? 0.9 : 0.55, 0.4);
    }
  };
  const onMove = (e) => {
    e.stopPropagation();
    const i = e.instanceId;
    if (i == null) return;
    sim.hover = i;
    setCursor(i === world.start ? 'Start' : toolLabel());
    if (st.painting && i !== st.lastPaint) { st.lastPaint = i; applyEdit(i, false); }
  };
  const onOut = () => { sim.hover = -1; setCursor(null); };
  const onDown = (e) => {
    e.stopPropagation();
    const i = e.instanceId;
    st.down = { i, x: e.clientX, y: e.clientY, type: e.pointerType };
    if (e.pointerType === 'mouse' && e.button === 0) {
      applyEdit(i, true);
      st.painting = true; st.lastPaint = i;
    }
  };
  const onUp = (e) => {
    const d = st.down;
    st.down = null;
    if (st.painting) { st.painting = false; return; }
    if (!d || d.type === 'mouse') return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && e.instanceId === d.i) applyEdit(d.i, true);
  };
  useEffect(() => {
    const up = () => { st.painting = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [st]);

  const labelPos = (i, y) => { const v = tileXZ(world, i, { x: 0, z: 0 }); return [v.x, y, v.z]; };

  return (
    <group>
      {/* plinth */}
      <mesh position={[0, -0.55, 0]} receiveShadow>
        <boxGeometry args={[world.w + 0.5, 0.7, world.h + 0.5]} />
        <meshStandardMaterial color="#0d0e12" roughness={0.5} metalness={0.5} envMapIntensity={0.6} />
      </mesh>
      <mesh position={[0, -0.205, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[world.w + 0.5, world.h + 0.5]} />
        <meshStandardMaterial color="#07080a" roughness={0.9} metalness={0.1} />
      </mesh>

      <instancedMesh ref={tilesRef} args={[tileGeo, tileMat, N]} receiveShadow onPointerMove={onMove} onPointerOut={onOut} onPointerDown={onDown} onPointerUp={onUp} />
      <instancedMesh ref={wallsRef} args={[wallGeo, wallMat, N]} castShadow receiveShadow onPointerMove={onMove} onPointerOut={onOut} onPointerDown={onDown} onPointerUp={onUp} frustumCulled={false} />
      <instancedMesh ref={arrowsRef} args={[arrowGeo, arrowMat, N]} frustumCulled={false} raycast={() => null} />
      <primitive object={policyRoute} />
      <primitive object={showRoute} />

      {/* agent */}
      <mesh ref={orbRef} material={orbMat} castShadow raycast={() => null}>
        <sphereGeometry args={[0.17, 32, 24]} />
      </mesh>
      <pointLight ref={orbLight} distance={3.2} decay={2} intensity={2} />
      <mesh ref={orbGlow} rotation={[-Math.PI / 2, 0, 0]} material={glowMat} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* goal beacon */}
      <group ref={beaconRef}>
        <mesh ref={beaconMesh} castShadow raycast={() => null}>
          <octahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color="#1a0600" emissive="#ff4f1f" emissiveIntensity={5} roughness={0.3} toneMapped />
        </mesh>
        <mesh ref={beamRef} position={[0, 2.2, 0]} material={beamMat} raycast={() => null}>
          <cylinderGeometry args={[0.32, 0.32, 4.4, 24, 1, true]} />
        </mesh>
        <pointLight ref={goalLight} position={[0, 0.8, 0]} color="#ff5a24" distance={4.5} decay={2} intensity={5} />
      </group>

      {/* shock rings */}
      {shockMats.map((m, j) => (
        <mesh key={j} ref={(el) => (shockRefs.current[j] = el)} rotation={[-Math.PI / 2, 0, 0]} material={m} visible={false} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}

      {/* labels */}
      <Labels ref={labelsRef} layout={layout} labelPos={labelPos} />
    </group>
  );
}


const Labels = forwardRef(function Labels({ layout, labelPos }, ref) {
  const group = useRef();
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const op = g.userData.op ?? 1;
    g.traverse((o) => {
      if (o.userData.base) o.fillOpacity = o.userData.base * op;
    });
  });
  const setRef = (el) => { group.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; };
  return (
    <group ref={setRef}>
      <Billboard position={labelPos(layout.goal, 1.25)}>
        <Text font={FONT} fontSize={0.26} color="#ff6a3a" anchorX="center" anchorY="middle" letterSpacing={0.05} userData={{ base: 1 }}>
          +1
        </Text>
      </Billboard>
      {layout.pits.map((i) => (
        <Billboard key={i} position={labelPos(i, 0.42)}>
          <Text font={FONT} fontSize={0.2} color="#a8f0ff" anchorX="center" anchorY="middle" userData={{ base: 0.9 }}>
            −1
          </Text>
        </Billboard>
      ))}
      <Billboard position={labelPos(layout.start, 0.62)}>
        <Text font={FONT} fontSize={0.13} color="#ffffff" anchorX="center" anchorY="middle" letterSpacing={0.18} userData={{ base: 0.55 }}>
          START
        </Text>
      </Billboard>
    </group>
  );
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * Many worlds training in parallel (the final pull-back).
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
function Multiverse({ progress, tier }) {
  const cols = tier >= 2 ? 7 : 5;
  const rows = tier >= 2 ? 7 : 5;
  const SP = 11.2;
  const worlds = useMemo(() => {
    const list = [];
    let seed = 7;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ox = (c - (cols - 1) / 2) * SP;
        const oz = (r - (rows - 1) / 2) * SP;
        if (Math.abs(ox) < 1 && Math.abs(oz) < 1) continue;
        const w = new GridWorld(9, 9, mulberry(seed++));
        w.randomLayout();
        w.eps = 0.12;
        w.alpha = 0.5;
        w.train(Math.floor(w.rand() * 260));
        list.push({ w, ox, oz, d: Math.hypot(ox, oz) / SP, from: new THREE.Vector3(), to: new THREE.Vector3(), acc: w.rand() });
      }
    }
    return list;
  }, [cols, rows]);
  const NW = worlds.length;
  const T = NW * 81;
  const tileGeo = useMemo(() => {
    const g = new RoundedBoxGeometry(0.94, 0.2, 0.94, 1, 0.04);
    g.translate(0, -0.1, 0);
    g.setAttribute('aQ', new THREE.InstancedBufferAttribute(new Float32Array(T * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(T * 4), 4).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [T]);
  const tileMat = useMemo(() => makeTileMaterial({ quad: 0 }), []);
  const wallGeo = useMemo(() => { const g = new THREE.BoxGeometry(0.94, 1, 0.94); g.translate(0, 0.5, 0); return g; }, []);
  const wallMat = useMemo(() => makeWallMaterial(), []);
  const orbMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 3.4, 4), toneMapped: false }), []);
  const goalMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.9, 0.18), toneMapped: false }), []);
  const plinthMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0d0e12', roughness: 0.5, metalness: 0.5 }), []);
  const tiles = useRef();
  const walls = useRef();
  const orbs = useRef();
  const goals = useRef();
  const plinths = useRef();
  const group = useRef();
  const st = useMemo(() => ({ rev: 0, lastRev: -1, frame: 0 }), []);

  useEffect(() => {
    tileMat.userData.uniforms.uHover.value = -999;
    tileMat.userData.uniforms.uHeat.value = 0.75;
    const aI = tileGeo.attributes.aInfo;
    for (let k = 0; k < NW; k++) {
      const w = worlds[k].w;
      for (let i = 0; i < 81; i++) { aI.array[(k * 81 + i) * 4] = w.tiles[i]; aI.array[(k * 81 + i) * 4 + 2] = -5; }
    }
    aI.needsUpdate = true;
  }, [NW, worlds, tileGeo, tileMat]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = progress.current;
    const target = smooth(0.74, 0.86, p);
    st.rev += (target - st.rev) * damp(1 - Math.exp(-dt * 2.5));
    if (st.rev < 0.002) { group.current.visible = false; return; }
    group.current.visible = true;
    tileMat.userData.uniforms.uTime.value = state.clock.elapsedTime;
    const animating = Math.abs(st.rev - st.lastRev) > 0.0005;
    st.frame++;

    for (let k = 0; k < NW; k++) {
      const W = worlds[k];
      const w = W.w;
      // reveal: rings of worlds rise out of the void, centre first
      const local = smooth(0, 1, st.rev * 2.2 - W.d * 0.28);
      const lift = (1 - local) * -9;
      const sc = 0.4 + 0.6 * local;
      if (animating) {
        for (let i = 0; i < 81; i++) {
          const r = (i / 9) | 0, c = i % 9;
          _p.set(W.ox + (c - 4) * sc, lift + (w.tiles[i] === PIT ? -0.16 : 0), W.oz + (r - 4) * sc);
          _q.identity();
          _s.set(local > 0.001 ? sc : 0, sc, sc);
          _m.compose(_p, _q, _s);
          tiles.current.setMatrixAt(k * 81 + i, _m);
          const h = w.tiles[i] === WALL ? (0.45 + hash(i + k * 81) * 0.75) * sc : 0;
          _p.y = lift;
          _s.set(h > 0 ? sc : 0, Math.max(h, 0.001), h > 0 ? sc : 0);
          _m.compose(_p, _q, _s);
          walls.current.setMatrixAt(k * 81 + i, _m);
        }
        _p.set(W.ox, lift - 0.55, W.oz);
        _s.set(9.5 * sc, 0.7, 9.5 * sc);
        _m.compose(_p, _q, _s);
        plinths.current.setMatrixAt(k, _m);
        W.lift = lift; W.sc = sc;
      }
      // learn live
      W.acc += dt * 26;
      while (W.acc >= 1) {
        W.acc -= 1;
        if (w.done) w.newEpisode(true);
        w.step();
      }
      const u = W.acc;
      const sc2 = W.sc ?? 1;
      const fr = w.prev, to = w.s;
      const fx = (fr % 9) - 4, fz = ((fr / 9) | 0) - 4, tx = (to % 9) - 4, tz = ((to / 9) | 0) - 4;
      _p.set(W.ox + (fx + (tx - fx) * u) * sc2, (W.lift ?? 0) + 0.3 + Math.sin(Math.PI * u) * 0.2, W.oz + (fz + (tz - fz) * u) * sc2);
      _q.identity();
      _s.setScalar(w.done ? 0.001 : sc2 * 0.2);
      _m.compose(_p, _q, _s);
      orbs.current.setMatrixAt(k, _m);
      const g = w.goal;
      _p.set(W.ox + ((g % 9) - 4) * sc2, (W.lift ?? 0) + 0.65 + Math.sin(state.clock.elapsedTime * 1.5 + k) * 0.06, W.oz + (((g / 9) | 0) - 4) * sc2);
      _e.set(0, state.clock.elapsedTime * 0.8 + k, 0);
      _q.setFromEuler(_e);
      _s.setScalar(0.18 * sc2);
      _m.compose(_p, _q, _s);
      goals.current.setMatrixAt(k, _m);
    }
    if (animating) {
      st.lastRev = st.rev;
      tiles.current.instanceMatrix.needsUpdate = true;
      walls.current.instanceMatrix.needsUpdate = true;
      plinths.current.instanceMatrix.needsUpdate = true;
    }
    orbs.current.instanceMatrix.needsUpdate = true;
    goals.current.instanceMatrix.needsUpdate = true;
    if (st.frame % 2 === 0) {
      const aQ = tileGeo.attributes.aQ;
      for (let k = 0; k < NW; k++) aQ.array.set(worlds[k].w.Q, k * 81 * 4);
      aQ.needsUpdate = true;
    }
  });

  return (
    <group ref={group} visible={false}>
      <instancedMesh ref={tiles} args={[tileGeo, tileMat, T]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={walls} args={[wallGeo, wallMat, T]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={plinths} args={[undefined, plinthMat, NW]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={orbs} args={[undefined, orbMat, NW]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
      </instancedMesh>
      <instancedMesh ref={goals} args={[undefined, goalMat, NW]} frustumCulled={false} raycast={() => null}>
        <octahedronGeometry args={[1, 0]} />
      </instancedMesh>
    </group>
  );
}

/* Dust motes for depth. */
function Dust({ count = 420 }) {
  const ref = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a = new Float32Array(count * 3);
    const r = mulberry(42);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (r() - 0.5) * 46;
      a[i * 3 + 1] = (r() - 0.5) * 16 + 1;
      a[i * 3 + 2] = (r() - 0.5) * 46;
    }
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    return g;
  }, [count]);
  useFrame((s, dt) => { if (ref.current) ref.current.rotation.y += Math.min(dt, 0.05) * 0.012; });
  return (
    <points ref={ref} geometry={geo} raycast={() => null}>
      <pointsMaterial size={0.045} color="#a8f0ff" transparent opacity={0.35} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function Lights({ tier }) {
  return (
    <>
      <hemisphereLight args={['#b8d4ff', '#050506', 0.35]} />
      <directionalLight
        position={[-6, 12, 7]}
        intensity={1.6}
        color="#e8eeff"
        castShadow={tier >= 1}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={1}
        shadow-camera-far={30}
      />
      <directionalLight position={[8, 5, -9]} intensity={0.45} color="#5c7cfa" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#dfe8ff" position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 6, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#a8f0ff" position={[-9, 3, 2]} rotation={[0, Math.PI / 2, 0]} scale={[10, 0.6, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#5c7cfa" position={[9, 2, -3]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 0.8, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, 4, 9]} scale={3} />
      </Environment>
    </>
  );
}

function Effects({ tier, portrait }) {
  return (
    <EffectComposer multisampling={0} disableNormalPass>
      <Bloom mipmapBlur luminanceThreshold={0.95} luminanceSmoothing={0.15} intensity={tier >= 2 ? 0.95 : 0.7} radius={0.72} />
      {tier >= 2 && !portrait ? <TiltShift2 blur={0.09} taper={0.65} start={[0, 0.52]} end={[1, 0.52]} samples={8} /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Noise opacity={0.035} premultiply />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  );
}

export default function Scene({ sim, wrapRef }) {
  const { progress } = useChapter();
  const tier = useStore((s) => s.gpuTier);
  const reduced = useStore((s) => s.reducedMotion);
  const { size } = useThree();
  const portrait = size.width < size.height;
  return (
    <>
      <CameraRig progress={progress} reduced={reduced} />
      <Lights tier={tier} />
      <World sim={sim} progress={progress} wrapRef={wrapRef} reduced={reduced} tier={tier} />
      <Multiverse progress={progress} tier={tier} />
      <Dust count={tier >= 2 ? 420 : 200} />
      <Effects tier={tier} portrait={portrait} />
    </>
  );
}
