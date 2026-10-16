/* Chapter copy. ≤ 3 short sentences per step; the only serif phrase is in the title block. */
export const STEPS = [
  {
    key: 'inputs',
    label: 'Inputs',
    title: 'Signals arrive.',
    body: 'A neuron starts with numbers. Each glass dendrite carries one input, x, and its brightness is the value, from 0 to 1. Drag an orb up or down to change what the neuron sees.',
  },
  {
    key: 'weights',
    label: 'Weights',
    title: 'How much each input matters.',
    body: 'Every input is multiplied by a weight w as it passes through its ring. Orange weights push toward firing, blue weights push against it, and a thicker ring matters more. Learning means finding good weights.',
  },
  {
    key: 'sum',
    label: 'Sum + bias',
    title: 'Add it all up.',
    body: 'The soma adds every weighted input to a bias b, the level it starts from before any input arrives. The result, z = w·x + b, is the height of the liquid. Above the zero line, the neuron fires.',
  },
  {
    key: 'activation',
    label: 'Activation',
    title: 'Squash it into an answer.',
    body: 'An activation function turns z into the output: step gives yes or no, sigmoid a smooth 0 to 1, tanh −1 to 1, and ReLU keeps positives and zeroes the rest. That bend is what lets stacks of neurons learn curves rather than only straight lines.',
  },
  {
    key: 'boundary',
    label: 'Decision',
    title: 'One neuron draws a line.',
    body: 'Treat the three inputs as a point in space: the neuron fires on one side of a flat boundary, where z = 0, and stays quiet on the other. With three inputs that line is a plane. Tune the weights to slice orange from ice, or press Learn and watch the perceptron rule nudge it after every mistake.',
  },
];
