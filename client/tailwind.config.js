/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        cad: {
          ink: '#172033',
          panel: '#f8fafc',
          line: '#d8dee9',
          blue: '#1d4ed8',
          navy: '#0f172a',
          signal: '#0f766e',
          alert: '#b42318'
        }
      },
      boxShadow: {
        control: '0 1px 2px rgba(15, 23, 42, 0.08)'
      }
    }
  },
  plugins: []
};
