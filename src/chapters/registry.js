/**
 * The forward pass. Order here is page order, HUD order and the 0–8 keyboard shortcuts.
 * `title` is the short HUD/nav name. Each chapter's component lives in src/chapters/<id>/index.js.
 */
export const CHAPTERS = [
  { id: 'input', layer: 'L0', title: 'Input' },
  { id: 'neuron', layer: 'L1', title: 'The Neuron' },
  { id: 'descent', layer: 'L2', title: 'Gradient Descent' },
  { id: 'network', layer: 'L3', title: 'Deep Networks' },
  { id: 'embeddings', layer: 'L4', title: 'Embeddings' },
  { id: 'attention', layer: 'L5', title: 'Attention' },
  { id: 'diffusion', layer: 'L6', title: 'Diffusion' },
  { id: 'reinforce', layer: 'L7', title: 'Reinforcement' },
  { id: 'output', layer: 'L8', title: 'Output' },
];

export const chapterIndex = (id) => CHAPTERS.findIndex((c) => c.id === id);
