import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './i18n';
import { getLanguage, directionFor } from './store/prefs';
import './ui/styles/global.css';

// Set direction/language before first paint so RTL users don't get a flash of
// left-to-right layout while React mounts. This runs as a module (CSP-safe),
// unlike an inline <script> in index.html which `script-src 'self'` blocks.
const bootLang = getLanguage();
document.documentElement.setAttribute('lang', bootLang);
document.documentElement.setAttribute('dir', directionFor(bootLang));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
