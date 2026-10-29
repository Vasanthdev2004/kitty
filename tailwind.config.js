/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        s1: 'var(--s1)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--text)',
        'ink-2': 'var(--text-2)',
        'ink-3': 'var(--text-3)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-text': 'var(--accent-text)',
        ok: 'var(--ok)',
        'ok-soft': 'var(--ok-soft)',
        'ok-text': 'var(--ok-text)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        'warn-text': 'var(--warn-text)',
        err: 'var(--err)',
        'err-soft': 'var(--err-soft)',
        'err-text': 'var(--err-text)',
      },
      borderRadius: {
        card: '20px',
        tile: '14px',
        field: '12px',
      },
    },
  },
  plugins: [],
}
