export const STEPS = [
  {
    k: 'Neurons in layers',
    title: 'A network is neurons in layers.',
    body: 'Each glowing point is a neuron holding one number. Your drawing becomes the first layer — 784 pixels, one neuron each. Every hair-thin line is a weight: a learned strength linking one neuron to the next.',
  },
  {
    k: 'Forward pass',
    title: 'The forward pass.',
    body: 'Each neuron multiplies its inputs by their weights, adds them up, and passes the total on only if it is positive (ReLU). Layer by layer, your pixels become ten scores. The highest score is the guess.',
  },
  {
    k: 'Features',
    title: 'Each layer sees more abstract features.',
    body: 'A first-layer neuron fires for a pattern of strokes — orange pixels push it up, blue pixels push it down. Deeper neurons combine those patterns into parts of digits. Tap any hidden neuron to see what it looks for.',
  },
  {
    k: 'Backpropagation',
    title: 'Backpropagation.',
    body: 'To learn, the network compares its guess with the right answer and measures the error. That error flows backward, telling every weight which way to nudge. Tap the correct digit to run one real training step.',
  },
  {
    k: 'Deep = many layers',
    title: 'Deep just means many layers.',
    body: 'This network stacks three weight layers and learned from 60,000 handwritten digits. The models behind chatbots use the same recipe — layers, a forward pass, backprop — with billions of weights instead of fifty thousand.',
  },
];
