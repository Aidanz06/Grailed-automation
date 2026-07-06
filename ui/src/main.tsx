import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (studio-blend theme): Space Grotesk = UI, JetBrains Mono =
// data (prices, counts, statuses), Instrument Serif = display voice (wordmark,
// big price). Bundled by Vite — no network fetch at runtime.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
