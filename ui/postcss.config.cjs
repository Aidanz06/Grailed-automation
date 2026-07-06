const path = require('path');

// Explicit tailwind config path — vite runs from the repo root, so the plugin's
// default CWD lookup wouldn't find ui/tailwind.config.cjs.
module.exports = {
  plugins: [
    require('tailwindcss')(path.join(__dirname, 'tailwind.config.cjs')),
    require('autoprefixer'),
  ],
};
