/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#1a1d21',
          hover: '#27292d',
        },
        channel: {
          DEFAULT: '#2c2d30',
          active: '#1264a3',
        },
      },
    },
  },
  plugins: [],
};
