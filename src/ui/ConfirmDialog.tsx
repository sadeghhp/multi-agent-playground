import { useTranslation } from 'react-i18next';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import styles from './ConfirmDialog.module.css';

/**
 * Themed replacement for window.confirm. Driven by uiStore.requestConfirm(), which
 * returns a promise resolving to the user's choice. Rendered once at the app root.
 */
export function ConfirmDialog() {
  const { t } = useTranslation();
  const confirm = useUiStore((s) => s.confirm);
  const resolveConfirm = useUiStore((s) => s.resolveConfirm);
  if (!confirm) return null;

  const { title, message, confirmLabel, cancelLabel, danger } = confirm;

  return (
    <Modal title={title ?? t('confirm.defaultTitle')} onClose={() => resolveConfirm(false)} width={420}>
      <p className={styles.message} dir="auto">{message}</p>
      <div className={styles.actions}>
        <button type="button" className="secondary" onClick={() => resolveConfirm(false)}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          type="button"
          className={danger ? 'danger' : 'primary'}
          onClick={() => resolveConfirm(true)}
          autoFocus
        >
          {confirmLabel ?? t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}
