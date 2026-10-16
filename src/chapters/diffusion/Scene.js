'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { live, damp } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import { alphaBar, snrDb, T, rng } from './schedule';
import { buildTarget } from './targets';
import { pointsVert, pointsFrag, vecVert, vecFrag } from './shaders';
import { stepOf, lightOf, scrollT, STEP_CAM } from './story';

const VOID = new THREE.Color('#050506');
const PAPER = new THREE.Color('#ECE9E2');
const INK = new THREE.Color('#0B0B0D');
const SIGNAL = new THREE.Color('#FF4F1F');

const K_STEPS = 50; // sampler steps (DDIM-style, uniform in t)
/** Data scaling (preprocessing): image coords are scaled so noise std ≈ ½ the image half-width. */
const DATA = 1.8;
const AB_LUT = new Float32Array(T + 1).map((_, i) => alphaBar(i));

export default function Scene({ sim, ui, progress, tier, reduced }) {
  const N = tier >= 2 ? 120000 : 64000;
  const NV = tier >= 2 ? 1800 : 1000;
  const { camera, size, gl } = useThree();
  const rig = useRef();
  const pts = useRef();
  const bg = useMemo(() => new THREE.Color().copy(VOID), []);
  const ringMat = useMemo(() => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false }), []);
  const labelRef = useRef();

  // ── buffers ────────────────────────────────────────────────────────────────
  const data = useMemo(() => {
    const R = rng(4242);
    const x0 = new Float32Array(N * 3);
    const e1 = new Float32Array(N * 3);
    const e2 = new Float32Array(N * 3);
    const r = new Float32Array(N * 4);
    const b = new Float32Array(N * 2);
    for (let i = 0; i < N * 3; i++) { e1[i] = R.normal(); e2[i] = R.normal(); }
    for (let i = 0; i < N; i++) {
      r[i * 4] = R(); r[i * 4 + 1] = 0; r[i * 4 + 2] = R(); r[i * 4 + 3] = R();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(x0, 3));
    geo.setAttribute('aE1', new THREE.BufferAttribute(e1, 3));
    geo.setAttribute('aE2', new THREE.BufferAttribute(e2, 3));
    geo.setAttribute('aR', new THREE.BufferAttribute(r, 4));
    const bAttr = new THREE.BufferAttribute(b, 2);
    bAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aB', bAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

    // −ε̂ vectors for a subset of particles (2 vertices per line)
    const idx = new Uint32Array(NV);
    for (let i = 0; i < NV; i++) idx[i] = Math.floor(R() * N);
    const vgeo = new THREE.BufferGeometry();
    const vx = new Float32Array(NV * 6), ve1 = new Float32Array(NV * 6), ve2 = new Float32Array(NV * 6);
    const vr = new Float32Array(NV * 8), vb = new Float32Array(NV * 4), vend = new Float32Array(NV * 2);
    for (let k = 0; k < NV; k++) {
      const i = idx[k];
      for (let s = 0; s < 2; s++) {
        const v = k * 2 + s;
        for (let c = 0; c < 3; c++) { ve1[v * 3 + c] = e1[i * 3 + c]; ve2[v * 3 + c] = e2[i * 3 + c]; }
        for (let c = 0; c < 4; c++) vr[v * 4 + c] = r[i * 4 + c];
        vend[v] = s;
      }
    }
    vgeo.setAttribute('position', new THREE.BufferAttribute(vx, 3));
    vgeo.setAttribute('aE1', new THREE.BufferAttribute(ve1, 3));
    vgeo.setAttribute('aE2', new THREE.BufferAttribute(ve2, 3));
    vgeo.setAttribute('aR', new THREE.BufferAttribute(vr, 4));
    const vbAttr = new THREE.BufferAttribute(vb, 2);
    vbAttr.setUsage(THREE.DynamicDrawUsage);
    vgeo.setAttribute('aB', vbAttr);
    vgeo.setAttribute('aEnd', new THREE.BufferAttribute(vend, 1));
    vgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    return { x0, e1, e2, r, b, geo, idx, vgeo, vx, vr, vb };
  }, [N, NV]);

  const uniforms = useMemo(() => ({
    uT: { value: T }, uPhi: { value: 0 }, uTime: { value: 0 }, uLight: { value: 0 },
    uSize: { value: tier >= 2 ? 2.1 : 2.5 }, uPR: { value: 1 }, uAct: { value: 0 }, uHi: { value: 1 },
    uInk: { value: INK.clone() }, uPaper: { value: PAPER.clone() }, uSignal: { value: SIGNAL.clone() }, uHdr: { value: 4.2 },
  }), [tier]);
  const vUniforms = useMemo(() => ({
    uT: uniforms.uT, uPhi: uniforms.uPhi, uTime: uniforms.uTime, uLight: uniforms.uLight,
    uLen: { value: 0.4 }, uShow: { value: 0 }, uInk: uniforms.uInk, uSignal: uniforms.uSignal,
  }), [uniforms]);

  // ── targets ────────────────────────────────────────────────────────────────
  const applyTarget = (tg) => {
    const { x0, r, geo, idx, vx, vr } = data;
    for (let i = 0; i < N * 3; i++) x0[i] = tg.pos[i] * DATA;
    for (let i = 0; i < N; i++) r[i * 4 + 1] = tg.hi[i];
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aR.needsUpdate = true;
    for (let k = 0; k < NV; k++) {
      const i = idx[k];
      for (let s = 0; s < 2; s++) {
        const v = k * 2 + s;
        vx[v * 3] = x0[i * 3]; vx[v * 3 + 1] = x0[i * 3 + 1]; vx[v * 3 + 2] = x0[i * 3 + 2];
        vr[v * 4 + 1] = r[i * 4 + 1];
      }
    }
    data.vgeo.attributes.position.needsUpdate = true;
    data.vgeo.attributes.aR.needsUpdate = true;
  };

  // Runtime state lives in a ref (never React state).
  const st = useRef({
    t: T, phi: 0, act: 0, light: 0, show: 0, camZ: 9, rotY: 0, ox: 0,
    gen: { phase: 'idle', k: 0, timer: 0, target: null, building: false },
    handledReq: 0, dirty: false, lastStep: -1, readT: -1, readK: -1, light10: -1, steps: 0,
    mat: new THREE.Matrix4(),
  });

  useEffect(() => {
    let alive = true;
    buildTarget(sim.prompt, N, sim.seed).then((tg) => { if (alive) applyTarget(tg); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N]);

  useEffect(() => () => { data.geo.dispose(); data.vgeo.dispose(); ringMat.dispose(); }, [data, ringMat]);

  const rings = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 2, Math.sin(a) * 2, 0)); }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);

  // ── generation (re-noise → swap prompt at x_T → K denoising steps) ────────
  const startGeneration = (prompt) => {
    const s = st.current;
    sim.prompt = prompt;
    sim.seed = (sim.seed * 1664525 + 1013904223) >>> 0;
    s.gen.phase = 'up';
    s.gen.target = null;
    s.gen.building = false;
    s.gen.k = 0;
    sim.hold = null;
    ui.setBusy?.(true);
  };

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    const s = st.current;
    const p = progress.current;
    const step = stepOf(p);
    const g = s.gen;
    const time = state.clock.elapsedTime;

    // requests from the DOM (chips / Generate / auto-prompt on entering step 4)
    if (sim.req !== s.handledReq) { s.handledReq = sim.req; startGeneration(sim.reqPrompt); }
    if (step === 3 && !sim.autoDone && g.phase === 'idle') {
      sim.autoDone = true;
      ui.setPrompt?.('cat');
      startGeneration('cat');
    }
    if (step !== s.lastStep) {
      s.lastStep = step;
      ui.setMode?.(step === 1 || step >= 3 ? 'noise' : 'denoise');
    }

    // ── timestep ──
    let target;
    if (g.phase === 'up') {
      s.t = Math.min(T, s.t + dt * (500 + s.t * 2.2));
      target = s.t;
      s.act = Math.max(s.act, 0.4);
      if (s.t >= T) { g.phase = 'hold'; g.timer = 0; }
    } else if (g.phase === 'hold') {
      s.t = T; target = T; g.timer += dt;
      if (!g.building) {
        g.building = true;
        // pure noise now: wipe any brush strokes and swap the prompt invisibly (√ᾱ_T = 0)
        data.b.fill(0); data.vb.fill(0); s.dirty = false;
        data.geo.attributes.aB.needsUpdate = true; data.vgeo.attributes.aB.needsUpdate = true;
        buildTarget(sim.prompt, N, sim.seed).then((tg) => { g.target = tg; });
      }
      if (g.target && g.timer > 0.35) { applyTarget(g.target); g.target = null; g.phase = 'down'; g.k = 0; g.timer = 0; }
    } else if (g.phase === 'down') {
      g.timer += dt;
      const per = reduced ? 0.03 : 0.062;
      while (g.timer > per && g.k < K_STEPS) {
        g.timer -= per; g.k++;
        // stochastic sampler: rotate in a little fresh noise each step (more while noisy)
        const ab = alphaBar(T * (1 - g.k / K_STEPS));
        s.phi += 0.09 * Math.sqrt(1 - ab);
        if (g.k % 4 === 0) playBlip(g.k / K_STEPS, 0.22);
      }
      target = T * (1 - g.k / K_STEPS);
      s.t += (target - s.t) * Math.min(1, dt * 22);
      s.act = 1;
      if (g.k >= K_STEPS && Math.abs(s.t - target) < 0.5) {
        s.t = 0; g.phase = 'idle'; sim.hold = { t: 0, p }; playChord(); ui.setBusy?.(false);
      }
    } else {
      if (sim.hold && Math.abs(p - sim.hold.p) > 0.02) sim.hold = null;
      target = sim.hold ? sim.hold.t : scrollT(p);
      const k = sim.hold?.slider ? 1 : damp(1 - Math.exp(-dt * 5));
      s.t += (target - s.t) * k;
      if (Math.abs(s.t - target) < 0.05) s.t = target;
    }
    s.act *= Math.exp(-dt * (g.phase === 'down' ? 0 : 2.5));
    // slow "boiling" of the noise sample (fresh ε) — honest, the marginal stays N(0, I)
    if (!reduced) s.phi += dt * 0.07;

    // ── brush ──
    const br = sim.brush;
    const { x0, e1, e2, r, b } = data;
    if (br.down && br.inside && g.phase === 'idle') {
      const M = s.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(pts.current.matrixWorld);
      const e = M.elements;
      const W = size.width, H = size.height;
      const R2 = br.r * br.r;
      const den = sim.mode === 'denoise';
      const rate = 3000 * dt;
      const tg = s.t;
      for (let i = 0; i < N; i++) {
        let x = x0[i * 3], y = x0[i * 3 + 1], z = x0[i * 3 + 2];
        if (!den) {
          const tl = Math.min(T, Math.max(0, tg + b[i * 2]));
          const ab = AB_LUT[tl | 0];
          const phi = s.phi * (0.55 + 0.9 * r[i * 4 + 2]);
          const c = Math.cos(phi), sn = Math.sin(phi);
          const sa = Math.sqrt(ab), sb = Math.sqrt(1 - ab);
          x = sa * x + sb * (c * e1[i * 3] + sn * e2[i * 3]);
          y = sa * y + sb * (c * e1[i * 3 + 1] + sn * e2[i * 3 + 1]);
          z = sa * z + sb * (c * e1[i * 3 + 2] + sn * e2[i * 3 + 2]);
        }
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        const px = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W - br.x;
        const py = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5) * H - br.y;
        const d2 = px * px + py * py;
        if (d2 < R2) {
          let f = 1 - d2 / R2; f *= f;
          let d = b[i * 2] + (den ? -rate : rate) * f;
          d = Math.max(-tg, Math.min(T - tg, d));
          b[i * 2] = d;
          if (f > b[i * 2 + 1]) b[i * 2 + 1] = f;
        }
      }
      s.dirty = true;
      s.act = Math.max(s.act, 0.35);
      if (Math.random() < dt * 10) playBlip(den ? 0.8 : 0.25, 0.12);
    } else if (s.dirty) {
      const kd = Math.exp(-dt / 7);
      const kh = Math.exp(-dt * 2.2);
      let any = false;
      for (let i = 0; i < N; i++) {
        const d = b[i * 2] * kd;
        const h = b[i * 2 + 1] * kh;
        b[i * 2] = Math.abs(d) < 0.5 ? 0 : d;
        b[i * 2 + 1] = h < 0.004 ? 0 : h;
        if (d !== 0 || h !== 0) any = any || Math.abs(d) >= 0.5 || h >= 0.004;
      }
      if (!any) s.dirty = false;
      data.geo.attributes.aB.needsUpdate = true;
    }
    if (s.dirty || (br.down && br.inside)) {
      data.geo.attributes.aB.needsUpdate = true;
      const { idx, vb } = data;
      for (let k = 0; k < NV; k++) {
        const i = idx[k];
        vb[k * 4] = vb[k * 4 + 2] = b[i * 2];
        vb[k * 4 + 1] = vb[k * 4 + 3] = b[i * 2 + 1];
      }
      data.vgeo.attributes.aB.needsUpdate = true;
    }

    // ── light (void → paper over the first ~8%) ──
    const light = lightOf(p);
    s.light = light;
    bg.lerpColors(VOID, PAPER, light);
    state.scene.background = bg;
    uniforms.uLight.value = light;
    ringMat.color.lerpColors(PAPER, INK, light);

    // ── uniforms ──
    uniforms.uT.value = s.t;
    uniforms.uPhi.value = s.phi;
    uniforms.uTime.value = time;
    uniforms.uAct.value = s.act;
    uniforms.uPR.value = gl.getPixelRatio();
    const wantShow = step === 2 ? 1 : g.phase === 'down' ? 0.55 : 0;
    s.show += (wantShow - s.show) * damp(1 - Math.exp(-dt * 4));
    vUniforms.uShow.value = s.show;
    const abNow = alphaBar(s.t);
    ringMat.opacity = 0.22 * (1 - abNow) * (0.25 + 0.75 * light);
    if (labelRef.current) labelRef.current.fillOpacity = 0.55 * (1 - abNow) * light;

    // ── camera + rig ──
    const aspect = size.width / size.height;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const cam = STEP_CAM[step];
    const fitZ = (aspect < 1 ? 4.6 : 5.6) / (2 * tanH * aspect);
    const zTarget = Math.max(cam.z, fitZ);
    const kc = reduced ? 1 : damp(1 - Math.exp(-dt * 1.8));
    s.camZ += (zTarget - s.camZ) * kc;
    camera.position.set(0, cam.y, s.camZ);
    camera.lookAt(0, 0, 0);
    const visW = 2 * s.camZ * tanH * aspect;
    const visH = 2 * s.camZ * tanH;
    const oxT = aspect > 1.15 ? visW * 0.13 : 0;
    const oyT = aspect > 1.15 ? visH * 0.025 : -visH * 0.04;
    s.ox += (oxT - s.ox) * kc;
    if (rig.current) {
      rig.current.position.set(s.ox, oyT, 0);
      const sway = reduced ? 0 : Math.sin(time * 0.17) * 0.42;
      const rotT = cam.rot + sway + (reduced ? 0 : live.pointer.x * 0.18);
      s.rotY += (rotT - s.rotY) * damp(1 - Math.exp(-dt * 2));
      rig.current.rotation.y = s.rotY;
      rig.current.rotation.x = reduced ? 0 : -live.pointer.y * 0.06 + 0.04;
    }

    // ── readouts (DOM via refs, only when changed) ──
    const ti = Math.round(s.t);
    if (ti !== s.readT || g.k !== s.readK) {
      s.readT = ti; s.readK = g.k;
      const ab = alphaBar(ti);
      const snr = snrDb(ab);
      if (ui.t.current) ui.t.current.textContent = String(ti).padStart(4, '0');
      if (ui.ab.current) ui.ab.current.textContent = ab.toFixed(4);
      if (ui.snr.current) ui.snr.current.textContent = snr === Infinity ? '+∞ dB' : snr === -Infinity ? '−∞ dB' : `${snr >= 0 ? '+' : '−'}${Math.abs(snr).toFixed(1)} dB`;
      if (ui.steps.current) ui.steps.current.textContent = g.phase === 'idle' ? (g.k ? `${K_STEPS}/${K_STEPS}` : `—/${K_STEPS}`) : `${String(g.k).padStart(2, '0')}/${K_STEPS}`;
      if (ui.dot.current) { ui.dot.current.setAttribute('cx', (ti / T) * 100); ui.dot.current.setAttribute('cy', 4 + (1 - ab) * 40); }
      if (ui.slider.current && document.activeElement !== ui.slider.current) ui.slider.current.value = ti;
      if (ui.phase.current) {
        ui.phase.current.textContent = g.phase === 'up' ? 'forward · q(xₜ|x₀)' : g.phase === 'hold' ? 'x_T ~ N(0, I)' : g.phase === 'down' ? 'reverse · p_θ(xₜ₋₁|xₜ)'
          : ti >= T ? 'x_T ~ N(0, I)' : ti === 0 ? 'x₀ · clean' : 'xₜ = √ᾱ·x₀ + √(1−ᾱ)·ε';
      }
    }
  });

  return (
    <>
      <group ref={rig}>
       <group scale={1 / DATA}>
        <points ref={pts} geometry={data.geo} frustumCulled={false}>
          <shaderMaterial
            vertexShader={pointsVert}
            fragmentShader={pointsFrag}
            uniforms={uniforms}
            transparent
            depthWrite={false}
          />
        </points>
        <lineSegments geometry={data.vgeo} frustumCulled={false}>
          <shaderMaterial vertexShader={vecVert} fragmentShader={vecFrag} uniforms={vUniforms} transparent depthWrite={false} />
        </lineSegments>
        <lineLoop geometry={rings} material={ringMat} />
        <lineLoop geometry={rings} material={ringMat} rotation={[Math.PI / 2, 0, 0]} />
        <lineLoop geometry={rings} material={ringMat} rotation={[0, Math.PI / 2, 0]} />
       </group>
        <Text
          ref={labelRef}
          font="/fonts/JetBrainsMono-Medium.ttf"
          fontSize={0.05}
          letterSpacing={0.12}
          color="#0B0B0D"
          position={[0.8, 0.84, 0]}
          anchorX="left"
          fillOpacity={0}
        >
          {'N(0, I) · 2σ'}
        </Text>
      </group>
      {tier >= 2 ? (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={0.9} radius={0.62} />
          <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.18} />
          <Vignette offset={0.32} darkness={0.32} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.18} />
          <Vignette offset={0.32} darkness={0.32} />
        </EffectComposer>
      )}
    </>
  );
}
