import { lossGrad, loss, GLOBAL_MIN, EXTENT } from './landscape';

/**
 * Real optimisers on the analytic landscape. Each ball is one training run on two weights (u, v):
 *   GD        w ← w − lr·∇L
 *   SGD       same rule, but ∇L is a noisy estimate (as if measured on a random mini-batch)
 *   Momentum  m ← β·m + ∇L ;  w ← w − lr·m
 *   Adam      m ← β1·m + (1−β1)∇L ; s ← β2·s + (1−β2)∇L² ; w ← w − lr·m̂ / (√ŝ + ε)
 * Pure JS, no three.js. The scene reads ball state to draw it.
 */
export const OPT = { GD: 0, SGD: 1, MOM: 2, ADAM: 3 };
export const ST = { OFF: 0, WAIT: 1, FALL: 2, RUN: 3, REST: 4, FLY: 5, FADE: 6 };

const HIST = 600;
const o = [0, 0, 0];

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeBall(i) {
  return {
    i, state: ST.OFF, serial: 0, tag: '', opt: OPT.GD, lr: 0.06, liveLr: false, noise: 0,
    u: 0, v: 0, pu: 0, pv: 0, mu: 0, mv: 0, su: 0, sv: 0, t: 0,
    L: 0, gu: 0, gv: 0, g: 0, stepLen: 0, lastDu: 0, lastDv: 0, zig: 0, rising: 0,
    timer: 0, interval: 0.11, delay: 0, fallT: 0, fallDur: 0.6, dropH: 7,
    calm: 0, au: 0, av: 0, maxSteps: 900, outcome: '', restT: 0,
    fx: 0, fy: 0, fz: 0, vx: 0, vy: 0, vz: 0, flyT: 0, fadeT: 0,
    radius: 0.3, color: 0, kind: 'main', trailLife: 1e4, trailW: 2, trailI: 1, glow: false, markers: true,
    lastTx: NaN, lastTy: 0, lastTz: 0,
    hist: new Float32Array(HIST), histN: 0,
  };
}

export class Sim {
  constructor(max) {
    this.max = max;
    this.balls = Array.from({ length: max }, (_, i) => makeBall(i));
    this.events = [];
    this.serial = 0;
    this.focus = -1;
  }

  /** Spawn a ball. `cap` limits how many balls with the same tag may live at once (oldest go). */
  spawn(opts) {
    const { tag = 'main', cap = 99 } = opts;
    const live = this.balls.filter((b) => b.state !== ST.OFF && b.state !== ST.FADE && b.tag === tag);
    if (live.length >= cap) {
      live.sort((a, b) => a.serial - b.serial);
      for (let k = 0; k <= live.length - cap; k++) this.fade(live[k]);
    }
    let b = this.balls.find((x) => x.state === ST.OFF);
    if (!b) {
      b = this.balls.filter((x) => x.state !== ST.OFF).sort((a, c) => a.serial - c.serial)[0];
    }
    const i = b.i;
    const hist = b.hist;
    Object.assign(b, makeBall(i), { hist });
    Object.assign(b, opts);
    b.serial = ++this.serial;
    b.pu = b.u; b.pv = b.v; b.au = b.u; b.av = b.v;
    b.state = b.delay > 0 ? ST.WAIT : ST.FALL;
    lossGrad(b.u, b.v, o);
    b.L = o[0]; b.gu = o[1]; b.gv = o[2]; b.g = Math.hypot(o[1], o[2]);
    b.hist[0] = b.L; b.histN = 1;
    return b;
  }

  fade(b) {
    if (b.state === ST.OFF) return;
    b.state = ST.FADE;
    b.fadeT = 0;
  }

  clear(tag) {
    for (const b of this.balls) if (!tag || b.tag === tag) this.fade(b);
    this.focus = -1;
  }

  count(fn) {
    let n = 0;
    for (const b of this.balls) if (b.state !== ST.OFF && b.state !== ST.FADE && fn(b)) n++;
    return n;
  }

  step(b, lrNow) {
    lossGrad(b.u, b.v, o);
    let gu = o[1], gv = o[2];
    if (b.noise > 0) {
      gu += b.noise * gauss();
      gv += b.noise * gauss();
    }
    const lr = b.liveLr ? lrNow : b.lr;
    b.lrUsed = lr;
    b.t++;
    let du, dv;
    if (b.opt === OPT.MOM) {
      b.mu = 0.9 * b.mu + gu; b.mv = 0.9 * b.mv + gv;
      du = -lr * b.mu; dv = -lr * b.mv;
    } else if (b.opt === OPT.ADAM) {
      b.mu = 0.9 * b.mu + 0.1 * gu; b.mv = 0.9 * b.mv + 0.1 * gv;
      b.su = 0.999 * b.su + 0.001 * gu * gu; b.sv = 0.999 * b.sv + 0.001 * gv * gv;
      const c1 = 1 - Math.pow(0.9, b.t), c2 = 1 - Math.pow(0.999, b.t);
      du = (-lr * (b.mu / c1)) / (Math.sqrt(b.su / c2) + 1e-8);
      dv = (-lr * (b.mv / c1)) / (Math.sqrt(b.sv / c2) + 1e-8);
    } else {
      du = -lr * gu; dv = -lr * gv;
    }
    const prevL = b.L;
    b.zig = b.zig * 0.8 + (du * b.lastDu + dv * b.lastDv < 0 ? 0.2 : 0);
    b.lastDu = du; b.lastDv = dv;
    b.pu = b.u; b.pv = b.v;
    b.u += du; b.v += dv;
    b.stepLen = Math.hypot(du, dv);
    this.events.push({ type: 'step', b, u: b.pu, v: b.pv });

    if (!Number.isFinite(b.u) || !Number.isFinite(b.v) || Math.abs(b.u) > EXTENT - 0.4 || Math.abs(b.v) > EXTENT - 0.4) {
      b.u = Math.max(-EXTENT + 0.4, Math.min(EXTENT - 0.4, b.u || 0));
      b.v = Math.max(-EXTENT + 0.4, Math.min(EXTENT - 0.4, b.v || 0));
      b.state = ST.FLY;
      b.flyT = 0;
      b.outcome = 'diverged';
      this.events.push({ type: 'diverge', b });
      return;
    }

    lossGrad(b.u, b.v, o);
    b.L = o[0]; b.gu = o[1]; b.gv = o[2]; b.g = Math.hypot(o[1], o[2]);
    b.rising = b.rising * 0.7 + (b.L > prevL + 1e-6 ? 0.3 : 0);
    if (b.histN < HIST) b.hist[b.histN++] = b.L;

    // Settling checks.
    let rest = false;
    if (b.noise > 0) {
      if (b.t % 40 === 0) {
        if (b.t > 60 && Math.hypot(b.u - b.au, b.v - b.av) < 0.12) rest = true;
        b.au = b.u; b.av = b.v;
      }
    } else {
      b.calm = b.g < 0.006 && b.stepLen < 0.0012 ? b.calm + 1 : 0;
      if (b.calm >= 4) rest = true;
    }
    if (b.t >= b.maxSteps) rest = true;
    if (rest) {
      b.state = ST.REST;
      b.restT = 0;
      b.pu = b.u; b.pv = b.v;
      const atGlobal = Math.hypot(b.u - GLOBAL_MIN.u, b.v - GLOBAL_MIN.v) < 0.18;
      b.outcome = atGlobal ? 'global' : b.g < 0.05 || b.noise > 0 ? 'local' : 'timeout';
      this.events.push({ type: 'rest', b });
    }
  }

  /** Advance every ball by dt seconds. `lrNow` feeds balls that follow the live slider. */
  update(dt, lrNow, paused = false) {
    for (const b of this.balls) {
      switch (b.state) {
        case ST.OFF:
          break;
        case ST.WAIT:
          b.delay -= dt;
          if (b.delay <= 0) b.state = ST.FALL;
          break;
        case ST.FALL:
          b.fallT += dt;
          if (b.fallT >= b.fallDur) {
            b.state = ST.RUN;
            b.timer = 0;
            this.events.push({ type: 'land', b });
          }
          break;
        case ST.RUN: {
          if (paused) break;
          b.timer += dt;
          let n = 0;
          while (b.timer >= b.interval && b.state === ST.RUN && n < 3) {
            b.timer -= b.interval;
            this.step(b, lrNow);
            n++;
          }
          if (b.timer > b.interval) b.timer = b.interval;
          break;
        }
        case ST.REST:
          b.restT += dt;
          break;
        case ST.FLY:
          b.flyT += dt;
          if (b.flyT > 2.2) b.state = ST.OFF;
          break;
        case ST.FADE:
          b.fadeT += dt;
          if (b.fadeT > 0.5) b.state = ST.OFF;
          break;
        default:
      }
    }
  }
}

export { loss };
