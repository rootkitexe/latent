export const STEPS = [
  {
    key: 'numbers',
    title: 'Words become numbers',
    body: 'A model can’t read letters, so every word becomes a list of numbers — 300 of them here. Nobody writes them by hand: they are learned from billions of sentences, so words used in similar ways get similar numbers. Each list is a point in space.',
  },
  {
    key: 'galaxy',
    title: 'Similar meanings live close together',
    body: 'Plot every word as a star and the numbers turn into a map. Animals drift together, cities gather near countries, numbers line up — nobody labelled them; it falls out of how words are used.',
  },
  {
    key: 'neighbours',
    title: 'Neighbours',
    body: 'Type a word to fly to it. Its nearest neighbours light up, scored by cosine similarity: 1 means pointing the same way, near 0 means unrelated. Search engines and chatbots find related ideas exactly like this.',
  },
  {
    key: 'directions',
    title: 'Directions mean things',
    body: 'Steps through the space carry meaning: the step from man to woman is roughly the step from king to queen. So king − man + woman lands nearest to queen. Try your own — the arithmetic runs on all 300 numbers.',
  },
  {
    key: 'understand',
    title: 'This is how models understand you',
    body: 'Every language model starts here: your words become points in a space of meaning, with thousands of dimensions instead of 300. Everything after — attention, prediction — is geometry on those points.',
  },
];

export const PRESETS = [
  ['king', 'man', 'woman'],
  ['paris', 'france', 'japan'],
  ['walking', 'walk', 'swim'],
  ['actor', 'man', 'woman'],
  ['sushi', 'japan', 'italy'],
  ['better', 'good', 'bad'],
  ['ran', 'run', 'swim'],
];

export const SEARCH_EXAMPLES = ['coffee', 'guitar', 'tokyo', 'happy', 'robot', 'tiger', 'storm'];

// finale: content words of little sentences, traced as paths through the galaxy
export const SENTENCES = [
  ['king', 'coffee', 'paris', 'monday', 'happy'],
  ['robot', 'guitar', 'music', 'love', 'heart'],
  ['children', 'swim', 'ocean', 'storm', 'afraid'],
];
