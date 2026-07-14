import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import styles from './Toast.module.css';

const ICON: Record<string, string> = { info: 'ℹ', warn: '⚠', error: '⚠' };
// Errors linger; informational toasts clear quickly.
const DURATION: Record<string, number> = { info: 5000, warn: 7000, error: 10000 };

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const dismiss = useUiStore((s) => s.dismissToast);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!toast || paused) return;
    timer.current = setTimeout(dismiss, DURATION[toast.kind] ?? 6000);
    return () => clearTimeout(timer.current);
  }, [toast, dismiss, paused]);

  if (!toast) return null;
  // Errors interrupt (assertive); other messages are announced politely.
  const isError = toast.kind === 'error';
  return (
    <div
      className={`${styles.toast} ${styles[toast.kind]}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className={styles.icon} aria-hidden="true">{ICON[toast.kind]}</span>
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={dismiss} className={`${styles.close} icon ghost`}>
        ✕
      </button>
    </div>
  );
}
