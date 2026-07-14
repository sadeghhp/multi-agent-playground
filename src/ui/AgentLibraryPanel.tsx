import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { useAgentLibraryStore } from '../store/agentLibraryStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { instantiateFromLibrary } from '../domain/factories';
import { Modal } from './Modal';
import styles from './AgentLibraryPanel.module.css';

/**
 * The agent library ("pool"): browse saved agents, re-add one to the current
 * playground, or dispose of it. Agents are saved from the inspector.
 */
export function AgentLibraryPanel() {
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
    <Modal title="Agent library" onClose={() => setPanel('none')} width={520}>
      <p className="muted" style={{ marginTop: 0 }}>
        Reusable agents you've saved. Add one to the current playground, or dispose of it.
        Save an agent from its inspector panel.
      </p>

      {library.length === 0 ? (
        <p className="muted">No saved agents yet.</p>
      ) : (
        <ul className={styles.list}>
          {library.map((s) => (
            <li key={s.id} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.name}>{s.name || 'Untitled agent'}</span>
                <span className={styles.meta}>
                  {s.agent.role ? `${s.agent.role} · ` : ''}saved {new Date(s.savedAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => handleAdd(s.id)}
                disabled={isRunning || !playground}
                title={
                  isRunning
                    ? 'Cannot add agents while a conversation is running'
                    : !playground
                      ? 'Open or create a playground first'
                      : undefined
                }
              >
                Add to playground
              </button>
              <button
                type="button"
                className={`${styles.disposeBtn} secondary`}
                aria-label={`Dispose ${s.name}`}
                onClick={async () => {
                  const ok = await requestConfirm({
                    title: 'Dispose saved agent',
                    message: `Dispose saved agent "${s.name}"? This removes it from the library.`,
                    confirmLabel: 'Dispose',
                    danger: true,
                  });
                  if (ok) void disposeAgent(s.id);
                }}
              >
                Dispose
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
