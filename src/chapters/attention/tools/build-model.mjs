// Offline builder for the Attention chapter's language model assets (NOT imported by the app).
//
//   node src/chapters/attention/tools/build-model.mjs <corpusDir>
//
// <corpusDir> holds public-domain Project Gutenberg texts (Aesop's Fables #11339, Alice #11,
// Grimms' Fairy Tales #2591, The Wind in the Willows #289). Produces public/attention/model.json:
//   tok:  a real byte-pair-encoding tokenizer (GPT-2 style pre-tokenizer + learned merges)
//   ng:   a word trigram/bigram/unigram model used for next-word prediction
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: build-model.mjs <corpusDir>');
const files = ['aesop.txt', 'alice.txt', 'grimm.txt', 'willows.txt'];
const N_MERGES = 5000;
// The tokenizer also learns from a few more public-domain novels (Sherlock Holmes #1661, Pride and
// Prejudice #1342, Frankenstein #84, Tom Sawyer #74, The Time Machine #35) so everyday words like
// "street" become single tokens, as in real GPT tokenizers. The n-gram model keeps the fable corpus.
const TOK_EXTRA = ['sherlock.txt', 'pride.txt', 'frankenstein.txt', 'sawyer.txt', 'timemachine.txt'];

function clean(raw) {
  const s = raw.indexOf('*** START OF');
  const e = raw.indexOf('*** END OF');
  let t = raw.slice(raw.indexOf('\n', s) + 1, e > 0 ? e : undefined);
  t = t
    .replace(/\r/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, ' - ')
    .replace(/_/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^\s*(CHAPTER|Chapter|PREFACE|CONTENTS)\b.*$/gm, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ');
  return t;
}

const text = files.map((f) => clean(fs.readFileSync(path.join(dir, f), 'utf8'))).join('\n\n');
const tokText = [text, ...TOK_EXTRA.filter((f) => fs.existsSync(path.join(dir, f))).map((f) => clean(fs.readFileSync(path.join(dir, f), 'utf8')))].join('\n\n');
console.log('corpus chars', text.length, 'tokenizer chars', tokText.length);

// ---------------------------------------------------------------- BPE tokenizer
const PRE = /'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^\sA-Za-z0-9]+/g;
const SP = 'Ġ'; // Ġ, GPT-2's marker for a leading space
const wordFreq = new Map();
for (const line of tokText.split('\n')) {
  for (const m of line.matchAll(PRE)) {
    const w = m[0].replace(/^ /, SP);
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
  }
}
const base = new Set();
for (const w of wordFreq.keys()) for (const ch of w) base.add(ch);
// make sure every printable ASCII char exists so user input always tokenizes
for (let c = 32; c < 127; c++) base.add(String.fromCharCode(c) === ' ' ? SP : String.fromCharCode(c));
const baseList = [...base].sort();
console.log('unique pre-tokens', wordFreq.size, 'base symbols', baseList.length);

const words = [...wordFreq.entries()].map(([w, f]) => ({ s: [...w], f }));
const merges = [];
for (let it = 0; it < N_MERGES; it++) {
  const pc = new Map();
  for (const { s, f } of words) {
    for (let i = 0; i < s.length - 1; i++) {
      const k = s[i] + '\u0001' + s[i + 1];
      pc.set(k, (pc.get(k) || 0) + f);
    }
  }
  let best = null, bc = 0;
  for (const [k, c] of pc) if (c > bc) { bc = c; best = k; }
  if (!best || bc < 2) break;
  const [a, b] = best.split('\u0001');
  merges.push(a + ' ' + b);
  const ab = a + b;
  for (const w of words) {
    const s = w.s;
    if (s.length < 2) continue;
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (i < s.length - 1 && s[i] === a && s[i + 1] === b) { out.push(ab); i++; } else out.push(s[i]);
    }
    w.s = out;
  }
  if (it % 300 === 0) console.log('merge', it, a + '+' + b, bc);
}

// ---------------------------------------------------------------- word n-grams
const lower = text.toLowerCase();
const seq = [];
for (const para of lower.split('\n\n')) {
  const toks = para.match(/[a-z]+(?:'[a-z]+)?|[.,!?;:]/g);
  if (!toks) continue;
  if (!/^[.!?]$/.test(seq[seq.length - 1] || '')) seq.push('.');
  for (const t of toks) seq.push(t);
}
const uni = new Map();
for (const t of seq) uni.set(t, (uni.get(t) || 0) + 1);
const vocab = [...uni.entries()].filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1]).map(([w]) => w);
const vid = new Map(vocab.map((w, i) => [w, i]));
console.log('ngram tokens', seq.length, 'vocab', vocab.length);

const big = new Map();
const tri = new Map();
const ctx2 = new Map();
for (let i = 0; i < seq.length; i++) {
  const c = vid.get(seq[i]);
  if (c === undefined) continue;
  const b1 = i > 0 ? vid.get(seq[i - 1]) : undefined;
  const b2 = i > 1 ? vid.get(seq[i - 2]) : undefined;
  if (b1 !== undefined) {
    let m = big.get(b1); if (!m) big.set(b1, (m = new Map()));
    m.set(c, (m.get(c) || 0) + 1);
    if (b2 !== undefined) {
      const k = b2 + ' ' + b1;
      let n = tri.get(k); if (!n) tri.set(k, (n = new Map()));
      n.set(c, (n.get(c) || 0) + 1);
      ctx2.set(k, (ctx2.get(k) || 0) + 1);
    }
  }
}
const flat = (m, top, min) => {
  const arr = [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, top);
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [total, ...arr.flat()];
};
const B = {};
for (const [k, m] of big) B[k] = flat(m, 16, 1);
const T = {};
let tk = 0;
for (const [k, m] of tri) {
  if (ctx2.get(k) < 3) continue;
  const f = flat(m, 10, 2);
  if (f.length < 3) continue;
  T[k] = f; tk++;
}
const U = vocab.map((w) => uni.get(w));
console.log('bigram ctx', Object.keys(B).length, 'trigram ctx', tk);

const out = {
  about: 'Trained offline on public-domain Project Gutenberg texts: Aesop\'s Fables, Alice in Wonderland, Grimms\' Fairy Tales, The Wind in the Willows.',
  tok: { base: baseList.join(''), merges },
  ng: { vocab, uni: U, bi: B, tri: T, tokens: seq.length },
};
const dest = path.resolve('public/attention/model.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log('wrote', dest, (fs.statSync(dest).size / 1024).toFixed(0) + 'KB');
