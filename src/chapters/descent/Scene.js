'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { live, damp } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import { lossGrad, GLOBAL_MIN, PLAY, EXTENT, S, H, hv, hvd, groundY } from './landscape';
import { Sim, OPT, ST } from './sim';
import { N_STEPS, DEMO, RACE, RACERS, SGD_NOISE } from './config';
import * as SH from './shaders';

const SIGNAL = new THREE.Color('#ff4f1f');
const ICE = new THREE.Color('#a8f0ff');
const FROST = new THREE.Color('#5c7cfa');
const WHITE = new THREE.Color('#ffffff');
const FOG = new THREE.Color('#06070a');
const PALETTE = [SIGNAL, ICE, WHITE];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pad = (n, w = 3) => String(Math.max(0, n | 0)).padStart(w, '0');

/* ------------------------------------------------------------------ terrain geometry */

function buildTerrain(N) {
  const n1 = N + 1;
  const pos = new Float32Array(n1 * n1 * 3);
  const aP = new Float32Array(n1 * n1 * 2);
  const aL = new Float32Array(n1 * n1 * 3);
  const o = [0, 0, 0];
  // denser near the centre, coarser toward the far walls
  const map = (a) => EXTENT * (0.42 * a + 0.58 * a * a * a);
  for (let j = 0; j <= N; j++) {
    const v = map(-1 + (2 * j) / N);
    for (let i = 0; i <= N; i++) {
      const u = map(-1 + (2 * i) / N);
      const k = j * n1 + i;
      lossGrad(u, v, o);
      pos[k * 3] = u * S;
      pos[k * 3 + 1] = hv(o[0]) * H;
      pos[k * 3 + 2] = -v * S;
      aP[k * 2] = u;
      aP[k * 2 + 1] = v;
      aL[k * 3] = o[0];
      aL[k * 3 + 1] = o[1];
      aL[k * 3 + 2] = o[2];
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(aP, 2));
  g.setAttribute('aL', new THREE.BufferAttribute(aL, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ ring-buffered trails */

function makeTrails(max) {
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  const mk = (n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const A = mk(3), B = mk(3), C = mk(3), M = mk(4);
  for (let i = 0; i < max; i++) M.array[i * 4] = -1e5; // born long ago → invisible
  quad.setAttribute('iA', A);
  quad.setAttribute('iB', B);
  quad.setAttribute('iColor', C);
  quad.setAttribute('iMeta', M);
  quad.instanceCount = max;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.trailVert,
    fragmentShader: SH.trailFrag,
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uClear: { value: -1e5 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  let head = 0, lo = Infinity, hi = -1;
  return {
    mesh, mat,
    add(ax, ay, az, bx, by, bz, col, k, birth, life, w) {
      const i = head;
      head = (head + 1) % max;
      A.array[i * 3] = ax; A.array[i * 3 + 1] = ay; A.array[i * 3 + 2] = az;
      B.array[i * 3] = bx; B.array[i * 3 + 1] = by; B.array[i * 3 + 2] = bz;
      C.array[i * 3] = col.r * k; C.array[i * 3 + 1] = col.g * k; C.array[i * 3 + 2] = col.b * k;
      M.array[i * 4] = birth; M.array[i * 4 + 1] = life; M.array[i * 4 + 2] = w; M.array[i * 4 + 3] = 1;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    },
    flush() {
      if (hi < 0) return;
      for (const [attr, n] of [[A, 3], [B, 3], [C, 3], [M, 4]]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(lo * n, (hi - lo + 1) * n);
        attr.needsUpdate = true;
      }
      lo = Infinity; hi = -1;
    },
  };
}

function makeMarks(max) {
  const g = new THREE.BufferGeometry();
  const P = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const C = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const M = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
  [P, C, M].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
  for (let i = 0; i < max; i++) M.array[i * 4] = -1e5;
  g.setAttribute('position', P);
  g.setAttribute('aColor', C);
  g.setAttribute('aMeta', M);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.markVert,
    fragmentShader: SH.markFrag,
    uniforms: { uTime: { value: 0 }, uClear: { value: -1e5 }, uPx: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    toneMapped: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  let head = 0, dirty = false;
  return {
    pts, mat,
    add(x, y, z, col, k, birth, life, size) {
      const i = head;
      head = (head + 1) % max;
      P.array[i * 3] = x; P.array[i * 3 + 1] = y; P.array[i * 3 + 2] = z;
      C.array[i * 3] = col.r * k; C.array[i * 3 + 1] = col.g * k; C.array[i * 3 + 2] = col.b * k;
      M.array[i * 4] = birth; M.array[i * 4 + 1] = life; M.array[i * 4 + 2] = size; M.array[i * 4 + 3] = 1;
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      P.needsUpdate = C.needsUpdate = M.needsUpdate = true;
      dirty = false;
    },
  };
}

/* ------------------------------------------------------------------ analytic picking */

const _p = new THREE.Vector3();
function pickTerrain(ray, rise, out) {
  const o = ray.origin, d = ray.direction;
  let prevT = 0;
  let t = 0.2;
  const lim = EXTENT * S;
  for (let n = 0; n < 400 && t < 220; n++) {
    _p.copy(d).multiplyScalar(t).add(o);
    if (Math.abs(_p.x) > lim || Math.abs(_p.z) > lim) {
      if (t > 40) return false;
    } else {
      const gy = groundY(_p.x / S, -_p.z / S, rise);
      if (_p.y < gy) {
        let a = prevT, b = t;
        for (let k = 0; k < 14; k++) {
          const m = (a + b) / 2;
          _p.copy(d).multiplyScalar(m).add(o);
          if (_p.y < groundY(_p.x / S, -_p.z / S, rise)) b = m;
          else a = m;
        }
        out.u = _p.x / S;
        out.v = -_p.z / S;
        return Math.abs(out.u) <= EXTENT - 0.5 && Math.abs(out.v) <= EXTENT - 0.5;
      }
    }
    prevT = t;
    t += 0.12 + t * 0.012;
  }
  return false;
}

/* ------------------------------------------------------------------ camera poses per step */

const POSES = [
  { p: [0, 7.6, 25.5], l: [0.5, 0.6, -2] }, // 0: grazing over the risen terrain
  { p: [19.5, 5.8, -9.5], l: [5.5, 0.4, 2.2] }, // 1: behind the demo ball, looking into the ravine
  { p: [-7.5, 6.4, 13], l: [6, 0.2, 1.5] }, // 2: across the ravine to see the zig-zag
  { p: [0.5, 25, 21], l: [0, -1.5, -1] }, // 3: high overview for the rain
  { p: [-3, 14.5, 25], l: [6, 0.4, 3.5] }, // 4: race, side-on
];
const POSE0_HIGH = { p: [0, 24, 21], l: [0, 0, -1.5] };

/* ------------------------------------------------------------------ the world */

export default function World({ progress, ctl, hud, gpuTier = 2, reducedMotion = false, touch = false }) {
  const { gl, camera, size } = useThree();
  const lite = gpuTier < 2;
  const MAX = lite ? 44 : 72;
  const RAIN = lite ? 28 : 48;

  const sim = useMemo(() => new Sim(MAX), [MAX]);
  const geo = useMemo(() => buildTerrain(lite ? 210 : 330), [lite]);
  const trails = useMemo(() => makeTrails(lite ? 5000 : 9000), [lite]);
  const marks = useMemo(() => makeMarks(2400), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRise: { value: reducedMotion ? 1 : 0 },
      uMin: { value: new THREE.Vector2(GLOBAL_MIN.u, GLOBAL_MIN.v) },
      uH: { value: H },
      uS: { value: S },
      uPlay: { value: PLAY },
      uHover: { value: new THREE.Vector4(0, 0, 0, 0) },
      uTarget: { value: new THREE.Vector4(0, 0, 0, 0) },
      uGlow: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
      uGlowCol: { value: [0, 1, 2, 3].map(() => new THREE.Color(0, 0, 0)) },
      uPulse: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, -100, 0)) },
      uIce: { value: ICE.clone() },
      uFrost: { value: FROST.clone() },
      uSignal: { value: SIGNAL.clone() },
      uFog: { value: FOG.clone() },
      uBase: { value: new THREE.Color('#15171d') },
      uFogD: { value: 0.017 },
    }),
    [reducedMotion]
  );
  const skyUniforms = useMemo(() => ({ uFog: { value: FOG.clone() }, uHorizon: { value: new THREE.Color('#121826') } }), []);

  const balls = useRef();
  const arrow = useRef();
  const arrowShaft = useRef();
  const arrowHead = useRef();
  const arrowLabel = useRef();

  // per-frame scratch (no allocations in the loop)
  const S_ = useRef({
    step: -1, time: 0, pendingDemo: null, pulseHead: 0, hudT: 0,
    hover: { on: false, u: 0, v: 0, L: 0, g: 0 }, ptr: { inside: false, x: 0, y: 0, dx: 0, dy: 0, dt: 0, down: false },
    camPos: new THREE.Vector3(0, 24, 21), camLook: new THREE.Vector3(0, 0, -1),
    tPos: new THREE.Vector3(), tLook: new THREE.Vector3(),
    m: new THREE.Matrix4(), q: new THREE.Quaternion(), sc: new THREE.Vector3(), pv: new THREE.Vector3(),
    dir: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), ray: new THREE.Raycaster(), ndc: new THREE.Vector2(),
    hit: { u: 0, v: 0 }, targetK: 0, arrowK: 0, race: [], o: [0, 0, 0], tap: null, lastFocus: -1,
  });

  // initial camera
  useEffect(() => {
    const s = S_.current;
    camera.position.copy(s.camPos);
    camera.lookAt(s.camLook);
  }, [camera]);

  // pointer: hover probe + tap-to-drop (analytic ray-march against the heightfield)
  useEffect(() => {
    const el = gl.domElement;
    const s = S_.current;
    const setPtr = (e) => {
      const r = el.getBoundingClientRect();
      s.ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      s.ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const move = (e) => {
      setPtr(e);
      if (e.pointerType === 'mouse') s.ptr.inside = true;
    };
    const leave = () => (s.ptr.inside = false);
    const down = (e) => {
      setPtr(e);
      s.ptr.down = true;
      s.ptr.dx = e.clientX; s.ptr.dy = e.clientY; s.ptr.dt = performance.now();
    };
    const up = (e) => {
      if (!s.ptr.down) return;
      s.ptr.down = false;
      const moved = Math.hypot(e.clientX - s.ptr.dx, e.clientY - s.ptr.dy);
      if (moved > 12 || performance.now() - s.ptr.dt > 700) return;
      setPtr(e);
      s.tap = { x: s.ptr.x, y: s.ptr.y, touch: e.pointerType !== 'mouse' };
    };
    const cancel = () => (s.ptr.down = false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [gl]);

  // instance colours must exist before first render
  useEffect(() => {
    const m = balls.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < MAX; i++) {
      m.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      m.setColorAt(i, c.set('#ffffff'));
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }, [MAX]);

  useEffect(() => () => {
    geo.dispose();
    trails.mesh.geometry.dispose();
    trails.mat.dispose();
    marks.pts.geometry.dispose();
    marks.mat.dispose();
  }, [geo, trails, marks]);

  /* ---------------- actions ---------------- */

  const actions = useMemo(() => {
    const tint = (b, col, k = 1) => {
      const m = balls.current;
      if (!m) return;
      m.setColorAt(b.i, S_.current.sc.set(col.r * k, col.g * k, col.b * k));
      m.instanceColor.needsUpdate = true;
    };
    return {
      dropMain(u, v) {
        const b = sim.spawn({
          tag: 'main', cap: 4, u, v, opt: OPT.GD, liveLr: true, lr: ctl.lr, interval: 0.11, radius: 0.34,
          color: 0, kind: 'main', trailLife: 1e4, trailW: 2.0, trailI: 2.4, glow: true, markers: true,
          dropH: 7, fallDur: 0.55, maxSteps: 1100,
        });
        tint(b, WHITE);
        sim.focus = b.i;
        playBlip(0.85, 0.5);
        return b;
      },
      rain(cu, cv) {
        const noise = ctl.noise ? SGD_NOISE : 0;
        const n = cu === undefined ? RAIN : 12;
        for (let k = 0; k < n; k++) {
          let u, v;
          if (cu === undefined) {
            u = (Math.random() * 2 - 1) * (PLAY - 0.25);
            v = (Math.random() * 2 - 1) * (PLAY - 0.25);
          } else {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.45;
            u = cu + Math.cos(a) * r; v = cv + Math.sin(a) * r;
          }
          const b = sim.spawn({
            tag: 'rain', cap: MAX - 6, u, v, opt: noise ? OPT.SGD : OPT.GD, noise, lr: 0.05, interval: 0.055,
            radius: 0.2, color: 0, kind: 'rain', trailLife: 3.5, trailW: 1.1, trailI: 0.75, glow: false, markers: false,
            delay: k * (cu === undefined ? 0.03 : 0.02), dropH: 9, fallDur: 0.6, maxSteps: 520,
          });
          tint(b, WHITE, 0.85);
        }
        playBlip(0.95, 0.4);
      },
      race(u, v) {
        sim.clear();
        S_.current.race = RACERS.map((r, k) => {
          const b = sim.spawn({
            tag: 'race', cap: 3, u, v, opt: r.opt, lr: r.lr, interval: 0.1, radius: 0.32, color: k, kind: 'race',
            trailLife: 1e4, trailW: 2.0, trailI: k === 0 ? 2.4 : 1.5, glow: true, markers: true,
            dropH: 7, fallDur: 0.55, maxSteps: 420,
          });
          tint(b, PALETTE[k], k === 2 ? 1 : 0.9);
          return { b, serial: b.serial, firstHit: -1 };
        });
        sim.focus = -1;
        S_.current.raceStart = { u, v };
        playBlip(0.7, 0.5);
      },
      clearAll(fadeTrails = true) {
        sim.clear();
        S_.current.race = [];
        if (fadeTrails) {
          trails.mat.uniforms.uClear.value = S_.current.time;
          marks.mat.uniforms.uClear.value = S_.current.time;
        }
      },
    };
  }, [sim, ctl, trails, marks, MAX, RAIN]);

  const pulse = (u, v, kind) => {
    const s = S_.current;
    const p = uniforms.uPulse.value[s.pulseHead];
    s.pulseHead = (s.pulseHead + 1) % 6;
    p.set(u, v, s.time, kind);
  };

  /* ---------------- the loop ---------------- */

  useFrame((state, rawDt) => {
    const s = S_.current;
    const dt = Math.min(rawDt, 1 / 20);
    s.time += dt;
    const time = s.time;
    const p = progress.current;
    const step = Math.min(N_STEPS - 1, Math.max(0, Math.floor(p * N_STEPS)));
    const rise = reducedMotion ? 1 : smooth(0.005, 0.15, p);
    uniforms.uTime.value = time;
    uniforms.uRise.value = rise;
    trails.mat.uniforms.uTime.value = time;
    marks.mat.uniforms.uTime.value = time;
    trails.mat.uniforms.uRes.value.set(size.width, size.height);
    marks.mat.uniforms.uPx.value = size.height * 0.9;
    ctl.step = step;

    // -- step changes: clear the stage and queue the demo for this step
    if (step !== s.step) {
      const first = s.step === -1;
      s.step = step;
      if (!first) actions.clearAll();
      s.pendingDemo = reducedMotion || step === 0 ? null : { step, at: time + (first ? 0.6 : 0.55) };
    }
    if (s.pendingDemo && time >= s.pendingDemo.at) {
      const d = s.pendingDemo.step;
      s.pendingDemo = null;
      if (d === 1) actions.dropMain(DEMO.u, DEMO.v);
      else if (d === 2) {
        if (!ctl.lrTouched) ctl.setLr?.(0.22);
        actions.dropMain(DEMO.u, DEMO.v);
      } else if (d === 3) actions.rain();
      else if (d === 4) actions.race(RACE.u, RACE.v);
    }

    // -- commands from the DOM overlay
    while (ctl.queue.length) {
      const c = ctl.queue.shift();
      if (c.type === 'drop') {
        if (step === 3) actions.rain();
        else if (step === 4) actions.race(RACE.u, RACE.v);
        else {
          const r = Math.random() * Math.PI * 2;
          actions.dropMain(step <= 2 && !c.random ? DEMO.u : GLOBAL_MIN.u + Math.cos(r) * 1.8, step <= 2 && !c.random ? DEMO.v : GLOBAL_MIN.v + Math.sin(r) * 1.8);
        }
      } else if (c.type === 'preset') {
        sim.clear('main');
        actions.dropMain(DEMO.u, DEMO.v);
      } else if (c.type === 'rain') {
        actions.clearAll();
        actions.rain();
      }
      else if (c.type === 'race') {
        const st = s.raceStart || RACE;
        actions.race(st.u, st.v);
      } else if (c.type === 'clear') actions.clearAll();
    }

    // -- pointer probe
    const ptr = s.ptr;
    let hovering = false;
    if (ptr.inside || s.tap) {
      const x = s.tap ? s.tap.x : ptr.x, y = s.tap ? s.tap.y : ptr.y;
      s.ndc.set(x, y);
      s.ray.setFromCamera(s.ndc, camera);
      hovering = pickTerrain(s.ray.ray, rise, s.hit);
      if (hovering) {
        s.hover.u = s.hit.u; s.hover.v = s.hit.v;
        lossGrad(s.hit.u, s.hit.v, s.o);
        s.hover.L = s.o[0]; s.hover.g = Math.hypot(s.o[1], s.o[2]);
        uniforms.uHover.value.x = s.hit.u;
        uniforms.uHover.value.y = s.hit.v;
      }
      if (s.tap) {
        if (hovering && rise > 0.5) {
          const { u, v } = s.hit;
          if (step === 3) actions.rain(u, v);
          else if (step === 4) actions.race(u, v);
          else actions.dropMain(u, v);
        }
        if (s.tap.touch) { s.tapGlow = time; }
        s.tap = null;
        hovering = hovering && ptr.inside;
      }
    }
    s.hover.on = hovering;
    const tapGlow = s.tapGlow ? Math.max(0, 1 - (time - s.tapGlow) / 1.2) : 0;
    const hk = hovering ? 1 : tapGlow;
    uniforms.uHover.value.z += (hk - uniforms.uHover.value.z) * damp(1 - Math.exp(-dt * 10));

    // -- simulate
    sim.update(dt, ctl.lr, reducedMotion && false);

    // -- events
    for (const e of sim.events) {
      const b = e.b;
      if (e.type === 'land') {
        if (b.kind !== 'rain') pulse(b.u, b.v, 1);
        b.lastTx = NaN;
        b.mkx = 1e9; b.mkz = 1e9;
      } else if (e.type === 'step') {
        const mx = e.u * S, mz = -e.v * S;
        if (b.markers && (mx - b.mkx) ** 2 + (mz - b.mkz) ** 2 > 0.09) {
          b.mkx = mx; b.mkz = mz;
          const y = groundY(e.u, e.v, rise) + 0.07;
          marks.add(mx, y, mz, PALETTE[b.color], b.color === 0 ? 1.5 : 0.8, time, b.trailLife, b.kind === 'race' ? 0.13 : 0.17);
        }
      } else if (e.type === 'rest') {
        if (b.kind !== 'rain') pulse(b.u, b.v, b.outcome === 'global' ? 0 : 1);
        if (b.outcome === 'global' && b.kind !== 'rain') playChord();
        else if (b.kind !== 'rain') playBlip(0.2, 0.3);
      } else if (e.type === 'diverge') {
        const len = Math.hypot(b.lastDu, b.lastDv) || 1;
        b.vx = (b.lastDu / len) * 9;
        b.vz = (-b.lastDv / len) * 9;
        b.vy = 11;
        b.fx = b.x ?? b.u * S; b.fy = b.y ?? 0; b.fz = b.z ?? -b.v * S;
        playBlip(1, 0.6);
      }
    }
    sim.events.length = 0;

    // -- balls → instances, trails
    const mesh = balls.current;
    let glowN = 0;
    for (const b of sim.balls) {
      let x = 0, y = 0, z = 0, sc = 0;
      const r = b.radius;
      switch (b.state) {
        case ST.FALL: {
          const k = b.fallT / b.fallDur;
          x = b.u * S; z = -b.v * S;
          y = groundY(b.u, b.v, rise) + r + b.dropH * (1 - k * k);
          sc = Math.min(1, k * 5);
          break;
        }
        case ST.RUN: {
          const a = Math.min(1, b.timer / b.interval);
          const e = a * a * (3 - 2 * a);
          const uu = b.pu + (b.u - b.pu) * e, vv = b.pv + (b.v - b.pv) * e;
          const y0 = groundY(b.pu, b.pv, rise), y1 = groundY(b.u, b.v, rise);
          const arc = Math.min(b.stepLen * S * 0.55, 9);
          x = uu * S; z = -vv * S;
          y = Math.max(y0 + (y1 - y0) * e + arc * 4 * e * (1 - e), groundY(uu, vv, rise)) + r;
          sc = 1;
          break;
        }
        case ST.REST:
          x = b.u * S; z = -b.v * S; y = groundY(b.u, b.v, rise) + r; sc = 1;
          break;
        case ST.FLY:
          b.vy -= 7 * dt;
          b.fx += b.vx * dt; b.fy += b.vy * dt; b.fz += b.vz * dt;
          x = b.fx; y = b.fy; z = b.fz;
          sc = Math.max(0, 1 - b.flyT / 2.2);
          break;
        case ST.FADE:
          x = b.x ?? 0; y = b.y ?? 0; z = b.z ?? 0;
          sc = Math.max(0, 1 - b.fadeT / 0.45) * (b.lastSc ?? 1);
          break;
        default:
          sc = 0;
      }
      if (b.state !== ST.FADE) b.lastSc = sc;
      b.x = x; b.y = y; b.z = z;
      if (mesh) {
        s.pv.set(x, y, z);
        s.sc.setScalar(Math.max(1e-4, sc * r));
        s.m.compose(s.pv, s.q.identity(), s.sc);
        mesh.setMatrixAt(b.i, s.m);
      }
      // trails
      if (b.state === ST.RUN || b.state === ST.REST || b.state === ST.FLY) {
        const ty = y - r * 0.75 + 0.06;
        if (Number.isNaN(b.lastTx)) {
          b.lastTx = x; b.lastTy = ty; b.lastTz = z;
        } else {
          const dd = (x - b.lastTx) ** 2 + (ty - b.lastTy) ** 2 + (z - b.lastTz) ** 2;
          if (dd > 0.012) {
            trails.add(b.lastTx, b.lastTy, b.lastTz, x, ty, z, PALETTE[b.color], b.trailI, time, b.trailLife, b.trailW);
            b.lastTx = x; b.lastTy = ty; b.lastTz = z;
          }
        }
      }
      // under-glow on the terrain
      if (b.glow && glowN < 4 && (b.state === ST.RUN || b.state === ST.REST || b.state === ST.FALL)) {
        const k = b.state === ST.REST ? 0.55 : b.state === ST.FALL ? b.fallT / b.fallDur : 1;
        uniforms.uGlow.value[glowN].set(b.state === ST.RUN ? x / S : b.u, b.state === ST.RUN ? -z / S : b.v, k, 0);
        const c = PALETTE[b.color];
        uniforms.uGlowCol.value[glowN].setRGB(c.r * (b.color === 0 ? 1.4 : 0.5), c.g * (b.color === 0 ? 1.4 : 0.5), c.b * (b.color === 0 ? 1.4 : 0.5));
        glowN++;
      }
    }
    for (let k = glowN; k < 4; k++) uniforms.uGlow.value[k].z = 0;
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
    trails.flush();
    marks.flush();

    // -- focus ball: next-step target ring + −∇L arrow
    const fb = sim.focus >= 0 ? sim.balls[sim.focus] : null;
    const fbLive = fb && fb.tag === 'main' && (fb.state === ST.RUN || fb.state === ST.REST);
    const showT = fbLive && step <= 2 ? 1 : 0;
    s.targetK += (showT - s.targetK) * damp(1 - Math.exp(-dt * 8));
    if (fbLive) {
      uniforms.uTarget.value.x = fb.u - ctl.lr * fb.gu;
      uniforms.uTarget.value.y = fb.v - ctl.lr * fb.gv;
    }
    uniforms.uTarget.value.z = s.targetK * (fb && fb.state === ST.REST ? 0.35 : 1);

    const showA = fbLive && fb.g > 0.01 && step <= 2 ? 1 : 0;
    s.arrowK += (showA - s.arrowK) * damp(1 - Math.exp(-dt * 8));
    if (arrow.current) {
      arrow.current.visible = s.arrowK > 0.02;
      if (fb && s.arrowK > 0.02) {
        const g = fb.g || 1e-6;
        const L = fb.L;
        // downhill in world: weights (−gu, −gv) → world (x, z) = (−gu, +gv)
        s.dir.set(-fb.gu / g, (-H * hvd(L) * g) / S, fb.gv / g).normalize();
        const len = Math.min(3.4, 0.5 + g * 1.3) * s.arrowK;
        const head = 0.34;
        arrowShaft.current.scale.set(1, Math.max(0.01, len - head), 1);
        arrowShaft.current.position.y = (len - head) / 2;
        arrowHead.current.position.y = len - head / 2;
        arrow.current.position.set(fb.x, fb.y - fb.radius * 0.35, fb.z);
        arrow.current.position.addScaledVector(s.dir, fb.radius * 1.1);
        arrow.current.quaternion.setFromUnitVectors(s.up, s.dir);
        if (arrowLabel.current) {
          arrowLabel.current.position.copy(arrow.current.position).addScaledVector(s.dir, len + 0.45);
          arrowLabel.current.position.y += 0.35;
          arrowLabel.current.quaternion.copy(camera.quaternion);
          arrowLabel.current.fillOpacity = s.arrowK;
        }
      }
    }
    if (arrowLabel.current) arrowLabel.current.visible = s.arrowK > 0.02;

    // -- camera: damped flight between per-step poses + pointer parallax
    let P = POSES[step];
    if (step === 0) {
      const k = reducedMotion ? 1 : smooth(0.0, 0.17, p);
      s.tPos.set(
        POSE0_HIGH.p[0] + (P.p[0] - POSE0_HIGH.p[0]) * k,
        POSE0_HIGH.p[1] + (P.p[1] - POSE0_HIGH.p[1]) * k,
        POSE0_HIGH.p[2] + (P.p[2] - POSE0_HIGH.p[2]) * k
      );
      s.tLook.set(
        POSE0_HIGH.l[0] + (P.l[0] - POSE0_HIGH.l[0]) * k,
        POSE0_HIGH.l[1] + (P.l[1] - POSE0_HIGH.l[1]) * k,
        POSE0_HIGH.l[2] + (P.l[2] - POSE0_HIGH.l[2]) * k
      );
    } else {
      s.tPos.set(P.p[0], P.p[1], P.p[2]);
      s.tLook.set(P.l[0], P.l[1], P.l[2]);
    }
    // gently keep the focus ball framed
    if (fb && fb.tag === 'main' && (step === 1 || step === 2) && fb.state !== ST.OFF) {
      s.tLook.x += (fb.x - s.tLook.x) * 0.25;
      s.tLook.z += (fb.z - s.tLook.z) * 0.25;
    }
    const aspect = size.width / size.height;
    if (aspect < 1) {
      const f = 1 + (1 - aspect) * 0.95;
      s.dir.copy(s.tPos).sub(s.tLook).multiplyScalar(f);
      s.tPos.copy(s.tLook).add(s.dir);
    }
    if (!reducedMotion && !touch) {
      s.tPos.x += live.pointer.x * 1.1;
      s.tPos.y += live.pointer.y * 0.6;
    }
    // never fly through a mountain
    s.tPos.y = Math.max(s.tPos.y, groundY(s.tPos.x / S, -s.tPos.z / S, rise) + 2.2);
    const kc = reducedMotion ? 1 : damp(1 - Math.exp(-dt * 1.6));
    s.camPos.lerp(s.tPos, kc);
    s.camLook.lerp(s.tLook, kc);
    camera.position.copy(s.camPos);
    camera.lookAt(s.camLook);

    // -- HUD readouts (≈ 10 Hz, DOM via refs, no React state)
    s.hudT -= dt;
    if (s.hudT <= 0 && hud.current) {
      s.hudT = 0.1;
      writeHud(hud.current, { s, sim, step, fb, ctl, touch });
    }
  });

  const fogCol = FOG;
  return (
    <>
      <color attach="background" args={[fogCol]} />
      <mesh scale={400} renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial vertexShader={SH.skyVert} fragmentShader={SH.skyFrag} uniforms={skyUniforms} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      <mesh geometry={geo} raycast={() => null}>
        <shaderMaterial vertexShader={SH.terrainVert} fragmentShader={SH.terrainFrag} uniforms={uniforms} />
      </mesh>

      <primitive object={trails.mesh} />
      <primitive object={marks.pts} />

      <instancedMesh ref={balls} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <sphereGeometry args={[1, 40, 28]} />
        <meshStandardMaterial color="#ffffff" metalness={1} roughness={0.12} envMapIntensity={2.2} />
      </instancedMesh>

      <group ref={arrow} visible={false}>
        <mesh ref={arrowShaft}>
          <cylinderGeometry args={[0.035, 0.035, 1, 10]} />
          <meshBasicMaterial color={ICE} toneMapped={false} transparent opacity={0.95} />
        </mesh>
        <mesh ref={arrowHead}>
          <coneGeometry args={[0.13, 0.34, 18]} />
          <meshBasicMaterial color={ICE} toneMapped={false} />
        </mesh>
      </group>
      <Text
        ref={arrowLabel}
        font="/fonts/JetBrainsMono-Medium.ttf"
        fontSize={0.34}
        color="#a8f0ff"
        anchorX="center"
        anchorY="middle"
        visible={false}
      >
        −∇L
      </Text>

      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#020203']} />
        <Lightformer form="rect" intensity={3.2} position={[0, 9, -12]} scale={[26, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#a8f0ff" position={[-12, 3, 4]} rotation-y={Math.PI / 2} scale={[14, 1.6, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#5c7cfa" position={[12, 2.5, 6]} rotation-y={-Math.PI / 2} scale={[14, 2.2, 1]} />
        <Lightformer form="circle" intensity={2.2} position={[4, 12, 8]} rotation-x={Math.PI / 2} scale={3} />
        <Lightformer form="rect" intensity={0.5} color="#1c2433" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
      </Environment>

      <EffectComposer multisampling={lite ? 0 : 4} disableNormalPass>
        <Bloom mipmapBlur intensity={lite ? 0.8 : 1.05} luminanceThreshold={0.82} luminanceSmoothing={0.18} radius={0.72} />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.32} />
        <Vignette offset={0.22} darkness={0.82} />
      </EffectComposer>
    </>
  );
}

/* ------------------------------------------------------------------ HUD writer */

function setT(el, str) {
  if (el && el.__t !== str) {
    el.__t = str;
    el.textContent = str;
  }
}

function writeHud(h, { s, sim, step, fb, ctl, touch }) {
  if (step === 4) {
    const race = s.race;
    let leader = -1, best = Infinity;
    for (let k = 0; k < 3; k++) {
      const r = race[k];
      const ok = r && r.b.serial === r.serial && r.b.state !== ST.OFF && r.b.state !== ST.FADE;
      setT(h[`r${k}`], ok ? `${r.b.L.toFixed(3)} · ${pad(r.b.t)}` : '— · —');
      if (ok) {
        if (r.firstHit < 0 && r.b.L < 0.02) r.firstHit = r.b.t;
        if (r.firstHit >= 0 && r.firstHit < best) { best = r.firstHit; leader = k; }
      }
      const line = h[`c${k}`];
      if (line) {
        if (!ok) { if (line.__t !== '') { line.__t = ''; line.setAttribute('points', ''); } continue; }
        const n = r.b.histN;
        const xMax = Math.max(80, ...race.map((q) => (q ? q.b.histN : 0)));
        const L0 = Math.max(0.5, r.b.hist[0]);
        let pts = '';
        const stride = Math.max(1, Math.floor(n / 160));
        for (let i = 0; i < n; i += stride) {
          pts += `${((i / xMax) * 240).toFixed(1)},${(104 - (Math.min(r.b.hist[i], L0) / L0) * 96).toFixed(1)} `;
        }
        line.setAttribute('points', pts);
      }
    }
    const allDone = race.length === 3 && race.every((r) => r.b.serial === r.serial && r.b.state === ST.REST);
    let status = race.length ? 'Racing…' : 'Click the terrain to start a race';
    if (leader >= 0) status = `${RACERS[leader].name} reached the minimum first · step ${pad(best)}`;
    if (allDone) {
      const stuck = race.filter((r) => r.b.outcome !== 'global').map((r) => RACERS[race.indexOf(r)].name);
      status = stuck.length ? `${stuck.join(' + ')} stuck in a local minimum` : 'All three found the minimum';
      if (leader >= 0) status = `${RACERS[leader].name} first (step ${pad(best)}) · ` + status;
    }
    setT(h.status, status);
    return;
  }

  if (step === 3) {
    const n = sim.count((b) => b.tag === 'rain');
    const g = sim.count((b) => b.tag === 'rain' && b.t > 30 && b.L < 0.3);
    const l = sim.count((b) => b.tag === 'rain' && b.L >= 0.3 && (b.state === ST.REST || (b.t > 120 && b.g < 0.5)));
    setT(h.mode, `${ctl.noise ? 'SGD' : 'GD'} × ${pad(n, 2)}`);
    setT(h.k0, 'Balls'); setT(h.v0, pad(n, 2));
    setT(h.k1, 'Global valley'); setT(h.v1, pad(g, 2));
    setT(h.k2, 'Local valley'); setT(h.v2, pad(l, 2));
    setT(h.k3, 'Rolling'); setT(h.v3, pad(n - g - l, 2));
    setT(h.status, n === 0 ? `${touch ? 'Tap' : 'Click'} to rain a cluster · or press Rain` : n - g - l > 0 ? (ctl.noise ? 'Noisy steps (SGD)…' : 'Exact steps (GD)…') : `${Math.round((g / Math.max(1, n)) * 100)}% found the global minimum`);
    return;
  }

  const live = fb && fb.tag === 'main' && fb.state !== ST.OFF && fb.state !== ST.FADE;
  if (live) {
    setT(h.mode, `Ball ${pad(fb.serial, 2)} · gradient descent`);
    setT(h.k0, 'Loss'); setT(h.v0, fb.L.toFixed(3));
    setT(h.k1, '|∇L|'); setT(h.v1, fb.g.toFixed(3));
    setT(h.k2, 'Step'); setT(h.v2, pad(fb.t));
    setT(h.k3, 'LR'); setT(h.v3, ctl.lr.toFixed(3));
    let st = 'Falling…';
    if (fb.state === ST.FLY) st = 'Diverged · flung off the map';
    else if (fb.state === ST.REST) st = fb.outcome === 'global' ? 'Converged · global minimum' : fb.outcome === 'local' ? 'Converged · stuck in a local minimum' : 'Gave up · still oscillating';
    else if (fb.state === ST.RUN) {
      if (fb.zig > 0.45 && fb.rising > 0.2) st = 'Overshooting · bouncing between walls';
      else if (fb.zig > 0.45) st = 'Zig-zagging across the valley';
      else if (ctl.lr < 0.012) st = 'Crawling · tiny steps';
      else st = 'Descending';
    }
    setT(h.status, st);
  } else {
    const hv_ = s.hover;
    setT(h.mode, hv_.on ? `Probe · w₁ ${hv_.u.toFixed(2)} · w₂ ${hv_.v.toFixed(2)}` : 'Probe');
    setT(h.k0, 'Loss'); setT(h.v0, hv_.on ? hv_.L.toFixed(3) : '—');
    setT(h.k1, '|∇L|'); setT(h.v1, hv_.on ? hv_.g.toFixed(3) : '—');
    setT(h.k2, 'Step'); setT(h.v2, '—');
    setT(h.k3, 'LR'); setT(h.v3, ctl.lr.toFixed(3));
    setT(h.status, `${touch ? 'Tap' : 'Click'} the terrain to drop a ball`);
  }
}
