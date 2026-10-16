'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import {
  loadModel, tokenize, attention, HEADS, entropyBits, predict, withTemperature, sample, appendWord,
} from './model';
import Scene from './Scene';
import Heatmap from './Heatmap';
import Fallback from './Fallback';

const DEFAULT = "The animal didn't cross the street because it was too tired";
const MAX_TOK = 26;
const MAX_CHARS = 96;

const STEPS = [
  {
    t: 'Text becomes tokens',
    b: 'A language model never sees letters or words. It sees tokens: common words whole, rarer ones in pieces, each swapped for an ID number. This tokenizer learned its 5,111 pieces from public-domain books — type anything and watch it split.',
    hint: 'Type below — watch it split into tokens',
  },
  {
    t: 'Every word looks at every other word',
    b: 'Self-attention lets each token score how relevant every other token is; a softmax turns the scores into weights that add up to 1. The token then blends in information from the others in proportion to those weights. Change “tired” to “wide” and watch “it” change its mind.',
    hint: 'Hover any word · click to pin it',
  },
  {
    t: 'Many heads, many questions',
    b: 'A transformer runs many attention heads side by side, each asking its own question: who does “it” refer to, what came just before, which word does this one attach to. These four are illustrative heads with hand-written scoring rules — real heads learn theirs from data, and are rarely this tidy.',
    hint: 'Pick a head — or watch all four at once',
  },
  {
    t: 'Predict the next word',
    b: 'To write, a model may only look backwards (future tokens are masked), and turns its last position into a probability for every possible next token. Pick one, append it, repeat — that loop is all generation is. Here a small trigram model trained on fables supplies real odds; temperature sharpens or flattens them.',
    hint: 'Click a bar to append it · or Generate',
  },
  {
    t: 'Stack it 96 times',
    b: 'One attention layer plus a small feed-forward network makes a transformer block. GPT-3 stacks 96 of them, each with 96 heads, holding 175 billion learned weights between them. Every layer refines what the one below built — and out comes a large language model.',
    hint: 'Keep scrolling — the stack keeps growing',
  },
];

function Stage() {
  const { progress } = useChapter();
  const gpuTier = useStore((s) => s.gpuTier);
  const reduced = useStore((s) => s.reducedMotion);
  const touch = useStore((s) => s.touch);

  const [model, setModel] = useState(null);
  const [text, setText] = useState(DEFAULT);
  const [step, setStep] = useState(0);
  const [head, setHead] = useState('coref');
  const [hover, setHover] = useState(null);
  const [pin, setPin] = useState(null);
  const [rowHover, setRowHover] = useState(null);
  const [mask, setMask] = useState(false);
  const [temp, setTemp] = useState(0.8);
  const [auto, setAuto] = useState(false);
  const [mobile, setMobile] = useState(false);
  const stackRef = useRef(0);
  const layersEl = useRef(null);

  useEffect(() => {
    let alive = true;
    loadModel().then((m) => alive && setModel(m)).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const f = () => setMobile(window.innerWidth < 768);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  // scroll -> step (React state only changes when the step changes); per-frame layer readout via ref
  useEffect(() => {
    let raf;
    let last = -1;
    let lastL = -1;
    const loop = () => {
      const s = Math.min(4, Math.floor(progress.current * 5));
      if (s !== last) { last = s; setStep(s); }
      const L = Math.max(1, Math.min(96, Math.round(stackRef.current) + 1));
      if (L !== lastL && layersEl.current) { lastL = L; layersEl.current.textContent = String(L).padStart(2, '0'); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  // each step sets up the scene for its idea; the visitor can still change everything afterwards
  useEffect(() => {
    if (step === 1) setHead('coref');
    if (step === 2) setHead('all');
    if (step === 3) setHead('prev');
    setMask(step >= 3);
    setPin(null);
    if (step < 3) setAuto(false);
  }, [step]);

  const tokens = useMemo(() => (model ? tokenize(model, text).slice(0, MAX_TOK) : []), [model, text]);
  const n = tokens.length;
  const att = useMemo(() => (n ? attention(tokens, { mask }) : null), [tokens, mask, n]);
  const itIndex = useMemo(() => {
    const k = tokens.findIndex((t) => /^(it|he|she|they|him|her|them)$/.test(t.wordText) && t.text.toLowerCase() === t.wordText);
    return k >= 0 ? k : n - 1;
  }, [tokens, n]);
  const q0 = hover ?? rowHover ?? (pin != null && pin < n ? pin : null);
  const q = q0 != null ? q0 : step >= 1 && n ? (step >= 3 ? n - 1 : itIndex) : null;

  const pred = useMemo(() => (model && text.trim() ? predict(model, text) : null), [model, text]);
  const dist = useMemo(() => (pred ? withTemperature(pred.list, temp) : null), [pred, temp]);
  const full = n >= MAX_TOK - 1 || text.length >= MAX_CHARS - 8;

  const append = useCallback((word) => {
    setText((t) => appendWord(t, word).slice(0, MAX_CHARS));
    playBlip(0.7, 0.6);
  }, []);
  const generate = useCallback(() => {
    if (!dist || full) return;
    append(sample(dist).word);
  }, [dist, full, append]);
  useEffect(() => {
    if (!auto) return;
    if (full) { setAuto(false); return; }
    const id = setTimeout(generate, reduced ? 900 : 650);
    return () => clearTimeout(id);
  }, [auto, generate, full, reduced, text]);

  const onHover = useCallback((i) => { setHover(i); playBlip(0.25 + (i % 8) * 0.08, 0.25); }, []);
  const onUnhover = useCallback((i) => setHover((h) => (h === i ? null : h)), []);
  const onPick = useCallback((i) => { setPin((p) => (p === i ? null : i)); playChord(); }, []);
  const onMiss = useCallback(() => setPin(null), []);

  const swap = text.includes(' tired') ? ['tired', 'wide'] : text.includes(' wide') ? ['wide', 'tired'] : null;
  const headInfo = head === 'all' ? null : HEADS.find((h) => h.id === head);

  // readouts
  let top = null, ent = null;
  if (att && q != null && q < n) {
    const hid = head === 'all' ? 'coref' : head;
    const row = att[hid].weights[q];
    let b = -1, bw = -1;
    row.forEach((w, j) => { if (j !== q && w > bw) { bw = w; b = j; } });
    top = b >= 0 ? { t: tokens[b].text, w: bw } : null;
    ent = entropyBits(row);
  }
  const best = dist ? dist[0] : null;

  const headPills = (cls) => (
    <>
      {HEADS.map((h) => (
        <button key={h.id} className={`pill ${cls}`} data-active={head === h.id} onClick={() => setHead(h.id)} aria-pressed={head === h.id}
          style={head === h.id ? { background: h.color, borderColor: h.color, color: h.id === 'coref' ? '#fff' : '#050506' } : undefined}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: head === h.id ? 'currentColor' : h.color }} />
          {h.name}
        </button>
      ))}
      <button className={`pill ${cls}`} data-active={head === 'all'} onClick={() => setHead('all')} aria-pressed={head === 'all'}>All heads</button>
    </>
  );

  return (
    <>
      <div className="absolute inset-0" data-cursor={touch ? undefined : 'Hover a word'}>
        <ChapterCanvas camera={{ position: [0, 1.5, 16], fov: 34, near: 0.1, far: 220 }} fallback={<Fallback />}>
          {n > 0 && (
            <Scene
              tokens={tokens} att={att} head={head} q={q} hover={hover} mask={mask} dist={dist} step={step}
              progress={progress} onHover={onHover} onUnhover={onUnhover} onPick={onPick} onBar={append} onMiss={onMiss}
              gpuTier={gpuTier} reduced={reduced} stackRef={stackRef}
            />
          )}
        </ChapterCanvas>
      </div>

      {/* overlay */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* title block */}
        <div className="gx absolute left-0 right-0 top-0 bg-gradient-to-b from-[#050506] via-[#050506d9] to-transparent pb-10 pt-[64px] md:right-auto md:max-w-[560px] md:bg-none md:pb-0 md:pt-[76px]">
          <div className="hud">L05 / Attention</div>
          <h2 className="display mt-2 !text-[clamp(34px,5.2vw,92px)]">Attention</h2>
          <p className="serif mt-1 text-[clamp(20px,2vw,30px)] text-fg-68">it knows what “it” means.</p>
          <div key={step} className="mt-4 animate-[atnIn_.9s_cubic-bezier(.16,1,.3,1)_both] md:mt-6">
            <div className="hud flex items-center gap-2 text-fg-68">
              <span className="tabular-nums">0{step + 1} / 05</span>
              <span className="h-px w-6 bg-[var(--hairline)]" />
              <span className="text-fg">{STEPS[step].t}</span>
            </div>
            <p className="body mt-2 hidden !max-w-[46ch] md:block">{STEPS[step].b}</p>
            <p className="body mt-2 !text-[13.5px] !leading-[1.45] md:hidden">{STEPS[step].b}</p>
            <div className="hud mt-3 flex items-center gap-2 !text-[var(--ice)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--signal)]" />
              {STEPS[step].hint}
            </div>
          </div>
        </div>

        {/* attention matrix */}
        {step >= 1 && step <= 3 && att && !mobile && (
          <div className="panel pointer-events-auto absolute right-[var(--gx)] top-[76px] w-[336px] p-4 animate-[atnIn_.9s_cubic-bezier(.16,1,.3,1)_both]">
            <div className="hud flex justify-between"><span>Attention matrix</span><span className="text-fg-22">{n}×{n}</span></div>
            <div className="mt-3 flex gap-4">
              <div className="shrink-0">
                <Heatmap att={att} head={head} q={q} mask={mask} tokens={tokens} onRow={setRowHover} size={156} />
              </div>
              <div className="flex min-w-0 flex-col items-start gap-1.5" role="group" aria-label="Attention heads">
                {headPills('!h-[26px] !gap-1.5 !px-2.5 !text-[9px] !tracking-[0.1em]')}
              </div>
            </div>
            <div className="mt-3 text-[12.5px] leading-snug text-fg-68">
              {headInfo ? <><span style={{ color: headInfo.color }}>{headInfo.name}:</span> “{headInfo.q}”</> : 'Four heads, four questions, one sentence.'}
            </div>
            <div className="hud mt-1.5 !text-[9px] !leading-relaxed text-fg-22">Row = token asking · column = token attended · rows sum to 1{mask ? ' · future masked' : ''}</div>
          </div>
        )}

        {/* control dock */}
        <div className="gx pointer-events-none absolute bottom-[78px] left-0 right-0 flex flex-col gap-3 md:bottom-[84px] md:right-[290px]">
          {step >= 1 && step !== 3 && mobile && (
            <div className="pointer-events-auto -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Attention heads">
              {headPills('shrink-0')}
            </div>
          )}
          {step === 3 && (
            <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-3 md:max-w-[300px]">
                <span className="hud shrink-0">Temp</span>
                <input className="slider" type="range" min={0.1} max={2} step={0.01} value={temp} onChange={(e) => setTemp(Number(e.target.value))} aria-label="Sampling temperature" data-cursor="Drag" />
                <span className="hud w-9 shrink-0 tabular-nums text-fg">{temp.toFixed(2)}</span>
              </label>
              <div className="flex gap-2">
                <button className="pill" data-active="true" onClick={generate} disabled={full} data-cursor="Write">Generate</button>
                <button className="pill" data-active={auto} aria-pressed={auto} onClick={() => setAuto((a) => !a)} disabled={full}>{auto ? 'Stop' : 'Auto'}</button>
                <button className="pill" data-active={mask} aria-pressed={mask} onClick={() => setMask((m) => !m)}>Mask</button>
              </div>
            </div>
          )}
          <div className="pointer-events-auto flex items-center gap-2">
            <label className="panel flex h-[46px] min-w-0 flex-1 items-center gap-3 !rounded-full pl-4 pr-1.5 transition-colors focus-within:!border-[rgba(255,79,31,0.7)] md:max-w-[620px]">
              <span className="hud hidden shrink-0 sm:inline">Your sentence</span>
              <input
                value={text}
                maxLength={MAX_CHARS}
                onChange={(e) => { setText(e.target.value); setPin(null); }}
                className="min-w-0 flex-1 bg-transparent font-sans text-[16px] text-fg outline-none placeholder:text-fg-22 focus-visible:!outline-none"
                placeholder="Type a sentence…"
                aria-label="Type your own sentence to tokenize"
                spellCheck={false}
                data-cursor="Type"
              />
              {text !== DEFAULT && (
                <button className="hud shrink-0 rounded-full px-3 py-2 hover:text-fg" onClick={() => { setText(DEFAULT); setAuto(false); }}>Reset</button>
              )}
            </label>
            {swap && step >= 1 && step <= 2 && (
              <button className="pill shrink-0" onClick={() => setText((t) => t.replace(' ' + swap[0], ' ' + swap[1]))} data-cursor="Swap">
                <span className="text-fg-42">try</span> “{swap[1]}”
              </button>
            )}
          </div>
          <div className="hud flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="text-fg tabular-nums">{n}</span> tokens</span>
            <span><span className="text-fg tabular-nums">{text.length}</span> chars</span>
            <span className="hidden sm:inline">BPE vocab <span className="text-fg">{model ? model.vocabSize.toLocaleString('en-US') : '—'}</span></span>
            {full && <span className="!text-[var(--signal)]">Context full — reset to keep writing</span>}
          </div>
        </div>

        {/* live readouts */}
        <div className="gx absolute bottom-[84px] right-0 hidden w-[290px] md:block">
          <dl className="hud grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-right [&_dd]:text-fg [&_dt]:text-left">
            <dt>Query</dt><dd>{q != null && tokens[q] ? `“${tokens[q].text}” #${q}` : '—'}</dd>
            <dt>Head</dt><dd>{head === 'all' ? 'All ×4' : headInfo?.name}</dd>
            <dt>Strongest key</dt><dd>{top ? `“${top.t}” ${top.w.toFixed(2)}` : '—'}</dd>
            <dt>Entropy</dt><dd>{ent != null ? `${ent.toFixed(2)} bits` : '—'}</dd>
            {step === 3 && best && <>
              <dt>Next</dt><dd className="!text-[var(--signal-hot)]">“{best.word}” {(best.q * 100).toFixed(1)}%</dd>
              <dt>Model</dt><dd>{pred.order}{pred.ctx.length ? ` · ${pred.ctx.join(' ')} →` : ''}</dd>
            </>}
            {step >= 4 && <>
              <dt>Layers</dt><dd><span ref={layersEl}>01</span> / 96</dd>
            </>}
          </dl>
        </div>
        {/* mobile readout: one line */}
        <div className="gx hud absolute bottom-[56px] left-0 right-0 truncate md:hidden">
          {step >= 4 ? <>Layers <span className="text-fg" ref={mobile ? layersEl : undefined}>01</span>/96 · </> : null}
          {q != null && tokens[q] ? <>“<span className="text-fg">{tokens[q].text}</span>” → {top ? <span className="text-fg">“{top.t}” {top.w.toFixed(2)}</span> : '—'}</> : null}
          {step >= 3 && best ? <> · next <span className="text-[var(--signal-hot)]">“{best.word}” {(best.q * 100).toFixed(0)}%</span></> : null}
        </div>

        {/* accessible token list */}
        <ol className="sr-only" aria-label="Tokens">
          {tokens.map((t, i) => (
            <li key={i}>
              <button className="sr-only-focusable pointer-events-auto" onFocus={() => setPin(i)} onClick={() => setPin(i)}>
                {`Token ${i + 1}: ${t.text}, id ${t.id}`}
                {att && q === i && top ? `, attends most to ${top.t} (${Math.round(top.w * 100)}%)` : ''}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <style>{`@keyframes atnIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>
    </>
  );
}

export default function AttentionChapter() {
  return (
    <Chapter id="attention" length={6} label="Attention: tokens, self-attention and next-token prediction">
      <Stage />
    </Chapter>
  );
}
