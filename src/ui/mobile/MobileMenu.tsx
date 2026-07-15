import { useRef } from 'react';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { exportToJson, importFromJson } from '../../persistence/serialization';
import type { OpenPanel } from '../../store/uiStore';
import { ChevronRightIcon } from './icons';
import styles from './MobileApp.module.css';

const NAV: { panel: OpenPanel; label: string; needsPlayground?: boolean }[] = [
  { panel: 'run', label: 'Run conversation…', needsPlayground: true },
  { panel: 'playgrounds', label: 'Saved playgrounds' },
  { panel: 'library', label: 'Agent library' },
  { panel: 'skills', label: 'Skills', needsPlayground: true },
  { panel: 'providers', label: 'Providers' },
  { panel: 'runHistory', label: 'Run history', needsPlayground: true },
  { panel: 'timeline', label: 'Timeline', needsPlayground: true },
  { panel: 'usage', label: 'Usage & cost' },
  { panel: 'settings', label: 'Settings' },
];

/** The "More" tab: navigation into existing full-screen panels + app-level actions. */
export function MobileMenu() {
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
    showToast('info', 'Exported playground (API keys excluded).');
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const result = importFromJson(text, true);
    if (!result.ok || !result.playground) {
      showToast('error', result.error ?? 'Import failed.');
      return;
    }
    if (result.providers?.length) mergeProviders(result.providers);
    replacePlayground(result.playground);
    showToast(result.warnings.length ? 'warn' : 'info', result.warnings[0] ?? 'Imported playground as a new copy.');
  }

  return (
    <div className={styles.menu}>
      <ul className={styles.menuList}>
        {NAV.map(({ panel, label, needsPlayground }) => (
          <li key={panel}>
            <button
              type="button"
              className={styles.menuRow}
              onClick={() => setPanel(panel)}
              disabled={needsPlayground && !playground}
            >
              <span>{label}</span>
              <ChevronRightIcon className={styles.agentChevron} />
            </button>
          </li>
        ))}
      </ul>

      <ul className={styles.menuList}>
        <li>
          <button type="button" className={styles.menuRow} onClick={toggleTheme}>
            <span>Theme</span>
            <span className="muted">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={() => newPlayground('Untitled Playground')}>
            <span>New playground</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={() => fileInput.current?.click()}>
            <span>Import…</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.menuRow} onClick={handleExport} disabled={!playground}>
            <span>Export</span>
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
