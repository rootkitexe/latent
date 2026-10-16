'use client'

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { live, damp, useStore } from '@/lib/store';
import { useChapter } from '@/lib/chapter';
import { LAYERS, OFFSETS, N_NEURONS } from './model';
import { neuronVert, neuronFrag, lineVert, lineFrag, planeVert, planeFrag, dustVert, dustFrag } from './shaders';

const MONO = '/fonts/JetBrainsMono-Medium.ttf';
export const LAYER_Z = [0, -12, -21, -29];
const SP_IN = 0.34;
const SP_H = 1.15;
const SP_OUT = 1.25;

export function neuronPos(i, out = [0, 0, 0]) {
  if (i < 784) {
    const r = Math.floor(i / 28), c = i % 28;
    out[0] = (c - 13.5) * SP_IN; out[1] = (13.5 - r) * SP_IN; out[2] = LAYER_Z[0];
  } else if (i < 848) {
    const j = i - 784, r = Math.floor(j / 8), c = j % 8;
    out[0] = (c - 3.5) * SP_H; out[1] = (3.5 - r) * SP_H; out[2] = LAYER_Z[1];
  } else if (i < 880) {
    const j = i - 848, r = Math.floor(j / 8), c = j % 8;
    out[0] = (c - 3.5) * SP_H; out[1] = (1.5 - r) * SP_H; out[2] = LAYER_Z[2];
  } else {
    const j = i - 880;
    out[0] = (j - 4.5) * SP_OUT; out[1] = 0; out[2] = LAYER_Z[3];
  }
  return out;
}

// Camera path through the stack: [progress, position, lookAt]
const KEYS = [
  [0.0, [5.5, 3.2, 21], [0, 0, -9]],
  [0.12, [3.2, 1.6, 14.5], [0, 0, -10]],
  [0.22, [1.6, 0.9, 6.5], [0, 0, -14]],
  [0.36, [0.9, 0.5, -4.2], [0, 0, -20]],
  [0.48, [9.5, 3.6, 0.5], [-0.5, 0.6, -11]],
  [0.58, [9.0, 3.3, -0.5], [-0.5, 0.6, -11]],
  [0.7, [13, 4.2, -41], [0.5, 0.3, -16]],
  [0.78, [12, 3.8, -42], [0.5, 0.3, -16]],
  [0.92, [28, 11.5, 18], [-5.5, -0.5, -12]],
  [1.0, [30, 12.5, 20], [-5.5, -0.5, -12]],
];
const ss = (t) => t * t * (3 - 2 * t);
function sampleKeys(t, pos, look) {
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = ss(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  pos.set(a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k);
  look.set(a[2][0] + (b[2][0] - a[2][0]) * k, a[2][1] + (b[2][1] - a[2][1]) * k, a[2][2] + (b[2][2] - a[2][2]) * k);
}

/** Robust per-layer scale (98th percentile of |w|) so colours read across all three matrices. */
function weightScale(w) {
  const n = Math.min(w.length, 6000);
  const step = w.length / n;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.abs(w[Math.floor(i * step)]);
  a.sort();
  return a[Math.floor(n * 0.98)] || 1;
}

function useNetworkGeometry(model, tier) {
  return useMemo(() => {
    // neurons
    const npos = new Float32Array(N_NEURONS * 3);
    const nidx = new Float32Array(N_NEURONS);
    const p = [0, 0, 0];
    for (let i = 0; i < N_NEURONS; i++) {
      neuronPos(i, p);
      npos.set(p, i * 3);
      nidx[i] = i;
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(npos, 3));
    ng.setAttribute('aIdx', new THREE.BufferAttribute(nidx, 1));
    ng.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -14), 40);

    // connections — every weight of the three matrices is one hair-thin line
    const scales = model.W0.map(weightScale);
    const keep = [];
    for (let l = 0; l < 3; l++) {
      const nin = LAYERS[l], nout = LAYERS[l + 1], w = model.W0[l];
      // lighter GPUs: first matrix keeps only its strongest 35% of weights
      const thr = l === 0 && tier < 2 ? scales[0] * 0.38 : -1;
      for (let j = 0; j < nout; j++) for (let i = 0; i < nin; i++) {
        if (Math.abs(w[j * nin + i]) > thr) keep.push(l, j * nin + i, i, j);
      }
    }
    const n = keep.length / 4;
    const lpos = new Float32Array(n * 6);
    const info = new Float32Array(n * 8);
    const q = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const l = keep[k * 4], wi = keep[k * 4 + 1], i = keep[k * 4 + 2], j = keep[k * 4 + 3];
      const src = OFFSETS[l] + i, dst = OFFSETS[l + 1] + j;
      neuronPos(src, p); neuronPos(dst, q);
      lpos.set(p, k * 6); lpos.set(q, k * 6 + 3);
      const wn = Math.max(-1, Math.min(1, model.W[l][wi] / scales[l]));
      info.set([wn, src, dst, 0, wn, src, dst, 1], k * 8);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
    const infoAttr = new THREE.BufferAttribute(info, 4);
    infoAttr.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('aInfo', infoAttr);
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -14), 40);

    // refresh line weights after a teaching step (real SGD changes them)
    const refresh = () => {
      for (let k = 0; k < n; k++) {
        const l = keep[k * 4], wi = keep[k * 4 + 1];
        const wn = Math.max(-1, Math.min(1, model.W[l][wi] / scales[l]));
        info[k * 8] = wn; info[k * 8 + 4] = wn;
      }
      infoAttr.needsUpdate = true;
    };
    return { ng, lg, lineCount: n, refresh };
  }, [model, tier]);
}

function LayerPlane({ z, w, h, label, sub, opacity = 1 }) {
  const uniforms = useMemo(() => ({ uSize: { value: new THREE.Vector2(w, h) }, uGlow: { value: 0 }, uOpacity: { value: opacity } }), [w, h, opacity]);
  return (
    <group position={[0, 0, z]}>
      <mesh renderOrder={-1}>
        <planeGeometry args={[w, h]} />
        <shaderMaterial
          vertexShader={planeVert}
          fragmentShader={planeFrag}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Billboard position={[-w / 2, h / 2 + 0.16, 0]}>
        <Text font={MONO} fontSize={0.2} letterSpacing={0.16} anchorX="left" anchorY="bottom" color="#A8F0FF" fillOpacity={0.6}>
          {label}
        </Text>
        <Text font={MONO} fontSize={0.15} letterSpacing={0.16} anchorX="left" anchorY="top" position={[0, -0.04, 0]} color="#ffffff" fillOpacity={0.32}>
          {sub}
        </Text>
      </Billboard>
    </group>
  );
}

export default function Scene({ ctl }) {
  const { progress } = useChapter();
  const tier = useStore((s) => s.gpuTier);
  const reduced = useStore((s) => s.reducedMotion);
  const { camera, size } = useThree();
  const model = ctl.model;
  const { ng, lg, refresh } = useNetworkGeometry(model, tier);

  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Float32Array(32 * 32 * 4), 32, 32, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, []);
  const shared = useMemo(
    () => ({
      uAct: { value: tex },
      uFwd: { value: 3.6 },
      uBwd: { value: -1 },
      uBwdAmt: { value: 0 },
      uFeature: { value: 0 },
      uSel: { value: -10 },
      uTime: { value: 0 },
    }),
    [tex]
  );
  const nUniforms = useMemo(() => ({ ...shared, uScale: { value: 400 } }), [shared]);
  const lUniforms = useMemo(() => ({ ...shared, uIdle: { value: 0.05 }, uGain: { value: new THREE.Vector3(0.05, 0.42, 0.8) } }), [shared]);

  // feature card texture (28×28 heatmap of what the selected neuron looks for)
  const card = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(28 * 28 * 4), 28, 28, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, []);

  const dust = useMemo(() => {
    const n = tier >= 2 ? 900 : 450;
    const p = new Float32Array(n * 3);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 50;
      p[i * 3 + 1] = (Math.random() - 0.5) * 30;
      p[i * 3 + 2] = 18 - Math.random() * 70;
      s[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    return g;
  }, [tier]);
  const dUniforms = useMemo(() => ({ uTime: shared.uTime, uScale: { value: 400 } }), [shared]);

  const bars = useRef([]);
  const barMats = useRef([]);
  const labels = useRef([]);
  const cardGroup = useRef();
  const cardMat = useRef();
  const cardLabel = useRef();
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const lookCur = useRef(new THREE.Vector3(0, 0, -9));
  const seen = useRef({ v: -1, w: -1, f: -1 });
  const tmp = useMemo(() => [0, 0, 0], []);
  const cardPos = useMemo(() => new THREE.Vector3(), []);
  const leader = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.66, 0.94, 1.0), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }, []);

  useEffect(() => () => { ng.dispose(); lg.dispose(); }, [ng, lg]);
  useEffect(() => () => { tex.dispose(); card.dispose(); dust.dispose(); }, [tex, card, dust]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const p = progress.current;
    const step = Math.min(4, Math.floor(p * 5));
    ctl.step = step;
    shared.uTime.value = t;
    const scale = size.height * 0.9 * Math.min(1.5, state.gl.getPixelRatio());
    nUniforms.uScale.value = scale;
    dUniforms.uScale.value = scale;

    // --- upload neuron data when the network changed
    const s = ctl.state;
    if (seen.current.v !== ctl.version) {
      seen.current.v = ctl.version;
      const d = tex.image.data;
      let m1 = 1e-6, m2 = 1e-6, g1 = 1e-6, g2 = 1e-6, g3 = 1e-6;
      for (let i = 0; i < 64; i++) { m1 = Math.max(m1, s.a1[i]); g1 = Math.max(g1, Math.abs(s.d1[i])); }
      for (let i = 0; i < 32; i++) { m2 = Math.max(m2, s.a2[i]); g2 = Math.max(g2, Math.abs(s.d2[i])); }
      for (let i = 0; i < 10; i++) g3 = Math.max(g3, Math.abs(s.d3[i]));
      for (let i = 0; i < 784; i++) { d[i * 4] = s.x[i]; d[i * 4 + 1] = 0; }
      for (let i = 0; i < 64; i++) { d[(784 + i) * 4] = s.a1[i] / m1; d[(784 + i) * 4 + 1] = Math.abs(s.d1[i]) / g1; }
      for (let i = 0; i < 32; i++) { d[(848 + i) * 4] = s.a2[i] / m2; d[(848 + i) * 4 + 1] = Math.abs(s.d2[i]) / g2; }
      for (let i = 0; i < 10; i++) { d[(880 + i) * 4] = Math.sqrt(s.p[i]); d[(880 + i) * 4 + 1] = Math.abs(s.d3[i]) / g3; }
      tex.needsUpdate = true;
    }
    if (seen.current.w !== ctl.weightsVersion) {
      seen.current.w = ctl.weightsVersion;
      if (ctl.weightsVersion > 0) refresh();
    }
    if (seen.current.f !== ctl.featureVersion) {
      seen.current.f = ctl.featureVersion;
      const d = tex.image.data;
      const fm = ctl.feature;
      for (let i = 0; i < 784; i++) d[i * 4 + 2] = fm[i];
      tex.needsUpdate = true;
      const c = card.image.data;
      for (let i = 0; i < 784; i++) {
        const v = fm[i];
        const a = Math.min(1, Math.abs(v) * 1.15);
        const r0 = 18, g0 = 19, b0 = 24; // #121318 zero
        const [r1, g1, b1] = v > 0 ? [255, 79, 31] : [92, 124, 250];
        c[i * 4] = r0 + (r1 - r0) * a; c[i * 4 + 1] = g0 + (g1 - g0) * a; c[i * 4 + 2] = b0 + (b1 - b0) * a; c[i * 4 + 3] = 255;
      }
      card.needsUpdate = true;
      if (cardLabel.current) cardLabel.current.text = `${ctl.sel.layer === 1 ? 'H1' : 'H2'}·${String(ctl.sel.idx).padStart(2, '0')} LOOKS FOR`;
    }

    // --- waves
    if (ctl.fwdKick) { ctl.fwdKick = false; ctl.fwdStart = t; }
    if (ctl.bwdKick) { ctl.bwdKick = false; ctl.bwdStart = t; }
    const fwdDur = 1.9;
    if (ctl.fwdStart >= 0) {
      const e = (t - ctl.fwdStart) / fwdDur;
      shared.uFwd.value = reduced ? 3.6 : -0.15 + e * 3.75;
      if (e > 1) {
        // the forward step loops while the visitor sits on it
        if (step === 1 && !reduced && t - ctl.fwdStart > 4.2) ctl.fwdStart = t;
        else if (e > 1.2) ctl.fwdStart = -1;
      }
    } else {
      shared.uFwd.value = 3.6;
      if (step === 1 && !reduced && !ctl.drawing) ctl.fwdStart = t;
    }
    const bwdOn = step === 3 || ctl.bwdStart >= 0;
    if (ctl.bwdStart >= 0) {
      const e = (t - ctl.bwdStart) / 2.0;
      shared.uBwd.value = reduced ? -0.6 : 3.3 - e * 3.9;
      if (e > 1.6) ctl.bwdStart = step === 3 && !reduced ? t : -1;
    } else if (step === 3) {
      ctl.bwdStart = t;
    }
    const bk = 1 - Math.exp(-dt * 4);
    shared.uBwdAmt.value += ((bwdOn ? 1 : 0) - shared.uBwdAmt.value) * damp(bk);
    shared.uFeature.value += ((step === 2 ? 1 : 0) - shared.uFeature.value) * damp(bk);
    shared.uSel.value = OFFSETS[ctl.sel.layer] + ctl.sel.idx;

    // --- camera flight
    const tt = reduced ? (step + 0.5) / 5 : p;
    sampleKeys(tt, pos, look);
    const narrow = size.width / size.height < 0.9;
    if (narrow) {
      // portrait: pull back along the view direction so the planes fit
      pos.sub(look).multiplyScalar(1.3).add(look);
    }
    pos.x += live.pointer.x * 0.7;
    pos.y += live.pointer.y * 0.45;
    const ck = damp(1 - Math.exp(-dt * 3.2));
    camera.position.lerp(pos, ck);
    lookCur.current.lerp(look, ck);
    camera.lookAt(lookCur.current);
    // desktop, later steps: slide the picture left so the output end clears the draw panel
    const late = narrow ? 0 : Math.min(1, Math.max(0, (tt - 0.6) / 0.15));
    const xOff = Math.round(size.width * 0.07 * late * late * (3 - 2 * late));
    const vo = narrow + ':' + size.width + 'x' + size.height + ':' + xOff;
    if (camera.fov !== (narrow ? 62 : 48) || camera.userData.vo !== vo) {
      camera.fov = narrow ? 62 : 48;
      camera.userData.vo = vo;
      // portrait: lift the network into the gap between the title and the draw panel
      if (narrow) camera.setViewOffset(size.width, size.height, 0, size.height * 0.13, size.width, size.height);
      else if (xOff) camera.setViewOffset(size.width, size.height, xOff, 0, size.width, size.height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }

    // --- output bars + winner flare
    for (let k = 0; k < 10; k++) {
      const b = bars.current[k];
      if (!b) continue;
      const lit = Math.min(1, Math.max(0, (shared.uFwd.value - 2.9) * 4));
      const target = 0.04 + s.p[k] * 2.3 * lit;
      const h = b.scale.y + (target - b.scale.y) * damp(1 - Math.exp(-dt * 8));
      b.scale.y = h;
      b.position.y = 0.55 + h / 2;
      const win = k === s.pred && !s.empty;
      const m = barMats.current[k];
      const flare = win ? (1.0 + Math.sin(t * 4) * 0.15) * lit : 0.25 + s.p[k] * 1.2;
      if (win) m.color.setRGB(1.0 * flare + 0.08, 0.31 * flare + 0.09, 0.12 * flare + 0.12);
      else m.color.setRGB(0.12 * flare + 0.04, 0.2 * flare + 0.05, 0.26 * flare + 0.07);
      const lb = labels.current[k];
      if (lb) {
        lb.color = win ? '#FF4F1F' : '#A8F0FF';
        lb.fillOpacity = win ? 1 : 0.35 + s.p[k] * 0.6;
      }
    }

    // --- feature card follows the selected neuron
    if (cardGroup.current) {
      // on short desktop windows the floating card lands on the explainer; the DOM inspector shows the same map
      const f = size.width >= 768 && size.height <= 820 ? 0 : shared.uFeature.value;
      cardGroup.current.visible = f > 0.02;
      neuronPos(OFFSETS[ctl.sel.layer] + ctl.sel.idx, tmp);
      // float the card in front of the layer, pulled toward the axis, with a leader line to its neuron
      cardPos.set(tmp[0] * 0.4 - 0.6, tmp[1] * 0.4 + 1.4, LAYER_Z[1] + 4.2);
      cardGroup.current.position.lerp(cardPos, damp(1 - Math.exp(-dt * 8)));
      const lp = leader.geometry.attributes.position;
      lp.setXYZ(0, cardGroup.current.position.x, cardGroup.current.position.y - 1.05, cardGroup.current.position.z);
      lp.setXYZ(1, tmp[0], tmp[1], tmp[2]);
      lp.needsUpdate = true;
      leader.visible = f > 0.02;
      leader.material.opacity = f * 0.8;
      cardGroup.current.scale.setScalar(0.85 + f * 0.15);
      if (cardMat.current) cardMat.current.opacity = f;
    }
  });

  const labelsText = ['INPUT · 28×28', 'HIDDEN 1 · ReLU', 'HIDDEN 2 · ReLU', 'OUTPUT · SOFTMAX'];
  return (
    <>
      <color attach="background" args={['#050506']} />

      <LayerPlane z={LAYER_Z[0]} w={28 * SP_IN + 0.8} h={28 * SP_IN + 0.8} label={labelsText[0]} sub="784 NEURONS" />
      <LayerPlane z={LAYER_Z[1]} w={8 * SP_H + 0.8} h={8 * SP_H + 0.8} label={labelsText[1]} sub="64 NEURONS" />
      <LayerPlane z={LAYER_Z[2]} w={8 * SP_H + 0.8} h={4 * SP_H + 0.8} label={labelsText[2]} sub="32 NEURONS" />
      <LayerPlane z={LAYER_Z[3]} w={10 * SP_OUT + 0.6} h={1.6} label={labelsText[3]} sub="10 CLASSES" />

      <lineSegments geometry={lg} frustumCulled={false}>
        <shaderMaterial vertexShader={lineVert} fragmentShader={lineFrag} uniforms={lUniforms} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points geometry={ng} frustumCulled={false}>
        <shaderMaterial vertexShader={neuronVert} fragmentShader={neuronFrag} uniforms={nUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={dust} frustumCulled={false}>
        <shaderMaterial vertexShader={dustVert} fragmentShader={dustFrag} uniforms={dUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>

      {/* output: probability columns + digit labels */}
      <group position={[0, 0, LAYER_Z[3]]}>
        {Array.from({ length: 10 }, (_, k) => (
          <group key={k} position={[(k - 4.5) * SP_OUT, 0, 0]}>
            <mesh ref={(el) => (bars.current[k] = el)} scale={[1, 0.04, 1]} position={[0, 0.6, 0]}>
              <boxGeometry args={[0.09, 1, 0.09]} />
              <meshBasicMaterial ref={(el) => (barMats.current[k] = el)} toneMapped={false} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <Billboard position={[0, -0.75, 0]}>
              <Text ref={(el) => (labels.current[k] = el)} font={MONO} fontSize={0.42} anchorX="center" anchorY="middle" color="#A8F0FF" fillOpacity={0.5}>
                {String(k)}
              </Text>
            </Billboard>
          </group>
        ))}
      </group>

      {/* feature card: the selected hidden neuron's incoming weights, as an image */}
      <group ref={cardGroup} visible={false}>
        <Billboard>
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[2.1, 2.1]} />
            <meshBasicMaterial ref={cardMat} map={card} transparent toneMapped={false} depthWrite={false} />
          </mesh>
          <Text ref={cardLabel} font={MONO} fontSize={0.15} letterSpacing={0.14} anchorX="left" anchorY="bottom" position={[-1.05, 1.16, 0]} color="#A8F0FF">
            H1·00 LOOKS FOR
          </Text>
        </Billboard>
      </group>

      <primitive object={leader} />
      <HiddenPicker ctl={ctl} />

      <EffectComposer multisampling={0} disableNormalPass>
        <Bloom mipmapBlur intensity={tier >= 2 ? 1.1 : 0.85} luminanceThreshold={0.32} luminanceSmoothing={0.25} radius={0.7} />
        <Noise opacity={0.035} premultiply />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

/** Invisible spheres over the 96 hidden neurons so they can be hovered / tapped in the feature step. */
function HiddenPicker({ ctl }) {
  const ref = useRef();
  const geo = useMemo(() => new THREE.SphereGeometry(0.42, 8, 6), []);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const p = [0, 0, 0];
    for (let k = 0; k < 96; k++) {
      neuronPos(784 + k, p);
      m.makeTranslation(p[0], p[1], p[2]);
      ref.current.setMatrixAt(k, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, []);
  const pick = (e) => {
    if (ctl.step !== 2 || e.instanceId == null) return;
    e.stopPropagation();
    const k = e.instanceId;
    ctl.select(k < 64 ? 1 : 2, k < 64 ? k : k - 64, true);
  };
  return (
    <instancedMesh
      ref={ref}
      args={[geo, undefined, 96]}
      onPointerMove={(e) => { if (ctl.step === 2) pick(e); }}
      onClick={pick}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </instancedMesh>
  );
}
