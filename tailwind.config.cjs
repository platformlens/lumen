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
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
