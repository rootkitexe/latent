/**
 * Tabular Q-learning in a deterministic grid world. Pure JS, no allocations per step.
 *
 *   Q(s,a) ← Q(s,a) + α · ( r + γ · max_a' Q(s',a') − Q(s,a) )
 *
 * Tiles: 0 floor, 1 wall, 2 pit (terminal, −1), 3 goal (terminal, +1). Each move costs STEP_COST.
 * Actions: 0 north (−row), 1 east (+col), 2 south (+row), 3 west (−col). Bumping a wall/edge = stay.
 */
export const FLOOR = 0;
export const WALL = 1;
export const PIT = 2;
export const GOAL = 3;

export const DR = [-1, 0, 1, 0];
export const DC = [0, 1, 0, -1];
export const ARROWS = ['↑', '→', '↓', '←'];
export const ACTION_NAMES = ['north', 'east', 'south', 'west'];

export const R_GOAL = 1;
export const R_PIT = -1;
export const STEP_COST = -0.01;
export const MAX_STEPS = 160;

// Small seeded PRNG so the multiverse worlds are reproducible.
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The hero layout. S = start, G = goal, # = wall, o = pit. The goal sits in a walled courtyard guarded by pits. */
export const DEFAULT_MAP = [
  '.........',
  '.#.##.o#.',
  '.#...G.#.',
  '.#.o#..#.',
  '...##.o..',
  '.#.....#.',
  '.#o.#..#.',
  '.##.#.##.',
  'S........',
];

export class GridWorld {
  constructor(w = 9, h = 9, rand = Math.random) {
    this.w = w;
    this.h = h;
    this.n = w * h;
    this.rand = rand;
    this.tiles = new Uint8Array(this.n);
    this.Q = new Float32Array(this.n * 4);
    this.start = 0;
    this.goal = 0;
    this.alpha = 0.5;
    this.gamma = 0.9;
    this.eps = 0.15;
    this.version = 0; // bumps on any layout change
    // episode state
    this.s = 0;
    this.prev = 0;
    this.lastA = 0;
    this.steps = 0;
    this.epReward = 0;
    this.episode = 0;
    this.totalSteps = 0;
    this.done = false;
    this.outcome = 0; // +1 goal, -1 pit, 0 timeout, while done
    // history of episode returns
    this.returns = new Float32Array(4096);
    this.nReturns = 0;
    this.goals = 0;
    this.falls = 0;
    // last update, for the live formula
    this.last = { s: 0, a: 0, q0: 0, r: 0, maxNext: 0, q1: 0, terminal: false };
  }

  idx(r, c) { return r * this.w + c; }

  loadMap(rows) {
    this.tiles.fill(FLOOR);
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const ch = rows[r][c];
        const i = this.idx(r, c);
        if (ch === '#') this.tiles[i] = WALL;
        else if (ch === 'o') this.tiles[i] = PIT;
        else if (ch === 'G') { this.tiles[i] = GOAL; this.goal = i; }
        else if (ch === 'S') this.start = i;
      }
    }
    this.version++;
    this.resetBrain();
  }

  randomLayout(rand = this.rand) {
    // a random world with a guaranteed path from start to goal
    for (let tries = 0; tries < 50; tries++) {
      this.tiles.fill(FLOOR);
      const corner = Math.floor(rand() * 4);
      const sr = corner < 2 ? this.h - 1 : 0;
      const sc = corner % 2 ? this.w - 1 : 0;
      this.start = this.idx(sr, sc);
      const gr = this.h - 1 - sr + (sr ? 1 : -1) * Math.floor(rand() * 3);
      const gc = this.w - 1 - sc + (sc ? 1 : -1) * Math.floor(rand() * 3);
      this.goal = this.idx(gr, gc);
      this.tiles[this.goal] = GOAL;
      const walls = 12 + Math.floor(rand() * 8);
      for (let k = 0; k < walls; k++) this.place(Math.floor(rand() * this.n), WALL);
      const pits = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < pits; k++) this.place(Math.floor(rand() * this.n), PIT);
      if (this.reachable()) break;
    }
    this.version++;
    this.resetBrain();
  }

  place(i, kind) {
    if (i === this.start || i === this.goal) return;
    this.tiles[i] = kind;
  }

  /** BFS from start to goal through floor tiles. */
  reachable() {
    const seen = new Uint8Array(this.n);
    const q = [this.start];
    seen[this.start] = 1;
    while (q.length) {
      const s = q.shift();
      if (s === this.goal) return true;
      const r = (s / this.w) | 0;
      const c = s % this.w;
      for (let a = 0; a < 4; a++) {
        const nr = r + DR[a];
        const nc = c + DC[a];
        if (nr < 0 || nc < 0 || nr >= this.h || nc >= this.w) continue;
        const n = this.idx(nr, nc);
        if (seen[n] || this.tiles[n] === WALL || this.tiles[n] === PIT) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    return false;
  }

  /** Edit a tile with a tool. Returns true if something changed. Keeps the learned Q (it re-learns). */
  edit(i, tool) {
    if (i === this.start) return false;
    const t = this.tiles[i];
    if (tool === GOAL) {
      if (t === GOAL) return false;
      this.tiles[this.goal] = FLOOR;
      this.tiles[i] = GOAL;
      this.goal = i;
    } else {
      if (i === this.goal) return false;
      this.tiles[i] = t === tool ? FLOOR : tool;
    }
    // a changed tile has no meaningful values any more
    for (let a = 0; a < 4; a++) this.Q[i * 4 + a] = 0;
    this.version++;
    if (this.s === i || this.tiles[this.s] !== FLOOR) this.newEpisode(false);
    return true;
  }

  setTile(i, kind) {
    if (i === this.start || i === this.goal) return false;
    if (this.tiles[i] === kind) return false;
    this.tiles[i] = kind;
    for (let a = 0; a < 4; a++) this.Q[i * 4 + a] = 0;
    this.version++;
    if (this.s === i) this.newEpisode(false);
    return true;
  }

  resetBrain() {
    this.Q.fill(0);
    this.episode = 0;
    this.totalSteps = 0;
    this.nReturns = 0;
    this.goals = 0;
    this.falls = 0;
    this.newEpisode(false);
  }

  newEpisode(count = true) {
    if (count) this.episode++;
    this.s = this.prev = this.start;
    this.steps = 0;
    this.epReward = 0;
    this.done = false;
    this.outcome = 0;
  }

  maxQ(s) {
    const o = s * 4;
    const q = this.Q;
    let m = q[o];
    if (q[o + 1] > m) m = q[o + 1];
    if (q[o + 2] > m) m = q[o + 2];
    if (q[o + 3] > m) m = q[o + 3];
    return m;
  }

  /** Greedy action with random tie-breaking. */
  greedy(s) {
    const o = s * 4;
    const m = this.maxQ(s);
    let pick = -1;
    let ties = 0;
    for (let a = 0; a < 4; a++) {
      if (this.Q[o + a] >= m - 1e-6) {
        ties++;
        if (this.rand() * ties < 1) pick = a;
      }
    }
    return pick;
  }

  /** Does the greedy policy have an actual preference here (not all-equal)? */
  confidence(s) {
    const o = s * 4;
    const q = this.Q;
    let mx = q[o], mn = q[o];
    for (let a = 1; a < 4; a++) { if (q[o + a] > mx) mx = q[o + a]; if (q[o + a] < mn) mn = q[o + a]; }
    return mx - mn;
  }

  /** Strict argmax (first max) for drawing arrows without flicker. */
  argmax(s) {
    const o = s * 4;
    let best = 0;
    for (let a = 1; a < 4; a++) if (this.Q[o + a] > this.Q[o + best] + 1e-7) best = a;
    return best;
  }

  /** Where action a leads from s (walls and edges block). */
  next(s, a) {
    const r = ((s / this.w) | 0) + DR[a];
    const c = (s % this.w) + DC[a];
    if (r < 0 || c < 0 || r >= this.h || c >= this.w) return s;
    const n = r * this.w + c;
    return this.tiles[n] === WALL ? s : n;
  }

  /**
   * One environment step + one Q-learning update.
   * epsOverride: pass 0 for a pure greedy walk (no learning when learn=false).
   */
  step(epsOverride = -1, learn = true) {
    if (this.done) this.newEpisode(true);
    const s = this.s;
    const eps = epsOverride >= 0 ? epsOverride : this.eps;
    const a = this.rand() < eps ? Math.floor(this.rand() * 4) : this.greedy(s);
    const n = this.next(s, a);
    const t = this.tiles[n];
    let r = STEP_COST;
    let terminal = false;
    if (t === GOAL) { r = R_GOAL; terminal = true; }
    else if (t === PIT) { r = R_PIT; terminal = true; }
    const qi = s * 4 + a;
    const q0 = this.Q[qi];
    const maxNext = terminal ? 0 : this.maxQ(n);
    if (learn) this.Q[qi] = q0 + this.alpha * (r + this.gamma * maxNext - q0);
    const L = this.last;
    L.s = s; L.a = a; L.q0 = q0; L.r = r; L.maxNext = maxNext; L.q1 = this.Q[qi]; L.terminal = terminal;

    this.prev = s;
    this.s = n;
    this.lastA = a;
    this.steps++;
    if (learn) this.totalSteps++;
    this.epReward += r;
    if (terminal || this.steps >= MAX_STEPS) {
      this.done = true;
      this.outcome = terminal ? (t === GOAL ? 1 : -1) : 0;
      if (t === GOAL && learn) this.goals++;
      if (t === PIT && learn) this.falls++;
      if (learn) this.pushReturn(this.epReward);
    }
    return a;
  }

  pushReturn(v) {
    if (this.nReturns >= this.returns.length) {
      this.returns.copyWithin(0, this.returns.length / 2);
      this.nReturns = this.returns.length / 2;
    }
    this.returns[this.nReturns++] = v;
  }

  avgReturn(k = 50, end = this.nReturns) {
    const from = Math.max(0, end - k);
    if (end <= from) return 0;
    let s = 0;
    for (let i = from; i < end; i++) s += this.returns[i];
    return s / (end - from);
  }

  /** Run whole episodes instantly (fast-forward). */
  train(episodes, maxStepsTotal = 400000) {
    let budget = maxStepsTotal;
    for (let e = 0; e < episodes && budget > 0; e++) {
      this.newEpisode(this.steps > 0 || this.done);
      while (!this.done && budget-- > 0) this.step();
    }
    this.newEpisode(true);
  }

  /** The greedy path from start (for the showcase walk); stops at a terminal or a loop. */
  greedyPath(out = []) {
    out.length = 0;
    const seen = new Uint8Array(this.n);
    let s = this.start;
    out.push(s);
    for (let k = 0; k < this.n; k++) {
      seen[s] = 1;
      const n = this.next(s, this.argmax(s));
      out.push(n);
      if (this.tiles[n] === GOAL || this.tiles[n] === PIT || seen[n]) break;
      s = n;
    }
    return out;
  }
}
