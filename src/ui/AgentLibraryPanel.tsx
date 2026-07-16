import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { useAgentLibraryStore } from '../store/agentLibraryStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { instantiateFromLibrary } from '../domain/factories';
import { formatDateTime } from '../i18n/format';
import { Modal } from './Modal';
import styles from './AgentLibraryPanel.module.css';

/**
 * The agent library ("pool"): browse saved agents, re-add one to the current
 * playground, or dispose of it. Agents are saved from the inspector.
 */
export function AgentLibraryPanel() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const library = useAgentLibraryStore((s) => s.library);
  const disposeAgent = useAgentLibraryStore((s) => s.disposeAgent);
  const playground = useDomainStore((s) => s.playground);
  const addAgent = useDomainStore((s) => s.addAgent);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  // Stagger re-added nodes so they don't stack, matching the Palette behaviour.
  function nextPosition() {
    const n = playground?.agents.length ?? 0;
    return { x: 80 + (n % 4) * 60, y: 80 + Math.floor(n / 4) * 60 + (n % 4) * 30 };
  }

  function handleAdd(id: string) {
    const saved = library.find((s) => s.id === id);
    if (!saved || !playground) return;
    const agent = instantiateFromLibrary(saved, nextPosition());
    addAgent(agent);
    selectAgent(agent.id);
    setPanel('none');
  }

  return (
    <Modal title={t('library.title')} onClose={() => setPanel('none')} width={520}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('library.intro')}
      </p>

      {library.length === 0 ? (
        <p className="muted">{t('library.noSaved')}</p>
      ) : (
        <ul className={styles.list}>
          {library.map((s) => (
            <li key={s.id} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.name} dir="auto">{s.name || t('library.untitledAgent')}</span>
                <span className={styles.meta}>
                  {s.agent.role ? <span dir="auto">{s.agent.role} · </span> : null}
                  {t('library.savedAt', { when: formatDateTime(s.savedAt, language) })}
                </span>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => handleAdd(s.id)}
                disabled={isRunning || !playground}
                title={
                  isRunning
                    ? t('library.cannotAddRunning')
                    : !playground
                      ? t('library.openPlaygroundFirst')
                      : undefined
                }
              >
                {t('library.addToPlayground')}
              </button>
              <button
                type="button"
                className={`${styles.disposeBtn} secondary`}
                aria-label={t('library.disposeAria', { name: s.name })}
                onClick={async () => {
                  const ok = await requestConfirm({
                    title: t('library.disposeTitle'),
                    message: t('library.disposeMessage', { name: s.name }),
                    confirmLabel: t('library.dispose'),
                    danger: true,
                  });
                  if (ok) void disposeAgent(s.id);
                }}
              >
                {t('library.dispose')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
