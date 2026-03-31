/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Helvetica Neue"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          '"Fira Code"',
          '"JetBrains Mono"',
          '"SF Mono"',
          '"Cascadia Code"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        'fluid-xs':   ['clamp(0.68rem, 0.64rem + 0.2vw, 0.75rem)',  { lineHeight: '1.5' }],
        'fluid-sm':   ['clamp(0.78rem, 0.72rem + 0.3vw, 0.9rem)',   { lineHeight: '1.55' }],
        'fluid-base': ['clamp(0.92rem, 0.84rem + 0.4vw, 1.1rem)',   { lineHeight: '1.7' }],
        'fluid-lg':   ['clamp(1.1rem, 0.96rem + 0.7vw, 1.4rem)',    { lineHeight: '1.5' }],
        'fluid-xl':   ['clamp(1.3rem, 1.05rem + 1.2vw, 1.85rem)',   { lineHeight: '1.25' }],
        'fluid-2xl':  ['clamp(1.5rem, 1.1rem + 2vw, 2.4rem)',       { lineHeight: '1.12' }],
        'fluid-3xl':  ['clamp(1.9rem, 1.3rem + 3vw, 3.2rem)',       { lineHeight: '1.06' }],
        'fluid-4xl':  ['clamp(2.4rem, 1.4rem + 5vw, 4.5rem)',       { lineHeight: '1.0' }],
        'fluid-hero': ['clamp(2.8rem, 1.6rem + 6vw, 5.5rem)',       { lineHeight: '0.95' }],
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
