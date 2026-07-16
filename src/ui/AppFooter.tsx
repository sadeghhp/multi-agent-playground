import { useTranslation } from 'react-i18next';
import { BUILD_LABEL } from '../appVersion';
import { reloadApp } from '../reloadApp';
import styles from './AppFooter.module.css';

export function AppFooter() {
  const { t } = useTranslation();
  return (
    <footer className={styles.footer} aria-label={t('footer.appInfo')}>
      <span className={styles.version} dir="auto">{BUILD_LABEL}</span>
      <button
        type="button"
        className={`${styles.reloadBtn} icon ghost`}
        onClick={reloadApp}
        aria-label={t('footer.reload')}
        title={t('footer.reload')}
      >
        ↻
      </button>
    </footer>
  );
}
