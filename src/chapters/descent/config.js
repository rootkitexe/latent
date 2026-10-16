/** Copy + tuning constants for the descent chapter. */

export const STEPS = [
  {
    title: 'How wrong',
    lead: 'Loss is how wrong you are.',
    body: "Every point on this terrain is one setting of a model's two weights, w₁ and w₂, and its height is the loss: how wrong the model's predictions are with those weights. Training means finding the lowest point. The catch: the model can't see the map, only the slope beneath it.",
  },
  {
    title: 'Downhill',
    lead: 'Follow the slope.',
    body: 'The gradient ∇L points uphill, where loss grows fastest. Gradient descent takes a step the opposite way, −∇L, then measures the slope again. Repeat a few hundred times and the ball settles into a valley.',
  },
  {
    title: 'Step size',
    lead: 'The learning rate decides how far each step goes.',
    body: 'Each step moves the weights by learning rate × gradient. Too small and the ball crawls for ages; too big and it overshoots, bouncing between the walls or flung into another valley. The orange ring marks where the next step lands.',
  },
  {
    title: 'Many valleys',
    lead: 'Where you start decides where you end.',
    body: 'Real loss landscapes have many valleys, and plain descent stops in whichever one it starts above. Stochastic gradient descent (SGD) measures the slope on a small random batch of data, so every step jitters. That noise can shake a ball out of a shallow dip, but rarely out of a deep one.',
  },
  {
    title: 'The race',
    lead: 'Same start, three update rules.',
    body: "SGD follows the slope and stops in the first dip it meets. Momentum keeps a running velocity and rolls straight through it. Adam scales each weight's step by that weight's own gradient history.",
  },
];

export const N_STEPS = STEPS.length;

/** Demo drop for steps 1–2 (east slope above the global ravine). */
export const DEMO = { u: 2.6, v: 0.4 };
/** Race start: above a shallow dimple that traps plain gradient descent. */
export const RACE = { u: 2.4, v: -2.4 };

export const LR_MIN = 0.003;
export const LR_MAX = 1.0;
export const LR_DEFAULT = 0.06;
export const lrFromSlider = (s) => LR_MIN * Math.pow(LR_MAX / LR_MIN, s / 1000);
export const sliderFromLr = (lr) => (1000 * Math.log(lr / LR_MIN)) / Math.log(LR_MAX / LR_MIN);

export const PRESETS = [
  { lr: 0.006, label: 'Crawl' },
  { lr: 0.06, label: 'Steady' },
  { lr: 0.22, label: 'Bounce' },
  { lr: 0.8, label: 'Fling' },
];

export const RACERS = [
  { name: 'SGD', opt: 1, lr: 0.05, color: '#ff4f1f', note: 'lr 0.05' },
  { name: 'Momentum', opt: 2, lr: 0.03, color: '#a8f0ff', note: 'lr 0.03 · β 0.9' },
  { name: 'Adam', opt: 3, lr: 0.05, color: '#ffffff', note: 'lr 0.05 · β 0.9/0.999' },
];

export const SGD_NOISE = 0.45;
