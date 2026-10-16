'use client'

import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, RoundedBox, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { live, damp } from '@/lib/store';
import { HEADS } from './model';
import { fogU, timeU, makeSlabUniforms, slabShader, makeBeams, makeFloorMaterial, makeTowerMaterial } from './shaders';

const FONT = '/fonts/Archivo-ExpandedBold.ttf';
const MONO = '/fonts/JetBrainsMono-Medium.ttf';
export const SLAB_H = 1.3;
const SLAB_D = 0.16;
const GAP = 0.2;
const CGAP = 0.05;
const CH = 0.205; // per-character advance at the slab font size
const LINE_GAP = 0.62;
const BARS_H = 3.5;
const BARS_H_M = 2.6;
const ARC = 0.016;
const LAYERS = 96;
const BAR_SP = 0.82;

const headColor = Object.fromEntries(HEADS.map((h) => [h.id, new THREE.Color(h.color)]));
const now = () => performance.now() / 1000;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/* ---------------------------------------------------------------------------------------- layout */
export function computeLayout(tokens, aspect, barsCount) {
  // group continuation pieces with their word so a word never wraps mid-way
  const groups = [];
  tokens.forEach((t, i) => {
    const w = Math.max(0.64, 0.46 + t.text.length * CH);
    const item = { i, w, gap: t.cont ? CGAP : GAP };
    if (t.cont && groups.length) groups[groups.length - 1].items.push(item);
    else groups.push({ items: [item] });
  });
  if (barsCount) groups.push({ items: [{ i: -1, w: barsCount * BAR_SP, gap: GAP * 3, bars: true }] });
  // wide screens keep one line (the bars stand right after the last token); narrow screens wrap
  const maxW = aspect > 1.2 && barsCount ? 99 : Math.max(6.2, Math.min(34, aspect * (aspect < 1 ? 17 : 12.5)));
  const lines = [];
  let cur = [];
  let cw = 0;
  for (const g of groups) {
    const gw = g.items.reduce((a, it, k) => a + it.w + (k ? it.gap : 0), 0);
    const lead = cur.length ? g.items[0].gap : 0;
    if (cur.length && cw + lead + gw > maxW) {
      lines.push({ items: cur, w: cw });
      cur = [];
      cw = 0;
    }
    g.items.forEach((it, k) => {
      const gap = cur.length ? (k === 0 ? g.items[0].gap : it.gap) : 0;
      cur.push({ ...it, x0: cw + gap });
      cw += gap + it.w;
    });
  }
  if (cur.length) lines.push({ items: cur, w: cw });
  const slots = new Array(tokens.length);
  let bars = null;
  const nL = lines.length;
  const lh = lines.map((ln) => (ln.items.some((it) => it.bars) ? (aspect < 1 ? BARS_H_M : BARS_H) : SLAB_H));
  const H = lh.reduce((a, b) => a + b, 0) + LINE_GAP * (nL - 1);
  let top = H / 2;
  let floorY = 0;
  lines.forEach((ln, li) => {
    const bottom = top - lh[li];
    const y = bottom + SLAB_H / 2;
    for (const it of ln.items) {
      const x = it.x0 + it.w / 2 - ln.w / 2;
      const s = { x, y, z: ARC * x * x, ry: -Math.atan(2 * ARC * x), w: it.w, line: li };
      if (it.bars) bars = s;
      else slots[it.i] = s;
    }
    floorY = bottom;
    top = bottom - LINE_GAP;
  });
  const width = Math.max(...lines.map((l) => l.w), 1);
  return { slots, bars, width, height: H, lines: nL, floorY };
}

const topOf = (s) => [s.x, s.y + SLAB_H / 2 + 0.03, s.z];

/* ------------------------------------------------------------------------------------------ slab */
function Slab({ tok, slot, i, attn, color, sel, hover, dim, interactive, onOver, onOut, onPick, reduced }) {
  const w = slot.w;
  const uniforms = useMemo(() => makeSlabUniforms([w / 2, SLAB_H / 2, SLAB_D / 2]), [w]);
  const g = useRef();
  const born = useRef(now() + Math.min(i, 30) * 0.045);
  const pos = useRef(null);
  const tgt = useRef({});
  tgt.current = { attn, sel, hover, dim };
  useEffect(() => void uniforms.uAttnColor.value.set(color), [color, uniforms]);

  useFrame(() => {
    const o = g.current;
    if (!o) return;
    if (!pos.current) pos.current = new THREE.Vector3(slot.x, slot.y, slot.z);
    const p = pos.current;
    const k = damp(0.12);
    p.x += (slot.x - p.x) * k;
    p.y += (slot.y - p.y) * k;
    p.z += (slot.z - p.z) * k;
    const t = live.snap || reduced ? 1 : clamp01((now() - born.current) / 0.95);
    const e = 1 - Math.pow(1 - t, 4);
    const u = 1 - e;
    o.position.set(p.x, p.y - u * 2.4, p.z + u * 1.2);
    o.rotation.set(-u * 1.2, slot.ry + u * 0.4, 0);
    o.scale.setScalar(0.55 + 0.45 * e);
    const T = tgt.current;
    const kk = damp(0.14);
    uniforms.uAttn.value += (T.attn - uniforms.uAttn.value) * kk;
    uniforms.uSel.value += (T.sel - uniforms.uSel.value) * kk;
    uniforms.uHover.value += (T.hover - uniforms.uHover.value) * kk;
    uniforms.uDim.value += (T.dim - uniforms.uDim.value) * kk;
    uniforms.uFlash.value = u * u;
  });

  const label = tok.text.length > 14 ? tok.text.slice(0, 13) + '…' : tok.text;
  return (
    <group ref={g}>
      <RoundedBox
        args={[w, SLAB_H, SLAB_D]}
        radius={0.055}
        smoothness={4}
        onPointerOver={interactive ? (e) => { e.stopPropagation(); onOver(i); } : undefined}
        onPointerOut={interactive ? () => onOut(i) : undefined}
        onClick={interactive ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
      >
        <shaderMaterial uniforms={uniforms} vertexShader={slabShader.vertexShader} fragmentShader={slabShader.fragmentShader} />
      </RoundedBox>
      <Text font={FONT} fontSize={0.3} position={[0, 0.06, SLAB_D / 2 + 0.004]} anchorX="center" anchorY="middle" color={dim > 0.5 ? '#5a5f6a' : '#E6EBF2'} letterSpacing={-0.02}>
        {label === ' ' ? '␣' : label}
      </Text>
      <Text font={MONO} fontSize={0.085} position={[0, -SLAB_H / 2 + 0.16, SLAB_D / 2 + 0.004]} anchorX="center" anchorY="middle" color="#6f7684" letterSpacing={0.12}>
        {`ID ${tok.id}`}
      </Text>
      <Text font={MONO} fontSize={0.075} position={[-w / 2 + 0.1, SLAB_H / 2 - 0.13, SLAB_D / 2 + 0.004]} anchorX="left" anchorY="middle" color="#4a505c" letterSpacing={0.12}>
        {String(i).padStart(2, '0')}
      </Text>
      {tok.space && (
        <mesh position={[-w / 2 + 0.16, -SLAB_H / 2 + 0.16, SLAB_D / 2 + 0.004]}>
          <planeGeometry args={[0.1, 0.012]} />
          <meshBasicMaterial color="#4a505c" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------------------------- next-token bars */
function Bar({ x, slot, item, rank, onPick, interactive, reduced, maxH }) {
  const grp = useRef();
  const body = useRef();
  const lab = useRef();
  const h = useRef(0.02);
  const uniforms = useMemo(() => makeSlabUniforms([0.22, 0.5, 0.22]), []);
  const target = 0.06 + maxH * (item ? item.q : 0);
  const born = useRef(now() + rank * 0.05);
  useEffect(() => {
    uniforms.uAttnColor.value.set(rank === 0 ? '#FF4F1F' : '#A8F0FF');
  }, [rank, uniforms]);
  useFrame(() => {
    if (!grp.current) return;
    const t = live.snap || reduced ? 1 : clamp01((now() - born.current) / 0.6);
    h.current += (target * t - h.current) * damp(0.14);
    const hh = Math.max(0.02, h.current);
    body.current.scale.set(1, hh, 1);
    lab.current.position.y = hh + 0.18;
    const g = item ? Math.min(1, item.q * 2.2) : 0;
    uniforms.uAttn.value += ((rank === 0 ? 0.35 + g : g * 0.7) - uniforms.uAttn.value) * damp(0.15);
    const z = ARC * (slot.x + x) * (slot.x + x);
    grp.current.position.set(slot.x + x, slot.y - SLAB_H / 2, z);
    grp.current.rotation.y = -Math.atan(2 * ARC * (slot.x + x));
  });
  if (!item) return null;
  return (
    <group ref={grp}>
      <group ref={body}>
        <RoundedBox
          args={[0.44, 1, 0.44]}
          radius={0.03}
          smoothness={3}
          position={[0, 0.5, 0]}
          onPointerOver={interactive ? (e) => { e.stopPropagation(); uniforms.uHover.value = 1; document.body.style.cursor = 'pointer'; } : undefined}
          onPointerOut={interactive ? () => { uniforms.uHover.value = 0; document.body.style.cursor = ''; } : undefined}
          onClick={interactive ? (e) => { e.stopPropagation(); onPick(item.word); } : undefined}
        >
          <shaderMaterial uniforms={uniforms} vertexShader={slabShader.vertexShader} fragmentShader={slabShader.fragmentShader} />
        </RoundedBox>
      </group>
      <group ref={lab}>
        <Text font={FONT} fontSize={0.22} anchorX="center" anchorY="bottom" position={[0, 0.16, 0]} color={rank === 0 ? '#FFB38A' : '#DCE3EC'} maxWidth={1.2}>
          {item.word}
        </Text>
        <Text font={MONO} fontSize={0.11} anchorX="center" anchorY="bottom" position={[0, 0, 0]} color="#8d95a3" letterSpacing={0.08}>
          {`${(item.q * 100).toFixed(item.q < 0.1 ? 1 : 0)}%`}
        </Text>
      </group>
    </group>
  );
}

function Bars({ slot, dist, onPick, k, interactive, reduced, maxH }) {
  const items = dist.slice(0, k);
  return (
    <group>
      <group position={[slot.x, slot.y - SLAB_H / 2 + 0.006, ARC * slot.x * slot.x + 0.36]} rotation={[0, -Math.atan(2 * ARC * slot.x), 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[k * BAR_SP, 0.012]} />
          <meshBasicMaterial color="#FF4F1F" toneMapped={false} transparent opacity={0.7} />
        </mesh>
        <Text font={MONO} fontSize={0.075} anchorX="left" anchorY="top" position={[-(k * BAR_SP) / 2, 0.0, 0.05]} rotation={[-Math.PI / 2, 0, 0]} color="#8a919e" letterSpacing={0.16}>
          P( NEXT TOKEN )
        </Text>
      </group>
      {Array.from({ length: k }, (_, r) => (
        <Bar key={r} rank={r} x={(r - (k - 1) / 2) * BAR_SP} slot={slot} item={items[r]} onPick={onPick} interactive={interactive} reduced={reduced} maxH={maxH} />
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------------------- tower of layers */
function Tower({ layout, tokens, att, stackRef, gy, gz }) {
  const n = tokens.length;
  const count = (LAYERS - 1) * n;
  const mat = useMemo(() => makeTowerMaterial(), []);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const L = new Float32Array(count);
    const R = new Float32Array(count);
    for (let k = 0; k < LAYERS - 1; k++) for (let j = 0; j < n; j++) {
      L[k * n + j] = k;
      R[k * n + j] = (Math.sin((k * 31.7 + j * 7.3) * 12.9898) * 43758.5453) % 1;
    }
    for (let i = 0; i < count; i++) R[i] = Math.abs(R[i]);
    g.setAttribute('aLayer', new THREE.InstancedBufferAttribute(L, 1));
    g.setAttribute('aRand', new THREE.InstancedBufferAttribute(R, 1));
    return g;
  }, [count, n]);
  const mesh = useRef();
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let k = 0; k < LAYERS - 1; k++) for (let j = 0; j < n; j++) {
      const s = layout.slots[j];
      o.position.set(s.x, s.y + (k + 1) * gy, s.z - (k + 1) * gz);
      o.rotation.set(0, s.ry, 0);
      o.scale.set(s.w * 0.98, SLAB_H * 0.92, 0.07);
      o.updateMatrix();
      m.setMatrixAt(k * n + j, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [layout, n, gy, gz, count]);

  // faint attention arcs inside every layer + residual-stream threads through the whole stack
  const beams = useMemo(() => makeBeams(LAYERS * n + 8, { width: 0.022, intensity: 0.55 }), [n]);
  const threads = useMemo(() => makeBeams(n + 2, { width: 0.012, intensity: 0.9, flowDir: -1 }), [n]);
  const prefix = useRef([]);
  useEffect(() => {
    const list = [];
    const pre = [0];
    for (let k = 0; k < LAYERS - 1; k++) {
      const h = HEADS[k % HEADS.length];
      const W = att[h.id].weights;
      for (let i = 0; i < n; i++) {
        const row = W[i];
        let best = -1, bw = 0;
        for (let j = 0; j < n; j++) if (j !== i && row[j] > bw) { bw = row[j]; best = j; }
        if (best < 0 || bw < 0.3) continue;
        const a = topOf(layout.slots[i]); a[1] += (k + 1) * gy - 0.07; a[2] -= (k + 1) * gz;
        const b = topOf(layout.slots[best]); b[1] += (k + 1) * gy - 0.07; b[2] -= (k + 1) * gz;
        list.push({ a, b, c: headColor[h.id], w: bw * 0.6, h: 0.18 + 0.05 * Math.abs(i - best), z: 0.1, phase: (k * 0.37 + i * 0.11) % 1 });
      }
      pre.push(list.length);
    }
    beams.write(list);
    prefix.current = pre;
    threads.write(layout.slots.map((s, j) => {
      const a = [s.x, s.y - SLAB_H / 2 + 0.02, s.z + SLAB_D / 2 + 0.03];
      return { a, b: [s.x, s.y + LAYERS * gy, s.z - LAYERS * gz + SLAB_D / 2 + 0.03], c: headColor.prev, w: 0.25, h: 0, z: 0, phase: j * 0.21 };
    }));
  }, [att, layout, gy, gz, n, beams, threads]);
  useEffect(() => () => { geo.dispose(); }, [geo]);
  useEffect(() => () => { mat.dispose(); }, [mat]);
  useEffect(() => () => { beams.geometry.dispose(); beams.material.dispose(); threads.geometry.dispose(); threads.material.dispose(); }, [beams, threads]);

  const grp = useRef();
  useFrame(() => {
    const s = stackRef.current;
    mat.uniforms.uStack.value = s;
    const layersOn = Math.max(0, Math.min(LAYERS - 1, Math.floor(s)));
    beams.geometry.instanceCount = s > 0.2 ? prefix.current[layersOn] || 0 : 0;
    threads.material.uniforms.uIntensity.value = 1.1 * clamp01(s / 6);
    if (grp.current) grp.current.visible = s > 0.01;
  });
  return (
    <group ref={grp}>
      <instancedMesh key={count} ref={mesh} args={[geo, mat, count]} frustumCulled={false} />
      <mesh geometry={beams.geometry} material={beams.material} frustumCulled={false} />
      <mesh geometry={threads.geometry} material={threads.material} frustumCulled={false} />
    </group>
  );
}

/* --------------------------------------------------------------------------------------- dust */
function Dust({ count = 420 }) {
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 40;
      p[i * 3 + 1] = Math.random() * 30 - 3;
      p[i * 3 + 2] = (Math.random() - 0.5) * 30 - 4;
      s[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: timeU, ...fogU },
      vertexShader: `attribute float aS; uniform float uTime; varying float vA; varying float vD;
        void main(){ vec3 p = position; p.y += mod(uTime*0.08*(0.3+aS), 30.0); p.y = mod(p.y + 3.0, 30.0) - 3.0;
          p.x += sin(uTime*0.2 + aS*20.0)*0.3; vec4 mv = modelViewMatrix*vec4(p,1.0); vD = -mv.z;
          gl_PointSize = (1.0 + aS*2.2) * 22.0 / max(1.0, vD); vA = 0.25 + 0.75*aS; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uFogColor; uniform float uFogDensity; varying float vA; varying float vD;
        void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); float f = exp(-uFogDensity*uFogDensity*vD*vD*0.6);
          gl_FragColor = vec4(vec3(0.5,0.75,1.0)*a*vA*0.35*f, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo: g, mat: m };
  }, [count]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/* --------------------------------------------------------------------------------------- scene */
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();

export default function Scene({
  tokens, att, head, q, hover, mask, dist, step, progress, onHover, onUnhover, onPick, onBar, onMiss,
  gpuTier, reduced, stackRef,
}) {
  const { size, camera, scene } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const mobile = size.width < 700;
  const showBars = step === 3 && !!dist;
  const K = mobile ? 5 : 8;
  const layout = useMemo(() => computeLayout(tokens, aspect, showBars ? K : 0), [tokens, aspect, showBars, K]);
  const gap = useMemo(() => {
    const ys = layout.slots.filter(Boolean).map((s) => s.y);
    return (ys.length ? Math.max(...ys) - Math.min(...ys) : 0) + SLAB_H + 0.5;
  }, [layout]);
  const n = tokens.length;

  // per-slab targets from the selected query's attention row
  const heads = head === 'all' ? HEADS : HEADS.filter((h) => h.id === head);
  const slabState = useMemo(() => {
    return tokens.map((_, j) => {
      if (q == null || !att) return { attn: 0, color: '#A8F0FF' };
      let best = 0, color = heads[0].color;
      for (const h of heads) {
        const w = att[h.id].weights[q]?.[j] ?? 0;
        if (w > best) { best = w; color = h.color; }
      }
      return { attn: j === q ? 0 : Math.min(1, best * 1.3), color };
    });
  }, [tokens, q, att, head]); // eslint-disable-line react-hooks/exhaustive-deps

  // beams from the query
  const beams = useMemo(() => makeBeams(HEADS.length * 64, { width: 0.06, intensity: 1 }), []);
  const grow = useRef(1);
  useEffect(() => () => { beams.geometry.dispose(); beams.material.dispose(); }, [beams]);
  useEffect(() => {
    if (q == null || !att || !layout.slots[q]) { beams.write([]); return; }
    const list = [];
    heads.forEach((h, hi) => {
      const row = att[h.id].weights[q];
      const A = topOf(layout.slots[q]);
      row.forEach((w, j) => {
        if (j === q || w < 0.01 || !layout.slots[j]) return;
        const s = layout.slots[j];
        const B = topOf(s);
        const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
        list.push({
          a: A, b: B, c: headColor[h.id], w,
          h: (0.5 + 0.26 * Math.min(d, 10)) * (1 + hi * 0.3) + Math.max(0, A[1] - B[1]) * 0.4,
          z: 0.25 + 0.05 * d + hi * 0.35,
          phase: (j * 0.137 + hi * 0.31) % 1,
        });
      });
    });
    beams.write(list);
    grow.current = live.snap || reduced ? 1 : 0;
  }, [q, att, head, layout, beams]); // eslint-disable-line react-hooks/exhaustive-deps

  const floorMat = useMemo(() => makeFloorMaterial(), []);
  useEffect(() => () => floorMat.dispose(), [floorMat]);

  // camera rig
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const fogD = useRef(0.028);
  useFrame((state, dt) => {
    if (!reduced) timeU.value += Math.min(dt, 0.05);
    grow.current += (1 - grow.current) * (live.snap ? 1 : Math.min(1, dt * 3.2));
    beams.material.uniforms.uGrow.value = grow.current;

    const p = progress.current;
    const tower = clamp01(p * 5 - 4.05) / 0.95;
    const te = tower < 0.5 ? 4 * tower * tower * tower : 1 - Math.pow(-2 * tower + 2, 3) / 2;
    stackRef.current = Math.min(LAYERS, tower * 1.25 * LAYERS);

    const tanV = Math.tan(THREE.MathUtils.degToRad(17));
    // fit the (curved) row: its ends sit closer to the camera, so add their depth to the distance
    const halfW = layout.width / 2 + (mobile ? 0.35 : 0.9);
    const zEnd = ARC * halfW * halfW;
    // mobile: fit the rows into the free band between the stacked explainer and the control dock
    const bandTop = step === 3 ? 0.38 : 0.42, bandBot = step === 3 ? 0.72 : 0.68;
    const Hh = mobile ? (layout.height + 0.5) / (bandBot - bandTop) : layout.height + 2.4;
    let dist = Math.max(halfW / (tanV * aspect) + zEnd, Hh / 2 / tanV);
    dist = Math.max(dist, 6);
    // where the row's centre should sit on screen (fraction below the middle): desktop keeps the row in the
    // band between the explainer and the control dock.
    const below = mobile ? (bandTop + bandBot) / 2 - 0.5 : step === 3 ? 0.03 : 0.17;
    let px = 0, py = 0.9 + dist * 0.05, pz = dist;
    if (step === 1) { py = 1.2 + dist * 0.08; }
    if (step === 2) { px = dist * 0.4; py = 1.6 + dist * 0.12; pz = dist * 0.94; }
    if (step >= 3) { py = 1.2 + dist * 0.07; }
    let lx = 0, ly = below * 2 * dist * tanV, lz = 0.4;
    // the tower flight: sink to the base and tilt up the stack as it grows into the fog
    if (te > 0) {
      px = THREE.MathUtils.lerp(px, dist * 0.2, te);
      py = THREE.MathUtils.lerp(py, layout.floorY + (mobile ? 1.6 : 2.2), te);
      pz = THREE.MathUtils.lerp(pz, dist * (mobile ? 0.95 : 1.3), te);
      lx = THREE.MathUtils.lerp(lx, 0, te);
      ly = THREE.MathUtils.lerp(ly, layout.floorY + dist * (mobile ? 0.13 : 0.26), te);
      lz = THREE.MathUtils.lerp(lz, -dist * 0.25, te);
    }
    if (!reduced) {
      px += live.pointer.x * 0.5;
      py += live.pointer.y * 0.25;
    }
    const k = reduced ? 1 : damp(Math.min(1, dt * 2.4));
    vA.set(px, py, pz);
    camera.position.lerp(vA, k);
    vB.set(lx, ly, lz);
    look.current.lerp(vB, k);
    camera.lookAt(look.current);

    const fd = THREE.MathUtils.lerp(0.032 * (12 / Math.max(10, dist)), 0.021, te);
    fogD.current += (fd - fogD.current) * k;
    fogU.uFogDensity.value = fogD.current;
    if (scene.fog) scene.fog.density = fogD.current;
    floorMat.uniforms.uGlow.value = q != null ? 1 : 0.3;
  });

  return (
    <>
      <color attach="background" args={['#050506']} />
      <fogExp2 attach="fog" args={['#050506', 0.028]} />
      <ambientLight intensity={0.6} />
      <group>
        {tokens.map((t, i) =>
          layout.slots[i] ? (
            <Slab
              key={`${i}:${t.raw}`}
              tok={t}
              slot={layout.slots[i]}
              i={i}
              attn={slabState[i].attn}
              color={slabState[i].color}
              sel={q === i ? 1 : 0}
              hover={hover === i ? 1 : 0}
              dim={mask && q != null && i > q ? 1 : 0}
              interactive
              onOver={onHover}
              onOut={onUnhover}
              onPick={onPick}
              reduced={reduced}
            />
          ) : null
        )}
        <mesh geometry={beams.geometry} material={beams.material} frustumCulled={false} renderOrder={2} />
        {showBars && layout.bars && <Bars slot={layout.bars} dist={dist} onPick={onBar} k={K} interactive reduced={reduced} maxH={mobile ? 2.1 : 3.1} />}
        {att && n > 0 && step >= 4 && <Tower layout={layout} tokens={tokens} att={att} stackRef={stackRef} gy={gap * 0.85} gz={gap * 0.95} />}
      </group>

      {/* floor: blurred reflections + instrument grid */}
      <group position={[0, layout.floorY - 0.004, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onMiss}>
          <planeGeometry args={[160, 160]} />
          {gpuTier >= 2 ? (
            <MeshReflectorMaterial
              blur={[400, 120]}
              resolution={512}
              mixBlur={1}
              mixStrength={2.2}
              mixContrast={1.1}
              roughness={1}
              depthScale={0.9}
              minDepthThreshold={0.35}
              maxDepthThreshold={1.2}
              color="#06070a"
              metalness={0.55}
              mirror={0.6}
            />
          ) : (
            <meshBasicMaterial color="#060709" />
          )}
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} material={floorMat} renderOrder={1}>
          <planeGeometry args={[160, 160]} />
        </mesh>
      </group>
      {!reduced && <Dust count={gpuTier >= 2 ? 420 : 200} />}

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={gpuTier >= 2 ? 1.25 : 0.9} luminanceThreshold={0.82} luminanceSmoothing={0.18} radius={0.78} />
        <Noise opacity={0.045} premultiply />
        <Vignette offset={0.22} darkness={0.78} eskil={false} />
      </EffectComposer>
    </>
  );
}
