/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        cad: {
          ink: '#172033',
          panel: '#f8fafc',
          line: '#d8dee9',
          blue: '#1a365d',
          secondary: '#2d5a8c',
          navy: '#0f172a',
          accent: '#9C865C',
          signal: '#0f766e',
          alert: '#c0392b'
        }
      },
      boxShadow: {
        control: '0 1px 2px rgba(15, 23, 42, 0.08)',
        shield: '0 18px 45px rgba(15, 23, 42, 0.18)'
      }
    }
  },
  plugins: []
};
