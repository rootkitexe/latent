'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore, live } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import GalaxyScene from './Galaxy';
import { loadGalaxy, neighbours, analogy, lookup, suggest, cosine, vec, lensLayout } from './data';
import { STEPS, PRESETS, SEARCH_EXAMPLES, SENTENCES } from './copy';
import Fallback from './Fallback';
import { Vector3 } from 'three';

const NSTEP = STEPS.length;

export default function EmbeddingsChapter() {
  return (
    <Chapter id="embeddings" length={6.5} label="L4 Embeddings — meaning as geometry">
      <Stage />
    </Chapter>
  );
}

function makeS() {
  return {
    reveal: 0, revealNow: 0, dim: 0, glow: 0, amp: 1, sentenceLit: [], origin: 0, version: 0,
    states: new Map(), mode: 'none', focus: -1, nbrs: [], ana: null,
    hover: -1, drag: { yaw: 0, pitch: 0, vy: 0, vp: 0 }, rect: { left: 0, top: 0 },
    pointerIn: false, touch: false, reduced: false, mobile: false,
    virtual: [0, 1, 2, 3, 4].map(() => new Vector3()), virtualOn: 0, shiftX: 0, shiftY: 0,
    labelEls: [], clusterEls: [], forcedLabels: [], ambientLabels: 10, clusterLabels: 0, labelsDirty: true,
    step: 0, local: 0, viewObj: { target: [0, 0, 0], dist: 70, pitch: 0.3, spin: 0.03 },
    setHover: () => {}, hoverVal: () => '', pulse: () => 0, anaClock: () => 99, view: null,
  };
}

function Stage() {
  const { progress, visible } = useChapter();
  const gpuTier = useStore((s) => s.gpuTier);
  const reduced = useStore((s) => s.reducedMotion);
  const touch = useStore((s) => s.touch);
  const [G, setG] = useState(null);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState('search');
  const [query, setQuery] = useState('');
  const [focusWord, setFocusWord] = useState('king');
  const [nbrs, setNbrs] = useState([]);
  const [ana, setAna] = useState(null);
  const [triple, setTriple] = useState(['king', 'man', 'woman']);
  const [msg, setMsg] = useState('');
  const S = useRef(makeS()).current;
  const wrap = useRef(null);
  const labelRefs = useRef([]);
  const clusterRefs = useRef([]);
  const r = { focus: useRef(), nearest: useRef(), hover: useRef(), cos: useRef(), step: useRef() };
  const barcode = useRef(null);
  const anaSeq = useRef(0);

  S.touch = touch;
  S.reduced = reduced;

  useEffect(() => { loadGalaxy().then(setG).catch((e) => console.warn('embeddings: data failed', e)); }, []);

  /* ------------------------------------------------------------ actions */
  const refreshForced = useCallback(() => {
    if (!G) return;
    const f = [];
    if (S.mode === 'search' && S.focus >= 0) {
      f.push({ i: S.focus, val: '', kind: 'focus' });
      for (const n of S.nbrs) f.push({ i: n.i, val: n.cos.toFixed(2), kind: 'nbr' });
    } else if (S.mode === 'analogy' && S.ana) {
      const a = S.ana; const N = G.N; const w = G.words;
      f.push({ i: N + 4, word: w[a.ranks[0].i], val: a.ranks[0].cos.toFixed(2), kind: 'answer' });
      f.push({ i: N, word: w[a.a], val: '', kind: 'op' }, { i: N + 1, word: w[a.b], val: '−', kind: 'op' }, { i: N + 2, word: w[a.c], val: '+', kind: 'op' });
      f.push({ i: N + 3, word: 'a − b + c', val: '', kind: 'calc' });
    } else if (S.mode === 'origin') {
      f.push({ i: S.origin, val: '', kind: 'focus' });
    }
    S.forcedLabels = f;
    S.labelsDirty = true;
  }, [G, S]);

  const setStates = useCallback((pairs) => {
    S.states = new Map(pairs);
    S.version++;
  }, [S]);

  const selectWord = useCallback((word, { quiet = false } = {}) => {
    if (!G) return false;
    const i = lookup(G, word);
    if (i < 0) {
      const sug = suggest(G, String(word).slice(0, 3), 3);
      setMsg(`“${word}” isn’t one of the ${G.N.toLocaleString()} stars here${sug.length ? ` — try ${sug.join(', ')}` : ''}.`);
      return false;
    }
    setMsg('');
    const nb = neighbours(G, i, 10);
    S.mode = 'search'; S.focus = i; S.nbrs = nb; S.ana = null; S.virtualOn = 0;
    setStates([[i, 2], ...nb.map((n) => [n.i, 1])]);
    refreshForced();
    setFocusWord(G.words[i]); setNbrs(nb); setAna(null); setTab('search');
    if (!quiet) { playBlip(0.7, 0.6); nb.slice(0, 5).forEach((n, k) => setTimeout(() => playBlip(0.3 + n.cos * 0.6, 0.3), 90 + k * 70)); }
    return true;
  }, [G, S, refreshForced, setStates]);

  const runAnalogy = useCallback((a, b, c, { quiet = false } = {}) => {
    if (!G) return false;
    const ids = [a, b, c].map((w) => lookup(G, w));
    const miss = [a, b, c].filter((_, k) => ids[k] < 0);
    if (miss.length) { setMsg(`Not in this galaxy: ${miss.join(', ')}.`); return false; }
    setMsg('');
    const { ranks } = analogy(G, ids[0], ids[1], ids[2], 6);
    const lens = lensLayout(G, ids[0], ids[1], ids[2], ranks[0].i, S.mobile ? 4.3 : 6.2);
    const anchor = [0, 0, 0];
    for (const i of [ids[0], ids[1], ids[2], ranks[0].i]) for (let k = 0; k < 3; k++) anchor[k] += G.pos[i * 3 + k] / 4;
    const res = { id: ++anaSeq.current, a: ids[0], b: ids[1], c: ids[2], ranks, lens, anchor, t0: performance.now() };
    S.virtualOn = 0;
    S.mode = 'analogy'; S.ana = res; S.focus = -1; S.nbrs = [];
    setStates([[ids[0], 3], [ids[1], 3], [ids[2], 3], [ranks[0].i, 4], ...ranks.slice(1, 4).map((x) => [x.i, 1])]);
    refreshForced();
    setAna(res); setNbrs([]); setTab('analogy'); setTriple([G.words[ids[0]], G.words[ids[1]], G.words[ids[2]]]);
    if (!quiet) { playBlip(0.4, 0.4); setTimeout(() => playBlip(0.5, 0.4), 950); setTimeout(() => playBlip(0.6, 0.4), 1600); setTimeout(() => playChord(), 2700); }
    return true;
  }, [G, S, refreshForced, setStates]);

  const clearSel = useCallback((mode = 'none') => {
    S.mode = mode; S.focus = -1; S.nbrs = []; S.ana = null; S.virtualOn = 0;
    setStates(mode === 'origin' ? [[S.origin, 2]] : []);
    refreshForced();
    setNbrs([]); setAna(null);
  }, [S, refreshForced, setStates]);

  /* ------------------------------------------------------- S callbacks */
  useEffect(() => {
    if (!G) return;
    S.origin = lookup(G, 'king');
    S.setHover = (i) => {
      S.hover = i;
      if (r.hover.current) r.hover.current.textContent = i >= 0 ? G.words[i] : '—';
      if (r.cos.current) {
        const ref = S.focus >= 0 ? S.focus : S.ana ? S.ana.ranks[0].i : -1;
        r.cos.current.textContent = i >= 0 && ref >= 0 && ref !== i ? `${cosine(G, ref, i).toFixed(3)}` : '—';
      }
      S.labelsDirty = true;
    };
    S.hoverVal = () => {
      const ref = S.focus >= 0 ? S.focus : -1;
      return S.hover >= 0 && ref >= 0 && S.hover !== ref ? cosine(G, ref, S.hover).toFixed(2) : '';
    };
    S.pulse = () => 0.5 + 0.5 * Math.sin(performance.now() / 260);
    S.anaClock = () => (S.ana ? (performance.now() - S.ana.t0) / 1000 : 99);
    S.view = () => {
      const v = S.viewObj;
      const P = G.pos;
      if (S.step === 0) {
        const o = S.origin;
        v.target[0] = P[o * 3]; v.target[1] = P[o * 3 + 1]; v.target[2] = P[o * 3 + 2];
        v.dist = 9 + S.local * 6; v.pitch = 0.12; v.spin = 0.06; v.shiftX = 0;
      } else if (S.mode === 'search' && S.focus >= 0) {
        const f = S.focus;
        v.target[0] = P[f * 3]; v.target[1] = P[f * 3 + 1]; v.target[2] = P[f * 3 + 2];
        let ext = 0;
        for (const n of S.nbrs) ext = Math.max(ext, Math.hypot(P[n.i * 3] - P[f * 3], P[n.i * 3 + 1] - P[f * 3 + 1], P[n.i * 3 + 2] - P[f * 3 + 2]));
        v.dist = Math.min(34, Math.max(11, ext * 2.4)); v.pitch = 0.18; v.spin = 0.05; v.shiftX = S.mobile ? 0 : 0.05;
      } else if (S.mode === 'analogy' && S.ana) {
        const a = S.ana.anchor;
        v.target[0] = a[0]; v.target[1] = a[1]; v.target[2] = a[2];
        v.dist = S.mobile ? 30 : 25; v.pitch = 0.16; v.spin = 0.03; v.shiftX = S.mobile ? 0 : 0.045;
      } else {
        v.target[0] = 0; v.target[1] = 0; v.target[2] = 0;
        v.dist = S.step >= 4 ? 78 - S.local * 8 : S.step === 1 ? 96 - Math.min(1, S.local * 1.6) * 30 : 72;
        v.pitch = S.step >= 4 ? 0.42 : 0.28; v.spin = S.step >= 4 ? 0.12 : 0.035; v.shiftX = S.mobile ? 0 : 0.11;
      }
      return v;
    };
    S.labelEls = labelRefs.current.filter(Boolean);
    S.clusterEls = clusterRefs.current;
    S.ambientLabels = touch ? 4 : 9;
    clearSel('origin');
  }, [G]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------- scroll → steps, rAF */
  useEffect(() => {
    let raf;
    let last = -1;
    const loop = () => {
      const p = progress.current;
      const s = Math.min(NSTEP - 1, Math.floor(p * NSTEP));
      S.step = s;
      S.local = p * NSTEP - s;
      if (s !== last) { last = s; setStep(s); }
      S.reveal = Math.min(1, Math.max(0, (p - 0.165) / 0.09));
      S.dim = S.mode === 'search' || S.mode === 'analogy' ? 1 : 0;
      S.ambientLabels = S.touch ? (S.mode === 'none' ? 3 : 0) : S.mode === 'analogy' ? 2 : S.mode === 'search' ? 4 : 6;
      S.glow = s >= 4 ? Math.min(1, S.local * 2.5) : 0;
      S.clusterLabels = (S.mode === 'none' || S.mode === 'sentence') && s >= 1 ? Math.min(1, S.revealNow * 1.2) * (s >= 4 ? 0.9 : 0.8) : 0;
      if (wrap.current) { const b = wrap.current.getBoundingClientRect(); S.rect.left = b.left; S.rect.top = b.top; S.mobile = b.width < 768; S.shiftY = S.mobile ? 0.1 : 0; }
      // the bar-code collapses into a single star as you scroll out of step 1
      const bc = barcode.current;
      if (bc) {
        const c = Math.min(1, Math.max(0, (p - 0.08) / 0.09));
        const e = c * c * (3 - 2 * c);
        bc.style.transform = `scale(${(1 - e * 0.985).toFixed(4)}, ${(1 - e * 0.9).toFixed(4)})`;
        bc.style.filter = e > 0.01 ? `blur(${(e * 3).toFixed(2)}px)` : 'none';
        bc.parentElement.style.opacity = String(Math.max(0, 1 - Math.max(0, c - 0.6) * 2.5));
        bc.parentElement.parentElement.style.visibility = p < 0.2 ? 'visible' : 'hidden';
        // the single star flares as the numbers collapse into it
        S.amp = s === 0 ? 0.3 + 0.7 * e : 1;
      }
      raf = requestAnimationFrame(loop);
    };
    if (visible) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [visible, progress, S]);

  // each step's default scene (the visitor's own toy state wins inside a step)
  useEffect(() => {
    if (!G) return;
    if (step === 0) { clearSel('origin'); setFocusWord('king'); }
    else if (step === 1 || step === 4) clearSel('none');
    else if (step === 2) selectWord('coffee', { quiet: true });
    else if (step === 3) runAnalogy(...PRESETS[0], { quiet: true });
  }, [step, G]); // eslint-disable-line react-hooks/exhaustive-deps

  // finale: sentences light up as paths through meaning-space, word by word
  useEffect(() => {
    if (!G || step !== 4 || reduced) return;
    const sentences = SENTENCES.map((t) => t.map((w) => lookup(G, w)).filter((i) => i >= 0));
    let si = 0, k = 0;
    const tick = () => {
      if (S.mode !== 'none' && S.mode !== 'sentence') return;
      const sen = sentences[si % sentences.length];
      k++;
      if (k > sen.length + 2) { k = 0; si++; S.sentenceLit = []; S.mode = 'none'; setStates([]); refreshForced(); return; }
      S.mode = 'sentence';
      S.sentenceLit = sen.slice(0, Math.min(k, sen.length));
      setStates(S.sentenceLit.map((i) => [i, 2]));
      S.forcedLabels = S.sentenceLit.map((i, n) => ({ i, val: '', kind: n === S.sentenceLit.length - 1 ? 'focus' : 'op' }));
      S.labelsDirty = true;
      if (k <= sen.length) playBlip(0.35 + (k / sen.length) * 0.5, 0.35);
    };
    const id = setInterval(tick, 700);
    return () => { clearInterval(id); if (S.mode === 'sentence') { S.mode = 'none'; S.sentenceLit = []; setStates([]); refreshForced(); } };
  }, [step, G, reduced, S, setStates, refreshForced]);

  /* -------------------------------------------------------- pointer */
  const ptr = useRef({ down: false, x: 0, y: 0, moved: 0 });
  const onDown = (e) => {
    ptr.current = { down: true, x: e.clientX, y: e.clientY, moved: 0 };
    S.pointerIn = true;
  };
  const onMove = (e) => {
    S.pointerIn = true;
    const p = ptr.current;
    if (!p.down) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY; p.moved += Math.abs(dx) + Math.abs(dy);
    S.drag.yaw -= dx * 0.0055; S.drag.pitch += dy * 0.004;
    S.drag.vy = -dx * 0.0022; S.drag.vp = dy * 0.0016;
  };
  const onUp = () => {
    const p = ptr.current;
    if (p.down && p.moved < 6 && S.hover >= 0 && S.step >= 1) {
      const w = G.words[S.hover];
      if (tab === 'analogy' && S.mode === 'analogy') {
        // clicking a star while doing arithmetic: try it as the "+" word
        runAnalogy(triple[0], triple[1], w);
      } else selectWord(w);
    }
    p.down = false;
    if (touch) S.pointerIn = false;
  };

  /* ---------------------------------------------------- readouts */
  useEffect(() => {
    if (!G) return;
    if (r.focus.current) r.focus.current.textContent = ana ? `${G.words[ana.a]} − ${G.words[ana.b]} + ${G.words[ana.c]}` : focusWord;
    if (r.nearest.current) {
      r.nearest.current.textContent = ana ? `${G.words[ana.ranks[0].i]} · ${ana.ranks[0].cos.toFixed(3)}` : nbrs.length ? `${G.words[nbrs[0].i]} · ${nbrs[0].cos.toFixed(3)}` : '—';
    }
  }, [G, ana, nbrs, focusWord]);

  const barWord = focusWord && G && lookup(G, focusWord) >= 0 ? focusWord : 'king';
  const bars = useMemo(() => (G ? Array.from(vec(G, lookup(G, barWord))) : []), [G, barWord]);

  const info = STEPS[step];
  const fallback = <Fallback />;
  const nLabels = touch ? 18 : 30;

  return (
    <div className="absolute inset-0">
      {/* WebGL galaxy */}
      <div
        ref={wrap}
        className="absolute inset-0"
        data-cursor="Drag"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (ptr.current.down = false)}
        onPointerLeave={() => { S.pointerIn = false; ptr.current.down = false; }}
      >
        {G && (
          <ChapterCanvas fallback={fallback} camera={{ position: [0, 10, 95], fov: 42, near: 0.1, far: 600 }}>
            <GalaxyScene G={G} S={S} ana={ana} tier={gpuTier} />
          </ChapterCanvas>
        )}
      </div>

      {/* projected labels (DOM, positioned from the render loop) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
        {Array.from({ length: nLabels }, (_, k) => (
          <div key={k} ref={(el) => (labelRefs.current[k] = el)} className="emb-label" style={{ opacity: 0 }}>
            <span />
            <span />
          </div>
        ))}
        {G && G.clusters.map((c, k) => (
          <div key={c.key} ref={(el) => (clusterRefs.current[k] = el)} className="emb-cluster" style={{ opacity: 0 }}>
            {c.label}
          </div>
        ))}
      </div>

      {/* step 1: the vector as a bar-code */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[6] flex -translate-y-1/2 justify-center" style={{ visibility: 'hidden' }}>
        <div className="flex w-[min(760px,88vw)] flex-col items-center">
          <div className="hud mb-3 text-fg-68">“{barWord}” = 300 numbers</div>
          <div ref={barcode} className="relative h-[150px] w-full origin-center md:h-[180px]">
            <div className="absolute inset-x-0 top-1/2 h-px bg-[rgba(255,255,255,0.12)]" />
            <div className="absolute inset-0 flex items-center gap-[1px]">
              {bars.map((v, k) => {
                const m = Math.min(1, Math.abs(v) / 0.22);
                return (
                  <div key={k} className="relative h-full flex-1">
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        height: `${(m * 50).toFixed(1)}%`,
                        top: v >= 0 ? `${(50 - m * 50).toFixed(1)}%` : '50%',
                        background: v >= 0 ? `rgba(255,79,31,${0.35 + m * 0.65})` : `rgba(92,124,250,${0.35 + m * 0.65})`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="hud mt-3 flex w-full justify-between text-fg-42">
            <span>dim 0</span>
            <span className="hidden sm:inline">[{bars.slice(0, 4).map((v) => v.toFixed(3)).join(', ')}, … ]</span>
            <span>dim 299</span>
          </div>
        </div>
      </div>

      {/* overlay */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="gx absolute left-0 top-[76px] max-w-[min(560px,92vw)] md:top-[88px]">
          <div className="hud mb-3">L04 / Embeddings</div>
          <h2 className="display text-[clamp(38px,5.4vw,88px)]">Embeddings</h2>
          <p className="serif mt-2 text-[clamp(22px,2.3vw,34px)] text-ice">meaning has a shape</p>
          <div className="mt-5 md:mt-8" key={step} style={{ animation: 'embIn .9s var(--ease) both' }}>
            <div className="hud mb-2" ref={r.step}><span className="text-signal">0{step + 1}</span> / 0{NSTEP} — {info.title}</div>
            <p className="body text-[14.5px] md:text-[17px]">{info.body}</p>
          </div>
        </div>

        {/* result panel (right) */}
        <ResultPanel G={G} nbrs={nbrs} ana={ana} focusWord={focusWord} onPick={(w) => selectWord(w)} step={step} />

        {/* readouts */}
        <div className="gx absolute bottom-[84px] right-0 hidden text-right md:block">
          <dl className="hud grid grid-cols-[auto_auto] gap-x-5 gap-y-1">
            <dt>Dimensions</dt><dd className="text-fg">300</dd>
            <dt>Stars</dt><dd className="text-fg">{G ? G.N.toLocaleString() : '—'}</dd>
            <dt>Query</dt><dd className="text-fg" ref={r.focus}>king</dd>
            <dt>Nearest</dt><dd className="text-signal" ref={r.nearest}>—</dd>
            <dt>Hover</dt><dd className="text-fg" ref={r.hover}>—</dd>
            <dt>cos(query, hover)</dt><dd className="text-ice" ref={r.cos}>—</dd>
          </dl>
          <div className="hud mt-3 text-fg-22">GloVe 6B · 300-D · map: t-SNE 3-D</div>
        </div>

        {/* dock */}
        <Dock
          G={G}
          tab={tab}
          setTab={(t) => {
            setTab(t);
            if (t === 'analogy' && !S.ana) runAnalogy(...triple);
            if (t === 'search' && S.mode !== 'search') selectWord(focusWord && lookup(G, focusWord) >= 0 ? focusWord : 'coffee');
          }}
          query={query}
          setQuery={setQuery}
          onSearch={(w) => selectWord(w)}
          triple={triple}
          setTriple={setTriple}
          onRun={(a, b, c) => runAnalogy(a, b, c)}
          msg={msg}
          step={step}
        />
      </div>

      <style>{CSS}</style>
    </div>
  );
}

/* ================================================================ dock */
function Dock({ G, tab, setTab, query, setQuery, onSearch, triple, setTriple, onRun, msg, step }) {
  const [open, setOpen] = useState(false);
  const sug = G && open ? suggest(G, query, 6).filter((w) => w !== query.trim().toLowerCase()) : [];
  const submit = (e) => { e.preventDefault(); if (query.trim()) { onSearch(query.trim()); setOpen(false); } };
  const live = step >= 1;
  return (
    <div className={`emb-dock gx pointer-events-auto absolute bottom-[78px] left-0 w-full max-w-[640px] transition-opacity duration-700 ${live ? 'opacity-100' : 'opacity-0 md:opacity-40'}`}>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className="pill" data-active={tab === 'search'} onClick={() => setTab('search')} aria-pressed={tab === 'search'}>Neighbours</button>
        <button type="button" className="pill" data-active={tab === 'analogy'} onClick={() => setTab('analogy')} aria-pressed={tab === 'analogy'}>Arithmetic</button>
        <span className="hud ml-2 hidden lg:inline">{tab === 'search' ? 'type a word · click any star' : 'a − b + c = ?'}</span>
      </div>

      {tab === 'search' ? (
        <form onSubmit={submit} className="panel relative flex items-center gap-2 p-1.5 pl-4" data-cursor="Type">
          <label htmlFor="emb-q" className="hud shrink-0 text-ice">Fly to</label>
          <input
            id="emb-q"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="type a word…"
            autoComplete="off"
            spellCheck={false}
            className="emb-input min-w-0 flex-1"
          />
          <button type="submit" className="pill shrink-0" data-active="true">Go</button>
          {sug.length > 0 && (
            <ul className="panel absolute bottom-full left-0 mb-2 w-full overflow-hidden py-1" role="listbox">
              {sug.map((w) => (
                <li key={w}>
                  <button type="button" className="emb-sug" onMouseDown={(e) => { e.preventDefault(); setQuery(w); onSearch(w); setOpen(false); }}>{w}</button>
                </li>
              ))}
            </ul>
          )}
        </form>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); onRun(...triple); }}
          className="panel flex flex-wrap items-center gap-1.5 p-1.5 pl-3"
          data-cursor="Type"
        >
          {[0, 1, 2].map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              {k > 0 && <span className="emb-op" aria-hidden>{k === 1 ? '−' : '+'}</span>}
              <input
                aria-label={k === 0 ? 'start word' : k === 1 ? 'word to subtract' : 'word to add'}
                value={triple[k]}
                onChange={(e) => { const t = [...triple]; t[k] = e.target.value; setTriple(t); }}
                className="emb-input emb-slot"
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          ))}
          <span className="emb-op hidden sm:inline" aria-hidden>=</span>
          <button type="submit" className="pill ml-auto" data-active="true"><span className="hidden sm:inline">Compute</span><span className="sm:hidden" aria-hidden>=</span><span className="sr-only sm:hidden">Compute</span></button>
        </form>
      )}

      <div className="emb-chips mt-2.5 flex min-h-[30px] items-center gap-1.5 overflow-x-auto md:flex-wrap md:overflow-visible">
        {msg ? (
          <span className="hud text-signal-hot normal-case tracking-normal" role="status">{msg}</span>
        ) : tab === 'search' ? (
          <>
            <span className="hud mr-1">try</span>
            {SEARCH_EXAMPLES.map((w) => (
              <button key={w} type="button" className="emb-chip" onClick={() => { setQuery(w); onSearch(w); }}>{w}</button>
            ))}
          </>
        ) : (
          <>
            <span className="hud mr-1">presets</span>
            {PRESETS.map((p) => (
              <button key={p.join()} type="button" className="emb-chip" onClick={() => onRun(...p)}>
                {p[0]} − {p[1]} + {p[2]}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ======================================================= result panel */
function ResultPanel({ G, nbrs, ana, focusWord, onPick, step }) {
  if (!G || step === 0) return null;
  if (ana) {
    const top = ana.ranks[0];
    return (
      <div key={ana.id} className="emb-result gx pointer-events-auto absolute right-0 top-[96px] hidden md:block w-[min(440px,100%)] text-right" style={{ animation: 'embIn .9s var(--ease) both' }}>
        <div className="hud mb-2">computed in 300 dimensions</div>
        <div className="emb-eq">
          <span>{G.words[ana.a]}</span> <i>−</i> <span>{G.words[ana.b]}</span> <i>+</i> <span>{G.words[ana.c]}</span>
        </div>
        <div className="emb-answer" style={{ animation: 'embIn 1s 2.8s var(--ease) both' }}>
          <span className="hud text-fg-42">≈ </span>{G.words[top.i]}
          <span className="hud ml-3 text-signal-hot">cos {top.cos.toFixed(3)}</span>
        </div>
        <ol className="mt-4 hidden space-y-1 md:block" style={{ animation: 'embIn 1s 3.1s var(--ease) both' }}>
          {ana.ranks.slice(1, 5).map((x, k) => (
            <li key={x.i} className="hud flex items-center justify-end gap-3">
              <span className="text-fg-68 normal-case tracking-normal">{G.words[x.i]}</span>
              <Bar v={x.cos} />
              <span className="w-10 text-fg">{x.cos.toFixed(2)}</span>
            </li>
          ))}
        </ol>
        <p className="hud mt-4 hidden normal-case leading-relaxed tracking-normal text-fg-22 md:block">
          Arrows are drawn in the 3-D map; the answer is the real nearest word to a − b + c in 300-D.
        </p>
      </div>
    );
  }
  if (!nbrs.length) return null;
  return (
    <div key={focusWord} className="emb-result gx pointer-events-auto absolute right-0 top-[96px] hidden md:block w-[min(360px,100%)] text-right" style={{ animation: 'embIn .9s var(--ease) both' }}>
      <div className="hud mb-1">nearest to</div>
      <div className="emb-answer">{focusWord}</div>
      <ol className="emb-nbrs mt-3 space-y-0.5">
        {nbrs.slice(0, 8).map((x, k) => (
          <li key={x.i}>
            <button type="button" className="hud flex w-full items-center justify-end gap-3 py-0.5 hover:text-fg" onClick={() => onPick(G.words[x.i])}>
              <span className="text-fg-68 normal-case tracking-normal">{G.words[x.i]}</span>
              <Bar v={x.cos} />
              <span className="w-10 text-fg">{x.cos.toFixed(2)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="hud mt-2 hidden text-fg-22 md:block">cosine similarity · 1 = same direction</div>
    </div>
  );
}

function Bar({ v }) {
  return (
    <span className="relative inline-block h-[3px] w-[90px] bg-[rgba(255,255,255,0.08)]">
      <span className="absolute inset-y-0 right-0 bg-ice" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, opacity: 0.4 + v * 0.6 }} />
    </span>
  );
}

const CSS = `
@keyframes embIn { from { opacity: 0; transform: translateY(14px); filter: blur(6px) } to { opacity: 1; transform: none; filter: none } }
.emb-label { position: absolute; left: 0; top: 0; white-space: nowrap; will-change: transform, opacity;
  font: 500 11px/1 var(--font-mono); letter-spacing: .06em; color: rgba(255,255,255,.62);
  transition: opacity .35s var(--ease); padding-left: 9px; margin-top: -5px; }
.emb-label span:last-child { margin-left: 7px; color: var(--ice); font-variant-numeric: tabular-nums; }
.emb-label span:last-child:empty { display: none; }
.emb-label[data-kind='focus'], .emb-label[data-kind='answer'] { color: #fff; font-size: 15px; margin-top: -8px; padding-left: 14px;
  text-shadow: 0 0 14px rgba(255,79,31,.8); }
.emb-label[data-kind='answer'] span:last-child { color: var(--signal-hot); }
.emb-label[data-kind='nbr'] { color: rgba(255,255,255,.92); font-size: 12px; }
.emb-label[data-kind='op'] { color: #fff; font-size: 13.5px; padding-left: 12px; }
.emb-label[data-kind='op'] span:last-child { color: var(--ice); }
.emb-label[data-kind='calc'] { color: var(--ice); font-size: 10.5px; letter-spacing: .14em; padding-left: 16px; margin-top: -14px; }
.emb-label[data-kind='hover'] { color: #fff; font-size: 12.5px; }
.emb-label[data-kind='near'] { color: rgba(255,255,255,.78); }
.emb-label[data-kind='ambient'] { font-size: 10px; color: rgba(255,255,255,.4); }
.emb-cluster { position: absolute; left: 0; top: 0; white-space: nowrap; transform-origin: 0 0; will-change: transform;
  font: 500 10px/1 var(--font-mono); letter-spacing: .22em; text-transform: uppercase; color: rgba(168,240,255,.75);
  translate: -50% -100%; padding-bottom: 8px; transition: opacity .6s var(--ease); }
.emb-cluster::after { content: ''; position: absolute; left: 50%; bottom: 0; width: 1px; height: 6px; background: rgba(168,240,255,.5); }
.emb-input { background: transparent; border: 0; outline: none; color: #fff; font: 500 16px/1 var(--font-mono); letter-spacing: .04em; height: 38px; }
.emb-input::placeholder { color: rgba(255,255,255,.3); }
.emb-slot { width: 92px; height: 34px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--hairline); background: rgba(255,255,255,.03); font-size: 14px; text-align: center; }
.emb-slot:focus { border-color: rgba(168,240,255,.6); }
.emb-op { font: 500 16px/1 var(--font-mono); color: var(--ice); padding: 0 2px; }
.emb-chip { height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--hairline); background: rgba(255,255,255,.03);
  font: 500 11px/1 var(--font-mono); letter-spacing: .04em; color: rgba(255,255,255,.72); transition: all .4s var(--ease); }
.emb-chip:hover { border-color: rgba(168,240,255,.55); color: #fff; }
.emb-sug { display: block; width: 100%; text-align: left; padding: 7px 16px; font: 500 13px/1.2 var(--font-mono); color: rgba(255,255,255,.75); }
.emb-sug:hover { background: rgba(168,240,255,.08); color: #fff; }
.emb-eq { font-family: var(--font-display); font-variation-settings: 'wdth' 110; font-weight: 600; font-size: clamp(20px, 2vw, 30px); letter-spacing: -.02em; line-height: 1.1; }
.emb-eq i { font-style: normal; color: var(--ice); padding: 0 .1em; }
.emb-answer { font-family: var(--font-display); font-variation-settings: 'wdth' 125; font-weight: 800; font-size: clamp(34px, 4vw, 64px); letter-spacing: -.03em; line-height: 1; color: #fff; text-shadow: 0 0 30px rgba(255,79,31,.45); }
.emb-chips > * { flex-shrink: 0; }
.emb-chips { scrollbar-width: none; }
.emb-chips::-webkit-scrollbar { display: none; }
@media (max-width: 768px) {
  .emb-slot { width: 74px; font-size: 13px; padding: 0 6px; }
  .emb-dock { bottom: 76px; }
  .emb-result { top: auto; bottom: 236px; width: 100%; text-align: left; }
  .emb-result .emb-answer { font-size: 30px; }
  .emb-result .emb-eq { font-size: 17px; }
  .emb-nbrs { display: flex; flex-wrap: wrap; gap: 2px 12px; }
  .emb-nbrs li:nth-child(n+5) { display: none; }
  .emb-nbrs button { justify-content: flex-start; gap: 6px; }
  .emb-nbrs button > span:nth-child(2) { display: none; }
  .emb-nbrs button > span:last-child { width: auto; }
  .emb-result > .hud:first-child { display: none; }
}
`;
