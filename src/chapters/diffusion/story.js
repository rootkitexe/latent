import { T } from './schedule';

/** Scroll story: 5 steps across the pinned range. */
export const BOUNDS = [0, 0.17, 0.38, 0.6, 0.8, 1.0001];

export const stepOf = (p) => {
  for (let i = 0; i < 5; i++) if (p < BOUNDS[i + 1]) return i;
  return 4;
};
const local = (p, i) => Math.min(1, Math.max(0, (p - BOUNDS[i]) / (BOUNDS[i + 1] - BOUNDS[i])));
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** "Lights on": the world fades from void to paper over the first ~8% of the chapter. */
export const lightOf = (p) => ss(0.005, 0.085, p);

/** Timestep driven by scroll (when no generation / hold is active). */
export function scrollT(p) {
  const s = stepOf(p);
  const l = local(p, s);
  if (s === 0) return T;
  if (s === 1) return Math.round(T * ss(0.18, 0.92, l)); // forward: x_0 → x_T
  if (s === 2) return Math.round(T * (1 - ss(0.06, 0.94, l))); // reverse: x_T → x_0
  return 0;
}

/** Camera per step: distance, height, base yaw. */
export const STEP_CAM = [
  { z: 8.6, y: 0.0, rot: 0.0 },
  { z: 7.0, y: 0.2, rot: -0.15 },
  { z: 6.4, y: 0.6, rot: 0.55 },
  { z: 7.4, y: 0.1, rot: 0.0 },
  { z: 7.8, y: 0.0, rot: -0.1 },
];

export const STEPS = [
  {
    kicker: 'Lights on',
    title: 'Start with pure static',
    body: [
      'Every picture a diffusion model makes begins like this: random Gaussian noise, with no image hidden inside.',
      'Its whole job is to turn static into structure, one small step at a time.',
      'Drag across the cloud to try it.',
    ],
  },
  {
    kicker: 'Forward process',
    title: 'Destroy an image',
    body: [
      'Training starts with real images and ruins them on purpose, adding a little Gaussian noise at each of 1,000 steps.',
      'Scroll and watch x₀ dissolve.',
      'By t = 1000 the signal is gone.',
    ],
    formula: 'xₜ = √ᾱₜ · x₀ + √(1 − ᾱₜ) · ε',
  },
  {
    kicker: 'Reverse process',
    title: 'Learn to undo one step',
    body: [
      'A neural network sees a noisy xₜ and is trained to answer one question: which noise ε was added?',
      'Its guess ε̂ (the orange strokes) points every particle back toward an image.',
      'Remove a little of it, repeat, and the static flows back into form.',
    ],
    formula: 'loss = ‖ ε − ε̂_θ(xₜ, t) ‖²',
  },
  {
    kicker: 'Guidance',
    title: 'Guided by a prompt',
    body: [
      'Give the network a text prompt and its noise guesses become conditioned on those words.',
      'The same static can resolve into very different pictures.',
      'Pick a prompt: the cloud is pushed back to pure noise, then denoised toward it.',
    ],
    formula: 'ε̂_θ(xₜ, t, “prompt”)',
  },
  {
    kicker: 'Generation',
    title: 'How image generators paint',
    body: [
      'Real image generators run this loop with billions of learned parameters, usually inside a compressed latent space.',
      'Every run starts from fresh random noise, so no two images come out the same.',
      'Press Generate.',
    ],
  },
];
