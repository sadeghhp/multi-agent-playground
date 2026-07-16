import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { exportToJson, importFromJson } from '../persistence/serialization';
import { startRun, stopRun, pauseRun, resumeRun } from '../orchestrator/orchestrator';
import { hasBlockingErrors, validateForRun } from '../orchestrator/validate';
import styles from './Toolbar.module.css';

export function Toolbar() {
  const { t } = useTranslation();
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
      showToast('warn', t('toolbar.fixConfigBeforeRun'));
      setPanel('run');
      return;
    }
    clearTranscript();
    void startRun();
  }

  async function handleClearChat() {
    const ok = await requestConfirm({
      title: t('toolbar.clearChat'),
      message: t('toolbar.clearChatConfirm'),
      confirmLabel: t('toolbar.clearChat'),
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
    showToast('info', t('toolbar.exported'));
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const result = importFromJson(text, true);
    if (!result.ok || !result.playground) {
      showToast('error', result.error ?? t('toolbar.importFailed'));
      return;
    }
    // Merge the file's providers into the global registry (deduped by id) so the
    // imported agents' providerId references resolve.
    if (result.providers?.length) mergeProviders(result.providers);
    replacePlayground(result.playground);
    if (result.warnings.length) {
      showToast('warn', result.warnings[0]);
    } else {
      showToast('info', t('toolbar.imported'));
    }
  }

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <strong className={styles.brand}>Multi-Agent Playground</strong>
        <input
          className={styles.nameInput}
          aria-label={t('toolbar.playgroundName')}
          value={playground?.name ?? ''}
          onChange={(e) => renamePlayground(e.target.value)}
          disabled={!playground || isActive}
          dir="auto"
        />
        <span className={`${styles.save} ${styles[`save_${saveStatus}`] ?? ''}`}>
          {t(`toolbar.saveStatus.${saveStatus}`)}
        </span>
        {saveStatus === 'failed' && (
          <button
            type="button"
            className="danger"
            onClick={() => void flushSave()}
            title={t('toolbar.retryTitle')}
          >
            {t('toolbar.retry')}
          </button>
        )}
      </div>

      <div className={styles.right}>
        <div className={styles.group} role="group" aria-label={t('toolbar.fileActions')}>
          <button type="button" className="secondary" onClick={() => newPlayground('Untitled Playground')} disabled={isActive}>
            {t('toolbar.new')}
          </button>
          <button type="button" className="secondary" onClick={() => setPanel('playgrounds')}>{t('toolbar.open')}</button>
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()} disabled={isActive}>
            {t('toolbar.import')}
          </button>
          <button type="button" className="secondary" onClick={handleExport} disabled={!playground}>
            {t('toolbar.export')}
          </button>
        </div>
        <span className={styles.sep} />
        <div className={styles.group} role="group" aria-label={t('toolbar.manage')}>
          <button type="button" className="secondary" onClick={() => setPanel('providers')}>{t('toolbar.providers')}</button>
          <button type="button" className="secondary" onClick={() => setPanel('usage')}>{t('toolbar.usage')}</button>
          <button type="button" className="secondary" onClick={() => setPanel('skills')} disabled={!playground}>{t('toolbar.skills')}</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setPanel('runHistory')}
            disabled={!playground}
            title={t('toolbar.runsTitle')}
          >
            {t('toolbar.runs')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setPanel('timeline')}
            disabled={!playground}
            title={t('toolbar.timelineTitle')}
          >
            {t('toolbar.timeline')}
          </button>
          <button type="button" className="secondary" onClick={() => setPanel('settings')}>
            {t('toolbar.settings')}
          </button>
          <button type="button" className="danger" onClick={handleClearChat} disabled={isActive}>
            {t('toolbar.clearChat')}
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
                title={t('toolbar.pauseTitle')}
              >
                {t('toolbar.pause')}
              </button>
            )}
            {isPaused && (
              <button type="button" className="primary" onClick={() => resumeRun()}>
                {t('toolbar.resume')}
              </button>
            )}
            <button type="button" className="danger" onClick={() => stopRun()}>
              {t('toolbar.stop')}
            </button>
          </>
        ) : (
          <>
            {(playground?.transcript.length ?? 0) > 0 && (
              <button type="button" className="secondary" onClick={handleRerun} title={t('toolbar.rerunTitle')}>
                {t('toolbar.rerun')}
              </button>
            )}
            <button type="button" className="primary" onClick={() => setPanel('run')} disabled={!playground}>
              {t('toolbar.run')}
            </button>
          </>
        )}
        <button type="button" className="icon ghost" aria-label={t('toolbar.toggleTheme')} onClick={toggleTheme} title={t('toolbar.toggleTheme')}>
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
