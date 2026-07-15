import { type ReactNode, useEffect, useId, useRef } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Accessible modal dialog: Escape closes, focus is trapped, backdrop click closes. */
export function Modal({ title, onClose, children, footer, width = 560 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  // Only treat a backdrop click as "close" when both press and release land on it,
  // so a drag that starts inside the dialog and releases outside doesn't dismiss it.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    // Remember what was focused so we can restore it on close (spec §22).
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const onKey = (e: KeyboardEvent) => {
      // With nested dialogs (e.g. a confirm opened from inside another modal),
      // every Modal has a window keydown listener. Only the top-most one should
      // react, otherwise Escape closes both and the lower trap steals focus.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== ref.current) return;

      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Focus trap: keep Tab within the dialog, and pull stray focus back in.
      if (e.key === 'Tab') {
        const items = focusable();
        if (items.length === 0) {
          e.preventDefault();
          ref.current?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = ref.current?.contains(active as Node);
        if (!inside) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first control, falling back to the dialog container — but don't
    // steal focus back from a child that declared React `autoFocus` (which React
    // applies during commit, before this passive effect runs).
    const active = document.activeElement;
    if (!(ref.current?.contains(active) && active !== ref.current)) {
      (focusable()[0] ?? ref.current)?.focus();
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={styles.modal}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" aria-label="Close" className={`${styles.close} icon ghost`} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className={styles.content}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );
}
