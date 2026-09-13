/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dq: {
          bg: '#0c0806',
          panel: '#1a1310',
          border: '#3a2a1a',
          gold: '#e8b04a',
          fire: '#ff6a1a',
          qing: '#2fb37e',
        },
      },
    },
  },
  plugins: [],
}

