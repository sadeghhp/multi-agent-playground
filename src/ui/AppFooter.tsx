import { BUILD_LABEL } from '../appVersion';
import { reloadApp } from '../reloadApp';
import styles from './AppFooter.module.css';

export function AppFooter() {
  return (
    <footer className={styles.footer} aria-label="Application info">
      <span className={styles.version}>{BUILD_LABEL}</span>
      <button
        type="button"
        className={`${styles.reloadBtn} icon ghost`}
        onClick={reloadApp}
        aria-label="Reload to get the latest version"
        title="Reload to get the latest version"
      >
        ↻
      </button>
    </footer>
  );
}
