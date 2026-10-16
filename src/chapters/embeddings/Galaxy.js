'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { live, damp } from '@/lib/store';
import { CLUSTER_COLORS, cosine } from './data';
import { starVert, starFrag, nebulaVert, nebulaFrag } from './shaders';

const SIGNAL = new THREE.Color('#ff4f1f');
const ICE = new THREE.Color('#a8f0ff');

/* ------------------------------------------------------------------ stars */
/** Does a label box starting at (x, y) with width w intersect any keep-out zone [l, t, r, b]? */
const ALWAYS_SHOW = new Set(['focus', 'answer', 'op', 'calc']);
/** Does a nebula name at (x, y) collide with a word label box [x, y, w]? */
function hitsWords(boxes, x, y, w) {
  if (!boxes) return false;
  for (const [qx, qy, qw] of boxes) if (x < qx + qw && qx < x + w && Math.abs(qy - y) < 16) return true;
  return false;
}

function inZone(zones, x, y, w) {
  if (!zones) return false;
  for (const z of zones) if (x < z[2] && x + w > z[0] && y > z[1] && y < z[3]) return true;
  return false;
}

function Stars({ G, S }) {
  const mat = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = G.N;
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const seed = new Float32Array(N);
    const state = new Float32Array(N);
    const c = new THREE.Color();
    const keys = G.clusters.map((k) => k.key);
    for (let i = 0; i < N; i++) {
      const k = G.cat[i] < 0 ? 'dust' : keys[G.cat[i]];
      c.set(CLUSTER_COLORS[k] || '#9fb0ff');
      // a little per-star hue / value jitter so nebulae aren't flat
      const j = ((i * 9301 + 49297) % 233280) / 233280;
      c.offsetHSL((j - 0.5) * 0.05, 0, (j - 0.5) * 0.12);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = G.cat[i] < 0 ? 0.55 + j * 0.35 : 0.8 + j * 0.5 + Math.pow(((i * 2654435761) % 1000) / 1000, 6) * 2.2;
      seed[i] = ((i * 7919) % 1000) / 1000;
    }
    g.setAttribute('position', new THREE.BufferAttribute(G.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aState', new THREE.BufferAttribute(state, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    return g;
  }, [G]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uDim: { value: 0 },
    uGlow: { value: 0 },
    uPx: { value: 300 },
    uHover: { value: -1 },
    uAmp: { value: 1 },
    uPulse: { value: 0 },
    uSignal: { value: new THREE.Color('#ff4f1f') },
    uIce: { value: new THREE.Color('#a8f0ff') },
  }), []);

  const ver = useRef(-1);
  const { size, gl } = useThree();

  useFrame((_, dt) => {
    const u = uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uPx.value = size.height * gl.getPixelRatio() * 0.19;
    u.uAmp.value = S.amp;
    const k = damp(1 - Math.exp(-dt * 2.4));
    u.uReveal.value += (S.reveal - u.uReveal.value) * damp(1 - Math.exp(-dt * 1.6));
    S.revealNow = u.uReveal.value;
    u.uDim.value += (S.dim - u.uDim.value) * k;
    u.uGlow.value += (S.glow - u.uGlow.value) * k;
    u.uHover.value = S.hover;
    u.uPulse.value = S.pulse();
    const o = S.origin;
    u.uOrigin.value.set(G.pos[o * 3], G.pos[o * 3 + 1], G.pos[o * 3 + 2]);
    if (ver.current !== S.version) {
      ver.current = S.version;
      const st = geo.attributes.aState;
      st.array.fill(0);
      for (const [i, v] of S.states) st.array[i] = v;
      st.needsUpdate = true;
    }
  });

  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        vertexShader={starVert}
        fragmentShader={starFrag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        premultipliedAlpha
      />
    </points>
  );
}

/* ---------------------------------------------------------------- nebulae */
function Nebulae({ G, S }) {
  const geo = useMemo(() => {
    const puffs = [];
    const c = new THREE.Color();
    G.clusters.forEach((cl, ci) => {
      c.set(CLUSTER_COLORS[cl.key] || '#9fb0ff');
      // sample a few member stars as puff centres so the cloud follows the cluster's real shape
      const members = [];
      for (let i = 0; i < G.N; i++) if (G.cat[i] === ci) members.push(i);
      const n = Math.min(9, Math.max(4, Math.round(members.length / 18)));
      for (let p = 0; p < n; p++) {
        const m = members[Math.floor(((p * 0.618 + ci * 0.31) % 1) * members.length)];
        const x = (G.pos[m * 3] + cl.x * 2) / 3, y = (G.pos[m * 3 + 1] + cl.y * 2) / 3, z = (G.pos[m * 3 + 2] + cl.z * 2) / 3;
        puffs.push([x, y, z, c.r, c.g, c.b, Math.min(16, cl.spread * (0.9 + (p % 3) * 0.35)), (p * 0.37 + ci * 0.11) % 1]);
      }
    });
    const N = puffs.length;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), seed = new Float32Array(N);
    puffs.forEach((p, i) => { pos.set(p.slice(0, 3), i * 3); col.set(p.slice(3, 6), i * 3); sz[i] = p[6]; seed[i] = p[7]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    return g;
  }, [G]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPx: { value: 300 }, uAmt: { value: 0 }, uOrigin: { value: new THREE.Vector3() } }), []);
  const { size, gl } = useThree();
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.05);
    uniforms.uPx.value = size.height * gl.getPixelRatio();
    const target = S.reveal * (1 - S.dim * 0.55) * (1 + S.glow * 0.8);
    uniforms.uAmt.value += (target - uniforms.uAmt.value) * damp(1 - Math.exp(-dt * 1.4));
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial vertexShader={nebulaVert} fragmentShader={nebulaFrag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} premultipliedAlpha />
    </points>
  );
}

/* --------------------------------------------------------------- backdrop */
function Backdrop() {
  const geo = useMemo(() => {
    const N = 1800; const p = new Float32Array(N * 3);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, t = r() * Math.PI * 2, R = 180 + r() * 120;
      const q = Math.sqrt(1 - u * u);
      p.set([R * q * Math.cos(t), R * u, R * q * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial size={1.1} sizeAttenuation={false} color="#6f7a96" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/* ---------------------------------------------------- neighbour hairlines */
function Links({ G, S }) {
  const ref = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const ver = useRef(-1);
  const t0 = useRef(0);
  useFrame((state) => {
    if (ver.current !== S.version) {
      ver.current = S.version;
      t0.current = state.clock.elapsedTime;
      const P = geo.attributes.position.array, C = geo.attributes.color.array;
      let n = 0;
      if (S.mode === 'search' && S.focus >= 0) {
        const f = S.focus;
        for (const nb of S.nbrs) {
          P.set([G.pos[f * 3], G.pos[f * 3 + 1], G.pos[f * 3 + 2], G.pos[nb.i * 3], G.pos[nb.i * 3 + 1], G.pos[nb.i * 3 + 2]], n * 6);
          const a = 0.35 + Math.max(0, (nb.cos - 0.3) / 0.5) * 0.9;
          // hot at the query end, cooling to ice at the neighbour
          C.set([SIGNAL.r * a * 1.4, SIGNAL.g * a * 1.4, SIGNAL.b * a * 1.4, ICE.r * a * 0.7, ICE.g * a * 0.7, ICE.b * a * 0.7], n * 6);
          n++;
        }
      } else if (S.mode === 'sentence') {
        // a sentence as a path through meaning: hot links between consecutive words
        const w = S.sentenceLit;
        for (let k = 1; k < w.length; k++) {
          const a = w[k - 1], b = w[k];
          P.set([G.pos[a * 3], G.pos[a * 3 + 1], G.pos[a * 3 + 2], G.pos[b * 3], G.pos[b * 3 + 1], G.pos[b * 3 + 2]], n * 6);
          C.set([SIGNAL.r * 0.9, SIGNAL.g * 0.9, SIGNAL.b * 0.9, SIGNAL.r * 1.6, SIGNAL.g * 1.6, SIGNAL.b * 1.6], n * 6);
          n++;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.userData.n = n;
      geo.setDrawRange(0, 0);
    }
    // lines grow out of the query one after another
    const t = state.clock.elapsedTime - t0.current;
    const shown = live.snap || S.mode === 'sentence' ? geo.userData.n || 0 : Math.min(geo.userData.n || 0, Math.floor(t * 14));
    geo.setDrawRange(0, shown * 2);
  });
  return (
    <lineSegments ref={ref} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

/* ------------------------------------------------------- analogy lens */
// The arithmetic is shown in a "lens": the involved words lift out of the galaxy into a LINEAR 3-D
// projection of their real 300-D vectors (see lensLayout), where a − b + c is an exact parallelogram.
const SEG = 40;
function seg(a, b) {
  const out = [];
  for (let i = 0; i <= SEG; i++) out.push(new THREE.Vector3().lerpVectors(a, b, i / SEG));
  return out;
}

function Arrow({ from, to, color, width = 2.2, start, dur, S, dashed = false, opacity = 1, head = 0.5 }) {
  const line = useRef();
  const cone = useRef();
  const pts = useMemo(() => seg(from, to), [from, to]);
  const len = from.distanceTo(to);
  const hs = Math.min(head, len * 0.3);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(to, from).normalize()), [from, to]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = live.snap ? 1 : Math.min(1, Math.max(0, (S.anaClock() - start) / dur));
    const e = 1 - Math.pow(1 - t, 3);
    const l = line.current;
    if (l && l.geometry) l.geometry.instanceCount = Math.max(0, Math.round(e * SEG * (dashed ? 1 : 1 - hs / Math.max(len, 1e-3) * 0.6)));
    if (cone.current) {
      tmp.lerpVectors(from, to, e);
      // pull the cone back so its tip lands on the target
      tmp.addScaledVector(new THREE.Vector3().subVectors(to, from).normalize(), -hs * 0.5);
      cone.current.position.copy(tmp);
      cone.current.scale.setScalar(t > 0.02 && !dashed ? hs : 0.0001);
    }
  });
  return (
    <group>
      <Line ref={line} points={pts} color={color} lineWidth={width} transparent opacity={opacity} dashed={dashed} dashSize={0.3} gapSize={0.22} toneMapped={false} depthWrite={false} />
      <mesh ref={cone} quaternion={quat} scale={0.0001}>
        <coneGeometry args={[0.36, 1, 20]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

const ORB_GEO = new THREE.SphereGeometry(1, 24, 16);
const W1 = new THREE.Vector3();
const W2 = new THREE.Vector3();

function Analogy({ G, S, ana }) {
  if (!ana) return null;
  return <Lens key={ana.id} G={G} S={S} ana={ana} />;
}

function Lens({ G, S, ana }) {
  const group = useRef();
  const orbs = useRef([]);
  const ring = useRef();
  const lift = useRef();
  const { camera } = useThree();
  const r = ana.ranks[0].i;
  const ids = [ana.a, ana.b, ana.c, -1, r];
  const local = useMemo(() => ana.lens.map((p) => new THREE.Vector3(p[0], p[1], p[2])), [ana]);
  const [A, B, C, L, R] = local;
  const anchor = useMemo(() => new THREE.Vector3(...ana.anchor), [ana]);
  const ice = useMemo(() => new THREE.Color('#a8f0ff').multiplyScalar(1.7), []);
  const sig = useMemo(() => new THREE.Color('#ff4f1f').multiplyScalar(2.6), []);
  const white = useMemo(() => new THREE.Color('#eaf6ff').multiplyScalar(1.5), []);
  const liftGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    return g;
  }, []);
  const q0 = useRef(null);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // the lens faces the viewer (with a slight lag so it feels like a physical plate)
    if (!q0.current) { q0.current = true; g.quaternion.copy(camera.quaternion); }
    g.quaternion.slerp(camera.quaternion, damp(1 - Math.exp(-dt * 1.5)));
    g.updateMatrixWorld();
    const t = live.snap ? 9 : S.anaClock();
    // orbs lift out of their stars: a, b, c first, the answer later
    const P = liftGeo.attributes.position.array;
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const o = orbs.current[k];
      if (!o || k === 3) continue;
      const i = ids[k];
      const t0 = k === 4 ? 2.55 : 0.05 + k * 0.12;
      const e = Math.min(1, Math.max(0, (t - t0) / 0.9));
      const ee = 1 - Math.pow(1 - e, 3);
      W1.set(G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]);
      W2.copy(W1);
      g.worldToLocal(W2);
      o.position.lerpVectors(W2, local[k], ee);
      o.scale.setScalar(e <= 0 ? 0.0001 : (k === 4 ? 0.3 : 0.2) * (1 + (k === 4 ? 0.25 * Math.sin(t * 4) : 0)));
      // world positions for labels
      o.getWorldPosition(S.virtual[k]);
      P.set([W1.x, W1.y, W1.z, S.virtual[k].x, S.virtual[k].y, S.virtual[k].z], n * 6);
      n++;
    }
    liftGeo.attributes.position.needsUpdate = true;
    if (ring.current) {
      const e = Math.min(1, Math.max(0, (t - 2.25) / 0.5));
      ring.current.scale.setScalar(e <= 0 ? 0.0001 : 0.32 + (1 - e) * 0.6);
      ring.current.material.opacity = 0.35 + e * 0.6;
      ring.current.getWorldPosition(S.virtual[3]);
    }
    S.virtualOn = t > 0.3 ? (t > 2.3 ? 5 : 3) : 0;
  });

  return (
    <>
      <lineSegments geometry={liftGeo} frustumCulled={false}>
        <lineBasicMaterial color="#5c7cfa" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <group ref={group} position={anchor}>
        {[A, B, C, L, R].map((p, k) =>
          k === 3 ? null : (
            <mesh key={k} ref={(el) => (orbs.current[k] = el)} geometry={ORB_GEO} scale={0.0001}>
              <meshBasicMaterial color={k === 4 ? sig : k === 0 ? white : ice} toneMapped={false} />
            </mesh>
          ),
        )}
        {/* the direction b → c (e.g. man → woman) */}
        <Arrow S={S} from={B} to={C} color={ice} start={0.9} dur={0.8} width={2.4} />
        {/* the same step, carried over to a: a + (c − b) */}
        <Arrow S={S} from={A} to={L} color={ice} start={1.55} dur={0.8} width={2.4} />
        {/* parallelogram edges */}
        <Arrow S={S} from={B} to={A} color="#7d95ff" width={1.2} start={1.2} dur={0.6} dashed opacity={0.75} />
        <Arrow S={S} from={C} to={L} color="#7d95ff" width={1.2} start={1.9} dur={0.6} dashed opacity={0.75} />
        {/* the gap between the computed point and the nearest real word */}
        <Arrow S={S} from={L} to={R} color={sig} width={2.2} start={2.6} dur={0.5} head={0.4} />
        <mesh ref={ring} position={L} scale={0.0001}>
          <ringGeometry args={[0.78, 0.92, 48]} />
          <meshBasicMaterial color={ice} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

/* ------------------------------------------------- camera, picking, labels */
const V = new THREE.Vector3();
const TGT = new THREE.Vector3();
const CAM = new THREE.Vector3();
const LOOK = new THREE.Vector3();

function Rig({ G, S }) {
  const { camera, size } = useThree();
  const frame = useRef(0);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const yaw = useRef(0.6);
  const screen = useMemo(() => new Float32Array((G.N + 5) * 3), [G]); // x, y, depth
  const slots = useRef([]); // [{i, val}]
  const triedBuf = useMemo(() => new Uint8Array(G.N), [G]);
  const cPlaced = useMemo(() => G.clusters.map(() => [0, 0, 0]), [G]);

  useFrame((state, dt) => {
    dt = Math.min(dt, 0.05);
    const f = ++frame.current;
    // ---------- camera targets
    const v = S.view();
    yaw.current += dt * (S.reduced ? 0 : v.spin);
    const d = S.drag;
    d.yaw += d.vy; d.pitch += d.vp; d.vy *= 0.92; d.vp *= 0.92;
    d.pitch = Math.max(-1.1, Math.min(1.1, d.pitch));
    const Y = yaw.current + d.yaw + live.pointer.x * 0.08;
    const Pt = v.pitch + d.pitch + live.pointer.y * 0.05;
    TGT.set(v.target[0], v.target[1], v.target[2]);
    CAM.set(Math.cos(Pt) * Math.sin(Y), Math.sin(Pt), Math.cos(Pt) * Math.cos(Y)).multiplyScalar(v.dist).add(TGT);
    // frame the subject away from the copy: look slightly left of it (desktop) / above it (mobile)
    LOOK.set(-Math.cos(Y), 0, Math.sin(Y)).multiplyScalar(v.dist * (v.shiftX ?? S.shiftX));
    LOOK.y += v.dist * S.shiftY;
    TGT.add(LOOK); CAM.add(LOOK);
    const k = damp(1 - Math.exp(-dt * (S.reduced ? 6 : 1.7)));
    camera.position.lerp(CAM, k);
    look.current.lerp(TGT, damp(1 - Math.exp(-dt * 2.4)));
    camera.lookAt(look.current);

    // ---------- project stars (for picking + labels)
    const W = size.width, H = size.height;
    const reveal = S.revealNow;
    const N = G.N;
    const ox = G.pos[S.origin * 3], oy = G.pos[S.origin * 3 + 1], oz = G.pos[S.origin * 3 + 2];
    const px = live.pointerPx.x - S.rect.left, py = live.pointerPx.y - S.rect.top;
    let best = -1, bestD = (S.touch ? 30 : 22) ** 2;
    for (let i = 0; i < N + 5; i++) {
      if (i < N) {
        V.set(G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]);
        if (reveal < 0.999) V.set(ox + (V.x - ox) * reveal, oy + (V.y - oy) * reveal, oz + (V.z - oz) * reveal);
      } else {
        if (i - N >= S.virtualOn) { screen[i * 3 + 2] = -1; continue; }
        V.copy(S.virtual[i - N]);
      }
      V.applyMatrix4(camera.matrixWorldInverse);
      const z = -V.z;
      V.applyMatrix4(camera.projectionMatrix);
      const sx = (V.x * 0.5 + 0.5) * W, sy = (-V.y * 0.5 + 0.5) * H;
      screen[i * 3] = sx; screen[i * 3 + 1] = sy; screen[i * 3 + 2] = z > 0.5 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1 ? z : -1;
      if (i < N && S.pointerIn && reveal > 0.5 && screen[i * 3 + 2] > 0) {
        const dx = sx - px, dy = sy - py, dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; best = i; }
      }
    }
    if (best !== S.hover) S.setHover(best);

    // ---------- choose labels (every few frames)
    const pool = S.labelEls;
    if (!pool.length) return;
    if (f % 5 === 1 || S.labelsDirty) {
      S.labelsDirty = false;
      // keep-out zones: on-screen overlay blocks ([data-ov-avoid]) where labels would sit on top of text
      const zones = (S.zones = S.zones || []);
      zones.length = 0;
      for (const el of document.querySelectorAll('[data-ov-avoid]')) {
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || parseFloat(getComputedStyle(el).opacity) < 0.05) continue;
        zones.push([b.left - S.rect.left - 8, b.top - S.rect.top - 12, b.right - S.rect.left + 8, b.bottom - S.rect.top + 8]);
      }
      const chosen = [];
      const taken = new Set();
      const placed = [];
      const collides = (x, y, w = 70) => {
        for (const [qx, qy, qw] of placed) if (x < qx + qw && qx < x + w && Math.abs(qy - y) < 15) return true;
        return false;
      };
      const wid = (word, val, kind) => (word.length + (val ? val.length + 1 : 0)) * (kind === 'focus' || kind === 'answer' ? 9.6 : 7.4) + 14;
      const add = (i, val, kind, word) => {
        if (i < 0 || taken.has(i) || chosen.length >= pool.length) return false;
        if (screen[i * 3 + 2] <= 0) return false;
        const x = screen[i * 3], y = screen[i * 3 + 1];
        const wd = word || G.words[i];
        const w = wid(wd, val, kind);
        // the query word and the analogy terms/answer always show; everything else stays off the overlay text
        if (!ALWAYS_SHOW.has(kind) && inZone(S.zones, x, y, w)) return false;
        let dy = 0;
        while (collides(x, y + dy, w) && dy < 64) dy += 15;
        taken.add(i); chosen.push({ i, val, kind, word: wd, dy });
        placed.push([x, y + dy, w]);
        return true;
      };
      for (const fx of S.forcedLabels) add(fx.i, fx.val, fx.kind, fx.word);
      if (S.hover >= 0) add(S.hover, S.hoverVal(), 'hover');
      if (reveal > 0.6) {
        // stars around the pointer, then the stars closest to the camera (allocation-free selection)
        const tried = triedBuf;
        const free = (i) => {
          const x = screen[i * 3], y = screen[i * 3 + 1];
          if (x < 20 || x > W - 80 || y < 70 || y > H - 80) return false;
          return !collides(x, y, wid(G.words[i], '', 'near'));
        };
        const pick = (limit, kind, metric) => {
          tried.fill(0);
          let got = 0;
          for (let pass = 0; pass < 40 && got < limit; pass++) {
            let bi = -1, bv = Infinity;
            for (let i = 0; i < N; i++) {
              if (tried[i] || screen[i * 3 + 2] <= 0) continue;
              const m = metric(i);
              if (m < bv) { bv = m; bi = i; }
            }
            if (bi < 0 || bv === Infinity) break;
            tried[bi] = 1;
            if (!taken.has(bi) && free(bi) && add(bi, '', kind)) got++;
          }
        };
        if (S.pointerIn && !S.touch) pick(6, 'near', (i) => { const dx = screen[i * 3] - px, dy = screen[i * 3 + 1] - py, d = dx * dx + dy * dy; return d < 150 * 150 ? d : Infinity; });
        if (S.ambientLabels > 0) pick(S.ambientLabels, 'ambient', (i) => screen[i * 3 + 2]);
      }
      slots.current = chosen;
      S.wordBoxes = placed; // nebula names keep clear of these
      for (let s = 0; s < pool.length; s++) {
        const el = pool[s];
        const c = chosen[s];
        if (!c) { if (el.dataset.on !== '0') { el.dataset.on = '0'; el.style.opacity = '0'; } continue; }
        if (el.firstChild.textContent !== c.word) el.firstChild.textContent = c.word;
        if (el.lastChild.textContent !== c.val) el.lastChild.textContent = c.val;
        if (el.dataset.kind !== c.kind) el.dataset.kind = c.kind;
        el.dataset.on = '1';
      }
    }
    const ch = slots.current;
    for (let s = 0; s < ch.length && s < pool.length; s++) {
      const i = ch[s].i;
      const el = pool[s];
      const z = screen[i * 3 + 2];
      if (z <= 0) { el.style.opacity = '0'; continue; }
      const strong = ch[s].kind !== 'ambient' && ch[s].kind !== 'near';
      const fade = strong ? 1 : Math.max(0, Math.min(1, (95 - z) / 50)) * (ch[s].kind === 'near' ? 1 : 0.8);
      el.style.opacity = String(fade * Math.min(1, reveal * 1.5 + (strong ? 1 : 0)));
      el.style.transform = `translate3d(${screen[i * 3].toFixed(1)}px, ${(screen[i * 3 + 1] + ch[s].dy).toFixed(1)}px, 0)`;
    }

    // ---------- nebula names (hidden where they would sit on overlay text)
    const cl = S.clusterEls;
    const show = S.clusterLabels;
    let nPlaced = 0;
    for (let c = 0; c < cl.length; c++) {
      const el = cl[c];
      if (!el) continue;
      const C = G.clusters[c];
      V.set(C.lx, C.ly + 2.2, C.lz).project(camera);
      const vis = show > 0.01 && V.z < 1 && Math.abs(V.x) < 0.95 && Math.abs(V.y) < 0.9;
      el.style.opacity = vis ? String(show) : '0';
      if (vis) {
        // nudge labels apart when two nebulae project onto each other
        const x = (V.x * 0.5 + 0.5) * W;
        let y = (-V.y * 0.5 + 0.5) * H;
        const w = C.label.length * 9 + 10;
        if (inZone(S.zones, x - w / 2, y, w) || hitsWords(S.wordBoxes, x - w / 2, y, w)) { el.style.opacity = '0'; continue; }
        for (let tries = 0; tries < 6; tries++) {
          let hit = false;
          for (let p = 0; p < nPlaced; p++) {
            const q = cPlaced[p];
            if (Math.abs(q[0] - x) < (q[2] + w) / 2 && Math.abs(q[1] - y) < 16) { hit = true; break; }
          }
          if (!hit) break;
          y -= 17;
        }
        const q = cPlaced[nPlaced++]; q[0] = x; q[1] = y; q[2] = w;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  });
  return null;
}

/* ------------------------------------------------------------------ fx */
function Effects({ S, tier }) {
  const bloom = useRef();
  useFrame((_, dt) => {
    if (!bloom.current) return;
    const target = 1.05 + S.glow * 1.1;
    bloom.current.intensity += (target - bloom.current.intensity) * damp(1 - Math.exp(-dt * 2));
  });
  return (
    <EffectComposer multisampling={0} disableNormalPass>
      <Bloom ref={bloom} mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.2} intensity={1.05} radius={0.78} levels={tier >= 2 ? 7 : 5} />
      <Noise opacity={0.035} premultiply />
      <Vignette offset={0.28} darkness={0.72} />
    </EffectComposer>
  );
}

export default function GalaxyScene({ G, S, ana, tier }) {
  return (
    <>
      <color attach="background" args={['#050506']} />
      <Backdrop />
      <Nebulae G={G} S={S} />
      <Stars G={G} S={S} />
      <Links G={G} S={S} />
      <Analogy G={G} S={S} ana={ana} />
      <Rig G={G} S={S} />
      <Effects S={S} tier={tier} />
    </>
  );
}

export { cosine };
