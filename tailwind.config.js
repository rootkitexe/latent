/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: 'var(--void)',
        graphite: 'var(--graphite)',
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        signal: 'var(--signal)',
        'signal-hot': 'var(--signal-hot)',
        ice: 'var(--ice)',
        frost: 'var(--frost)',
        fg: 'rgb(var(--fg-rgb) / 1)',
        'fg-68': 'rgb(var(--fg-rgb) / 0.68)',
        'fg-42': 'rgb(var(--fg-rgb) / 0.42)',
        'fg-22': 'rgb(var(--fg-rgb) / 0.22)',
        hairline: 'var(--hairline)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        sans: ['var(--font-sans)', 'sans-serif'],
        serif: ['var(--font-serif)', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      transitionTimingFunction: { expo: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};
