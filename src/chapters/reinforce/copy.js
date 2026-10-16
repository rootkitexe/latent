/** Scroll steps for L07. ≤ 3 short sentences each; accurate for a curious non-expert. */
export const STEPS = [
  {
    title: 'An agent, a world, a reward',
    body:
      'The glowing orb is an agent that can only step north, east, south or west. Reaching the orange tile scores +1, an ice pit scores −1, and every step costs a hair (−0.01). That score is the only feedback it ever gets.',
  },
  {
    title: 'Trial and error',
    body:
      'At first it knows nothing, so it wanders: bumping walls, falling into pits, now and then stumbling onto the goal. After every single step it updates a table of guesses, Q(tile, move): how much reward that move tends to lead to.',
  },
  {
    title: 'Value spreads backward from the reward',
    body:
      'Each guess borrows from the best guess one step ahead, Q ← Q + α·(r + γ·max Q′ − Q), so value leaks backward from the goal, tile by tile. Each tile now splits into four triangles, one per move: orange is good, blue is bad. The arrows show the move it currently thinks is best.',
  },
  {
    title: 'Explore vs. exploit',
    body:
      'With probability ε it tries a random move; otherwise it takes the best move it knows. Explore too little and it may never find a better route; explore too much and it keeps stepping into pits it already understands. Drag ε and γ (how far ahead it cares) and watch the policy change.',
  },
  {
    title: 'From grid worlds to Go and chatbots',
    body:
      'Swap the table for a deep neural network and run millions of worlds at once, and this is how AlphaGo sharpened its game, over millions of games against itself. RLHF uses it too: a reward model trained on human preferences scores a chatbot’s answers, and the model is tuned to earn more of it.',
  },
];
