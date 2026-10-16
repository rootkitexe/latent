'use client'

/**
 * The real (small) math behind the Attention chapter.
 *  - tokenize(): a genuine byte-pair-encoding tokenizer (GPT-2 style pre-tokenizer + 5,000 merges learned
 *    offline from public-domain fables, see tools/build-model.mjs).
 *  - attention(): four ILLUSTRATIVE heads. Each head produces a matrix of raw scores from transparent
 *    rules (lexicon + position), then every row goes through a real softmax (optionally causally masked).
 *  - predict(): a real word trigram/bigram/unigram model (interpolated) trained on the same corpus.
 */

const SP = 'Ġ';
const PRE = /'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^\sA-Za-z0-9]+/g;

let modelPromise = null;
export function loadModel() {
  if (!modelPromise) {
    modelPromise = fetch('/attention/model.json')
      .then((r) => r.json())
      .then(prepare)
      .catch((e) => {
        modelPromise = null;
        throw e;
      });
  }
  return modelPromise;
}

function prepare(raw) {
  const base = [...raw.tok.base];
  const ranks = new Map();
  const ids = new Map();
  base.forEach((c, i) => ids.set(c, i));
  raw.tok.merges.forEach((m, r) => {
    ranks.set(m, r);
    const merged = m.replace(' ', '');
    if (!ids.has(merged)) ids.set(merged, base.length + r);
  });
  const ng = raw.ng;
  const vid = new Map(ng.vocab.map((w, i) => [w, i]));
  const uniTotal = ng.uni.reduce((a, b) => a + b, 0);
  const uniTop = ng.uni.slice(0, 48).map((c, i) => [i, c]);
  return {
    vocabSize: base.length + raw.tok.merges.length,
    ranks, ids, cache: new Map(),
    ng, vid, uniTotal, uniTop, about: raw.about,
  };
}

// ---------------------------------------------------------------------------------- tokenizer
function bpe(M, word) {
  const hit = M.cache.get(word);
  if (hit) return hit;
  let s = [...word];
  while (s.length > 1) {
    let best = -1, bestRank = Infinity;
    for (let i = 0; i < s.length - 1; i++) {
      const r = M.ranks.get(s[i] + ' ' + s[i + 1]);
      if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
    }
    if (best < 0) break;
    const a = s[best], b = s[best + 1];
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (i < s.length - 1 && s[i] === a && s[i + 1] === b) { out.push(a + b); i++; } else out.push(s[i]);
    }
    s = out;
  }
  M.cache.set(word, s);
  return s;
}

const asciiOnly = (t) =>
  t.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, '?');

/** -> [{ raw, text, id, space, cont, word, wordText }] */
export function tokenize(M, text) {
  const t = asciiOnly(text);
  const out = [];
  let w = 0;
  for (const m of t.matchAll(PRE)) {
    const piece = m[0].replace(/^ /, SP);
    const wordText = piece.replace(SP, '').toLowerCase();
    const parts = M ? bpe(M, piece) : [piece];
    parts.forEach((p, k) => {
      const space = p.startsWith(SP);
      out.push({
        raw: p,
        text: p.replace(SP, ''),
        id: M ? M.ids.get(p) ?? 0 : 0,
        space,
        cont: out.length > 0 && !space,
        word: w,
        piece: k,
        last: k === parts.length - 1,
        wordText,
      });
    });
    w++;
  }
  return out;
}

// ---------------------------------------------------------------------------------- tiny tagger
const L = (s) => new Set(s.split(' '));
const DET = L('the a an this that these those my your his her its our their every each some no any another');
const PRON_IT = L('it its itself');
const PRON_ANIM = L('he she him her his hers himself herself');
const PRON_PL = L('they them their themselves');
const PRON_OTHER = L('i you we me us who which what myself yourself');
const PREP = L('in on at to of from with by for over under into onto through across after before about upon behind near beside along against around towards toward without within off up down out');
const CONJ = L('and but or because so while although though if when than as since until unless whereas nor');
const AUX = L('is was were are am be been being has have had do does did can could will would shall should may might must didn doesn wasn isn couldn wouldn don hasn haven weren aren shouldn won');
const NEG = L("'t not n't never");
const ADV = L('too very so quite just then there here also only still even almost rather really soon now again always often once already');
const ADJ = L('tired hungry happy sad afraid angry sleepy scared brave clever foolish proud wise lazy thirsty excited curious wide narrow long busy empty crowded deep dark wet steep broad full icy muddy big small little old young quick brown good bad great tall short cold hot heavy weak strong slow fast beautiful poor rich red green white black golden kind cruel gentle ugly pretty sweet bitter quiet loud bright soft hard high low large tiny huge fat thin new dead alive safe slippery dangerous fierce frightened weary');
const ANIM_ADJ = L('tired hungry happy sad afraid angry sleepy scared brave clever foolish proud wise lazy thirsty excited curious kind cruel gentle frightened weary fierce alive dead');
const INANIM_ADJ = L('wide narrow long busy empty crowded deep steep broad full icy muddy slippery flooded high');
const ANIM_VERB = L('ate slept ran said thought wanted felt cried laughed barked jumped smiled wept sang hoped decided refused');
const VERB = L('cross crossed crosses ran run runs jumped jump saw see sees ate eat eats said say says went go goes came come comes took take made make found find gave give loved love loves wanted want thought think knew know looked look chased chase sat sit flew fly caught catch killed kill met meet told tell asked ask carried carry fell fall walked walk slept sleep built build opened open watched watch heard hear wrote write read bit bite hid hide left leave stood stand lay lies kept keep brought bring tried try sang sing called call helped help began begin learned learn liked like hated hate');
const HUMAN = L('man woman boy girl king queen child children people prince princess farmer mother father brother sister wife husband son daughter friend lady gentleman soldier miller tailor woodman shepherd hunter alice');
const ANIMAL = L('animal animals dog dogs cat cats fox wolf lion mouse mice bird birds horse hare tortoise crow frog bear rabbit rat toad mole badger goose geese ass donkey lamb sheep goat cow bull deer eagle hen cock owl monkey ant grasshopper snake fish duck pig');

function tag(w, i, raw) {
  if (/^[^a-z0-9']+$/.test(w)) return 'PUNCT';
  if (DET.has(w)) return 'DET';
  if (PRON_IT.has(w) || PRON_ANIM.has(w) || PRON_PL.has(w) || PRON_OTHER.has(w)) return 'PRON';
  if (NEG.has(w)) return 'NEG';
  if (AUX.has(w)) return 'AUX';
  if (PREP.has(w)) return 'PREP';
  if (CONJ.has(w)) return 'CONJ';
  if (ADV.has(w)) return 'ADV';
  if (ADJ.has(w)) return 'ADJ';
  if (VERB.has(w)) return 'VERB';
  if (/^'/.test(w)) return 'NEG';
  if (i > 0 && /^[A-Z]/.test(raw)) return 'NOUN';
  if (/ly$/.test(w) && w.length > 4) return 'ADV';
  if (/(ed|ing)$/.test(w) && w.length > 4) return 'VERB';
  if (/(ous|ful|ive|able|ible|less|ish)$/.test(w) && w.length > 5) return 'ADJ';
  return 'NOUN';
}
const isAnimate = (w, raw) => HUMAN.has(w) || ANIMAL.has(w) || /^[A-Z]/.test(raw);

/** Word-level analysis shared by the heads. */
function analyse(tokens) {
  const words = [];
  for (const t of tokens) {
    if (!words[t.word]) words[t.word] = { text: t.wordText, raw: '', toks: [], tag: '' };
    words[t.word].raw += t.text;
    words[t.word].toks.push(tokens.indexOf(t));
  }
  words.forEach((w, i) => {
    w.tag = tag(w.text, i, w.raw);
    w.anim = w.tag === 'NOUN' && isAnimate(w.text, w.raw);
    w.human = HUMAN.has(w.text);
  });
  return words;
}

// ---------------------------------------------------------------------------------- heads
export const HEADS = [
  { id: 'coref', name: 'Coreference', q: 'Who does this refer to?', color: '#FF4F1F' },
  { id: 'prev', name: 'Previous token', q: 'What came just before me?', color: '#A8F0FF' },
  { id: 'syntax', name: 'Who did what', q: 'Which word do I attach to?', color: '#B48CFF' },
  { id: 'pos', name: 'Neighbourhood', q: 'Who is near me?', color: '#7CFFD2' },
];

const NEG_INF = -1e9;

function corefCue(words, k) {
  for (let j = k + 1; j < Math.min(words.length, k + 6); j++) {
    const w = words[j];
    if (w.tag === 'AUX' || w.tag === 'ADV' || w.tag === 'NEG') continue;
    if (ANIM_ADJ.has(w.text) || ANIM_VERB.has(w.text)) return 1;
    if (INANIM_ADJ.has(w.text)) return -1;
    if (w.tag === 'ADJ' || w.tag === 'VERB') return 0;
    if (w.tag === 'PUNCT' || w.tag === 'CONJ') return 0;
  }
  return 0;
}

/** word-level coref scores for a pronoun at word k */
function corefPronoun(words, k) {
  const p = words[k].text;
  const cue = corefCue(words, k);
  const firstNoun = words.findIndex((w) => w.tag === 'NOUN');
  return words.map((w, j) => {
    if (j === k) return 0.2;
    let s = w.tag === 'NOUN' ? 1.6 : w.tag === 'PRON' ? 0.4 : -2.2;
    s += j < k ? -0.06 * (k - j) : -2.6;
    if (w.tag === 'NOUN') {
      if (PRON_ANIM.has(p)) s += w.anim ? 1.8 : -1.4;
      else if (PRON_IT.has(p)) {
        if (cue === 1) s += w.anim ? 2.6 : -1.0;
        else if (cue === -1) s += w.anim ? -1.0 : 2.6;
        else s += j === firstNoun ? 0.5 : 0;
        if (w.human) s -= 1.2;
      } else if (PRON_PL.has(p)) s += /s$/.test(w.text) ? 0.8 : 0;
    }
    return s;
  });
}
const isRefPronoun = (t) => PRON_IT.has(t) || PRON_ANIM.has(t) || PRON_PL.has(t);

function syntaxScores(words, k) {
  const w = words[k];
  const s = words.map(() => 0);
  s[k] = 0.5;
  const before = (pred, max = 8) => { for (let j = k - 1; j >= Math.max(0, k - max); j--) if (pred(words[j])) return j; return -1; };
  const after = (pred, max = 6) => { for (let j = k + 1; j < Math.min(words.length, k + 1 + max); j++) if (pred(words[j])) return j; return -1; };
  const nominal = (x) => x.tag === 'NOUN' || x.tag === 'PRON';
  const verbal = (x) => x.tag === 'VERB' || x.tag === 'AUX';
  const add = (j, v) => { if (j >= 0) s[j] += v; };
  switch (w.tag) {
    case 'DET': case 'PREP': add(after((x) => x.tag === 'NOUN'), 4); break;
    case 'ADJ': {
      const n = k + 1 < words.length && words[k + 1].tag === 'NOUN' ? k + 1 : -1;
      if (n >= 0) add(n, 4);
      else add(before(nominal), 3.6);
      break;
    }
    case 'VERB': case 'AUX': add(before(nominal), 3); add(after((x) => x.tag === 'NOUN' || x.tag === 'ADJ'), 2.8); break;
    case 'NEG': add(before(verbal, 3), 4); break;
    case 'ADV': add(after((x) => x.tag === 'ADJ' || x.tag === 'VERB' || x.tag === 'ADV', 3), 3.6); break;
    case 'NOUN': add(after(verbal, 5) >= 0 ? after(verbal, 5) : before(verbal), 3); break;
    case 'PRON': add(after(verbal, 3), 3.2); break;
    case 'CONJ': add(before(verbal, 12), 2.6); add(after(verbal), 2.6); break;
    default: add(before((x) => x.tag !== 'PUNCT', 4), 2);
  }
  return s;
}

/** Full attention matrices for every head: { [headId]: { scores: number[][], weights: number[][] } } */
export function attention(tokens, { mask = false } = {}) {
  const n = tokens.length;
  const words = analyse(tokens);
  // word-level -> token-level: a word's score is shared by its pieces (−ln k keeps the word's total weight
  // the same whether it is one token or k tokens)
  const lift = (wordScores) => {
    const row = new Array(n);
    for (let j = 0; j < n; j++) {
      const wj = tokens[j].word;
      row[j] = wordScores[wj] - Math.log(words[wj].toks.length);
    }
    return row;
  };

  // coref: resolve every reference pronoun once
  const resolved = new Map(); // nounWord -> [pronounWords]
  const pronScores = new Map();
  words.forEach((w, k) => {
    if (w.tag === 'PRON' && isRefPronoun(w.text)) {
      const sc = corefPronoun(words, k);
      pronScores.set(k, sc);
      let best = -1, bs = -Infinity;
      sc.forEach((v, j) => { if (j !== k && v > bs) { bs = v; best = j; } });
      if (best >= 0 && bs > 0) {
        if (!resolved.has(best)) resolved.set(best, []);
        resolved.get(best).push(k);
      }
    }
  });

  const scores = { coref: [], prev: [], syntax: [], pos: [] };
  for (let i = 0; i < n; i++) {
    const k = tokens[i].word;
    const w = words[k];
    // coreference
    let ws;
    if (pronScores.has(k)) ws = pronScores.get(k);
    else if (w.tag === 'NOUN') {
      const refs = resolved.get(k) || [];
      ws = words.map((x, j) => (j === k ? 1.6 : refs.includes(j) ? 3.2 : x.text === w.text ? 2.4 : -0.6));
    } else ws = words.map((x, j) => (j === k ? 1.1 : j === 0 ? 2.3 : 0));
    scores.coref.push(lift(ws));
    // previous token (token-level)
    scores.prev.push(Array.from({ length: n }, (_, j) => (i === 0 ? (j === 0 ? 3 : -1) : j === i - 1 ? 4.5 : j === i ? 1.2 : -0.15 * Math.abs(i - j))));
    // syntax
    scores.syntax.push(lift(syntaxScores(words, k)));
    // neighbourhood
    scores.pos.push(Array.from({ length: n }, (_, j) => -0.85 * Math.abs(i - j) + (j === i ? 0.3 : 0)));
  }
  const out = {};
  for (const h of HEADS) out[h.id] = { scores: scores[h.id], weights: scores[h.id].map((r, i) => softmax(r, mask ? i : -1)) };
  return out;
}

/** softmax over a row; if causalAt >= 0, keys after it are masked to -inf. */
export function softmax(row, causalAt = -1) {
  let m = -Infinity;
  const z = row.map((v, j) => (causalAt >= 0 && j > causalAt ? NEG_INF : v));
  for (const v of z) if (v > m) m = v;
  let sum = 0;
  const e = z.map((v) => { const x = v <= NEG_INF / 2 ? 0 : Math.exp(v - m); sum += x; return x; });
  return e.map((x) => x / (sum || 1));
}

export const entropyBits = (p) => -p.reduce((a, x) => (x > 1e-9 ? a + x * Math.log2(x) : a), 0);

// ---------------------------------------------------------------------------------- next word
export function contextWords(text) {
  return (asciiOnly(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?|[.,!?;:]/g) || []);
}

/** Interpolated trigram → bigram → unigram distribution over candidate next words. */
export function predict(M, text) {
  const ws = contextWords(text);
  const id = (w) => (w === undefined ? undefined : M.vid.get(w));
  const w2 = ws.length ? id(ws[ws.length - 1]) : id('.');
  const w1 = ws.length > 1 ? id(ws[ws.length - 2]) : ws.length === 1 ? id('.') : undefined;
  const tri = w1 !== undefined && w2 !== undefined ? M.ng.tri[w1 + ' ' + w2] : null;
  const bi = w2 !== undefined ? M.ng.bi[w2] : null;
  const l3 = tri ? 0.6 : 0;
  const l2 = bi ? (tri ? 0.32 : 0.86) : 0;
  const l1 = 1 - l3 - l2;
  const p = new Map();
  const addList = (arr, lambda) => {
    if (!arr) return;
    const total = arr[0];
    for (let i = 1; i < arr.length; i += 2) p.set(arr[i], (p.get(arr[i]) || 0) + lambda * (arr[i + 1] / total));
  };
  addList(tri, l3);
  addList(bi, l2);
  for (const [i, c] of M.uniTop) p.set(i, (p.get(i) || 0) + l1 * (c / M.uniTotal));
  let sum = 0;
  for (const v of p.values()) sum += v;
  const list = [...p.entries()]
    .map(([i, v]) => ({ word: M.ng.vocab[i], p: v / sum }))
    .sort((a, b) => b.p - a.p);
  const ctx = tri ? [M.ng.vocab[w1], M.ng.vocab[w2]] : bi ? [M.ng.vocab[w2]] : [];
  return { list, order: tri ? 'trigram' : bi ? 'bigram' : 'unigram', ctx };
}

/** Temperature-scaled distribution: softmax(log p / T). */
export function withTemperature(list, T) {
  const t = Math.max(0.05, T);
  const logits = list.map((c) => Math.log(c.p) / t);
  const m = Math.max(...logits);
  const e = logits.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return list.map((c, i) => ({ ...c, q: e[i] / s }));
}

export function sample(dist) {
  let r = Math.random();
  for (const d of dist) { r -= d.q; if (r <= 0) return d; }
  return dist[0];
}

/** Append a predicted word to the text with sensible spacing/capitalisation. */
export function appendWord(text, word) {
  const t = text.replace(/\s+$/, '');
  if (/^[.,!?;:]$/.test(word)) return t + word;
  const capital = !t || /[.!?]$/.test(t);
  const w = capital ? word[0].toUpperCase() + word.slice(1) : word === 'i' ? 'I' : word;
  return (t ? t + ' ' : '') + w;
}
