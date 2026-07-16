import '@testing-library/jest-dom/vitest';
// Initialize i18next with the real English catalogs (default lng 'en'), so any
// test asserting on English UI text keeps passing after strings move to keys.
// NOT `cimode` — that returns raw keys and would break every text assertion.
import '../i18n';

// jsdom lacks these APIs that some components touch. Provide minimal stubs.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserver;
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
