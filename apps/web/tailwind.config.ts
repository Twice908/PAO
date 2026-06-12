import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'flash-new': {
          '0%': { backgroundColor: '#eef2ff' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'flash-new': 'flash-new 1s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
