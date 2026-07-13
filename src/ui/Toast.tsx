import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import styles from './Toast.module.css';

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className={`${styles.toast} ${styles[toast.kind]}`} role="status">
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={dismiss} className={styles.close}>
        ✕
      </button>
    </div>
  );
}
