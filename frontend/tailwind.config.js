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
      colors: {
        /* Terminal Chic — cold tinted grays, NO #000 / #fff */
        canvas:        '#f6f5f3',
        'canvas-deep': '#eeecea',
        surface:       '#e8e6e3',
        'surface-alt': '#dddad6',
        ink: {
          DEFAULT:   '#1a1918',
          primary:   '#1a1918',
          secondary: '#5c5955',
          tertiary:  '#8a8680',
          faint:     '#b5b1ab',
        },
        /* Terminal green accent */
        term: {
          DEFAULT: '#3d9a5f',
          dim:     '#2d7a48',
          bright:  '#4ec97a',
          soft:    'rgba(61, 154, 95, 0.07)',
          border:  'rgba(61, 154, 95, 0.20)',
          glow:    'rgba(78, 201, 122, 0.12)',
        },
        /* Danger / error */
        danger: {
          soft:   'rgba(180, 70, 50, 0.08)',
          border: 'rgba(180, 70, 50, 0.25)',
          text:   '#9a3c2a',
        },
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        26: '6.5rem',
        30: '7.5rem',
        34: '8.5rem',
        38: '9.5rem',
        42: '10.5rem',
      },
      letterSpacing: {
        'mono-tight': '0.02em',
        'mono-normal': '0.06em',
        'mono-wide': '0.12em',
      },
      borderRadius: {
        'sharp': '3px',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
