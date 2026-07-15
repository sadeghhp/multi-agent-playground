import { useEffect, useState } from 'react';

/** Viewport width below which the touch-first mobile layout replaces the desktop shell. */
export const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

/**
 * True when the viewport is phone-sized. Drives the top-level layout branch in App:
 * below the breakpoint we render a purpose-built touch UI instead of the desktop
 * three-column editor. Reacts to viewport changes (rotation, resize) live.
 *
 * Test-safe: jsdom's mocked matchMedia reports `matches: false` (see src/test/setup.ts),
 * so component tests keep exercising the desktop tree unless they opt in.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Sync once in case the viewport changed between initial state and effect.
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
