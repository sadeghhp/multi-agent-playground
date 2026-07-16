import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { exportToJson, importFromJson } from '../../persistence/serialization';
import type { OpenPanel } from '../../store/uiStore';
import { ChevronRightIcon } from './icons';
import styles from './MobileApp.module.css';

const NAV: { panel: OpenPanel; labelKey: string; needsPlayground?: boolean }[] = [
  { panel: 'run', labelKey: 'mobile.navRun', needsPlayground: true },
  { panel: 'playgrounds', labelKey: 'mobile.navPlaygrounds' },
  { panel: 'library', labelKey: 'mobile.navLibrary' },
  { panel: 'skills', labelKey: 'mobile.navSkills', needsPlayground: true },
  { panel: 'providers', labelKey: 'mobile.navProviders' },
  { panel: 'runHistory', labelKey: 'mobile.navRunHistory', needsPlayground: true },
  { panel: 'timeline', labelKey: 'mobile.navTimeline', needsPlayground: true },
  { panel: 'usage', labelKey: 'mobile.navUsage' },
  { panel: 'settings', labelKey: 'mobile.navSettings' },
];

/** The "More" tab: navigation into existing full-screen panels + app-level actions. */
export function MobileMenu() {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const replacePlayground = useDomainStore((s) => s.replacePlayground);
  const flushSave = useDomainStore((s) => s.flushSave);
  const providers = useProviderStore((s) => s.providers);
  const mergeProviders = useProviderStore((s) => s.mergeProviders);
  const setPanel = useUiStore((s) => s.setPanel);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const showToast = useUiStore((s) => s.showToast);

  const fileInput = useRef<HTMLInputElement>(null);

  async function handleExport() {
    if (!playground) return;
    await flushSave();
    const json = exportToJson(playground, providers);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playground.name.replace(/[^\w.-]+/g, '_') || 'playground'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('info', t('mobile.exportedToast'));
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const result = importFromJson(text, true);
    if (!result.ok || !result.playground) {
      showToast('error', result.error ?? t('mobile.importFailed'));
      return;
    }
    if (result.providers?.length) mergeProviders(result.providers);
    replacePlayground(result.playground);
    showToast(result.warnings.length ? 'warn' : 'info', result.warnings[0] ?? t('mobile.importedToast'));
  }

  return (
    <div className={styles.menu}>
      <ul className={styles.menuList}>
        {NAV.map(({ panel, labelKey, needsPlayground }) => (
          <li key={panel}>
            <button
              type="button"
              className={styles.menuRow}
              onClick={() => setPanel(panel)}
              disabled={needsPlayground && !playground}
            >
              <span>{t(labelKey)}</span>
              <ChevronRightIcon className={styles.agentChevron} />
            </button>
          </li>
        ))}
      </ul>

      <ul className={styles.menuList}>
        <li>
          <button type="button" className={styles.menuRow} onClick={toggleTheme}>
            <span>{t('mobile.theme')}</span>
            <span className="muted">{theme === 'dark' ? t('mobile.themeDark') : t('mobile.themeLight')}</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={() => newPlayground('Untitled Playground')}>
            <span>{t('mobile.newPlayground')}</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={() => fileInput.current?.click()}>
            <span>{t('mobile.importAction')}</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={handleExport} disabled={!playground}>
            <span>{t('mobile.exportAction')}</span>
          </button>
        </li>
      </ul>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
