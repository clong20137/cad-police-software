/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef4fb',
          500: '#1a365d',
          600: '#132a49',
          700: '#0f213a'
        },
        accent: '#9C865C',
        danger: '#dc2626',
        success: '#16a34a',
        cad: {
          ink: '#1f2937',
          panel: '#f9fafb',
          line: '#e5e7eb',
          blue: '#1a365d',
          navy: '#1a365d',
          signal: '#9C865C',
          alert: '#dc2626'
        }
      },
      boxShadow: {
        control: '0 1px 2px rgba(15, 23, 42, 0.08)'
      }
    }
  },
  plugins: []
};
