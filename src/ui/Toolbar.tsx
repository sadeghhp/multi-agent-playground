import { useRef } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { exportToJson, importFromJson } from '../persistence/serialization';
import { startRun, stopRun, pauseRun, resumeRun } from '../orchestrator/orchestrator';
import { hasBlockingErrors, validateForRun } from '../orchestrator/validate';
import styles from './Toolbar.module.css';

const SAVE_LABEL: Record<string, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  failed: 'Save failed',
};

export function Toolbar() {
  const playground = useDomainStore((s) => s.playground);
  const saveStatus = useDomainStore((s) => s.saveStatus);
  const renamePlayground = useDomainStore((s) => s.renamePlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const replacePlayground = useDomainStore((s) => s.replacePlayground);
  const flushSave = useDomainStore((s) => s.flushSave);
  const providers = useProviderStore((s) => s.providers);
  const mergeProviders = useProviderStore((s) => s.mergeProviders);

  const setPanel = useUiStore((s) => s.setPanel);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const theme = useUiStore((s) => s.theme);
  const showToast = useUiStore((s) => s.showToast);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  const status = useRuntimeStore((s) => s.status);
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  // A paused run is still "active" — one run at a time, and edits stay locked.
  const isActive = isRunning || isPaused;
  const clearTranscript = useDomainStore((s) => s.clearTranscript);

  const fileInput = useRef<HTMLInputElement>(null);

  // Rerun from beginning (spec §14): clear the transcript and start again with the
  // saved conversation settings, without reopening the setup dialog.
  function handleRerun() {
    if (!playground) return;
    if (hasBlockingErrors(validateForRun(playground, providers))) {
      showToast('warn', 'Fix configuration issues before running. Opening run setup.');
      setPanel('run');
      return;
    }
    clearTranscript();
    void startRun();
  }

  async function handleClearChat() {
    const ok = await requestConfirm({
      title: 'Clear chat',
      message: 'Remove the entire conversation transcript? This cannot be undone.',
      confirmLabel: 'Clear chat',
      danger: true,
    });
    if (ok) clearTranscript();
  }

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
    // Merge the file's providers into the global registry (deduped by id) so the
    // imported agents' providerId references resolve.
    if (result.providers?.length) mergeProviders(result.providers);
    replacePlayground(result.playground);
    if (result.warnings.length) {
      showToast('warn', result.warnings[0]);
    } else {
      showToast('info', 'Imported playground as a new copy.');
    }
  }

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <strong className={styles.brand}>Multi-Agent Playground</strong>
        <input
          className={styles.nameInput}
          aria-label="Playground name"
          value={playground?.name ?? ''}
          onChange={(e) => renamePlayground(e.target.value)}
          disabled={!playground || isActive}
        />
        <span className={`${styles.save} ${styles[`save_${saveStatus}`] ?? ''}`}>
          {SAVE_LABEL[saveStatus]}
        </span>
        {saveStatus === 'failed' && (
          <button
            type="button"
            className="danger"
            onClick={() => void flushSave()}
            title="Retry saving the playground"
          >
            Retry
          </button>
        )}
      </div>

      <div className={styles.right}>
        <div className={styles.group} role="group" aria-label="Playground file actions">
          <button type="button" className="secondary" onClick={() => newPlayground('Untitled Playground')} disabled={isActive}>
            New
          </button>
          <button type="button" className="secondary" onClick={() => setPanel('playgrounds')}>Open</button>
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()} disabled={isActive}>
            Import
          </button>
          <button type="button" className="secondary" onClick={handleExport} disabled={!playground}>
            Export
          </button>
        </div>
        <span className={styles.sep} />
        <div className={styles.group} role="group" aria-label="Manage">
          <button type="button" className="secondary" onClick={() => setPanel('providers')}>Providers</button>
          <button type="button" className="secondary" onClick={() => setPanel('usage')}>Usage</button>
          <button type="button" className="secondary" onClick={() => setPanel('skills')} disabled={!playground}>Skills</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setPanel('runHistory')}
            disabled={!playground}
            title="View versioned conversation run history"
          >
            Runs
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setPanel('timeline')}
            disabled={!playground}
            title="View the conversation as a timeline"
          >
            Timeline
          </button>
          <button type="button" className="secondary" onClick={() => setPanel('settings')}>
            Settings
          </button>
          <button type="button" className="danger" onClick={handleClearChat} disabled={isActive}>
            Clear chat
          </button>
        </div>
        <span className={styles.sep} />
        {isActive ? (
          <>
            {isRunning && (
              <button
                type="button"
                className="secondary"
                onClick={() => pauseRun()}
                title="Pause after the current turn finishes"
              >
                Pause
              </button>
            )}
            {isPaused && (
              <button type="button" className="primary" onClick={() => resumeRun()}>
                Resume
              </button>
            )}
            <button type="button" className="danger" onClick={() => stopRun()}>
              Stop
            </button>
          </>
        ) : (
          <>
            {(playground?.transcript.length ?? 0) > 0 && (
              <button type="button" className="secondary" onClick={handleRerun} title="Clear transcript and run again">
                Rerun
              </button>
            )}
            <button type="button" className="primary" onClick={() => setPanel('run')} disabled={!playground}>
              Run…
            </button>
          </>
        )}
        <button type="button" className="icon ghost" aria-label="Toggle theme" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

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
    </header>
  );
}
