/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--lumen-font-family)'],
      },
      // Semantic colors for shadcn-style utilities (Streamdown, UI). Without these,
      // `border-border` + `border` falls back to currentColor → bright white on dark UI.
      colors: {
        border: 'rgba(255, 255, 255, 0.07)',
        input: 'rgba(255, 255, 255, 0.1)',
        ring: 'rgba(96, 165, 250, 0.45)',
        background: 'rgba(9, 9, 11, 0.72)',
        foreground: 'rgba(255, 255, 255, 0.92)',
        primary: {
          DEFAULT: '#3b82f6',
          foreground: '#fafafa',
        },
        secondary: {
          DEFAULT: 'rgba(255, 255, 255, 0.07)',
          foreground: 'rgba(255, 255, 255, 0.9)',
        },
        muted: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          foreground: 'rgba(255, 255, 255, 0.55)',
        },
        accent: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          foreground: 'rgba(255, 255, 255, 0.95)',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#fafafa',
        },
        sidebar: {
          DEFAULT: 'rgba(12, 12, 15, 0.65)',
          foreground: 'rgba(255, 255, 255, 0.82)',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
