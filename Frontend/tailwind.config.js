/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Using 'class' strategy for dark mode
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#00d4aa',
          primaryHover: '#00b894',
          primaryLight: 'rgba(0, 212, 170, 0.12)',
          gold: '#fbbf24',
          goldLight: 'rgba(251, 191, 36, 0.15)',
        },
        bgMain: 'var(--color-bg-main)',
        bgSurface: 'var(--color-bg-surface)',
        bgCard: 'var(--color-bg-card)',
        bgCardHover: 'var(--color-bg-card-hover)',
        borderGlass: 'var(--color-border-glass)',
        borderHighlight: 'var(--color-border-highlight)',
        textMain: 'var(--color-text-main)',
        textMuted: 'var(--color-text-muted)',
        inputBg: 'var(--color-input-bg)',
        overlay: 'var(--color-overlay)',
        overlayHover: 'var(--color-overlay-hover)',
        overlayActive: 'var(--color-overlay-active)',
        modalOverlay: 'var(--color-modal-overlay)',
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
