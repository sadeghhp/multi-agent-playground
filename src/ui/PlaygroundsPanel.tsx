import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { createExamplePlayground } from '../domain/example';
import { Modal } from './Modal';
import styles from './PlaygroundsPanel.module.css';

export function PlaygroundsPanel() {
  const index = useDomainStore((s) => s.index);
  const current = useDomainStore((s) => s.playground);
  const loadPlayground = useDomainStore((s) => s.loadPlayground);
  const deletePlayground = useDomainStore((s) => s.deletePlayground);
  const duplicatePlayground = useDomainStore((s) => s.duplicatePlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const replacePlayground = useDomainStore((s) => s.replacePlayground);
  const ensureProvider = useProviderStore((s) => s.ensureProvider);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  // Register the example's provider globally (reusing an equivalent one if it
  // already exists), then load the playground wired to whatever id came back.
  function loadExample() {
    const { playground, provider } = createExamplePlayground();
    const pid = ensureProvider(provider);
    const wired =
      pid === provider.id
        ? playground
        : {
            ...playground,
            agents: playground.agents.map((a) =>
              a.llm.providerId === provider.id
                ? { ...a, llm: { ...a.llm, providerId: pid } }
                : a,
            ),
          };
    replacePlayground(wired);
    setPanel('none');
  }

  return (
    <Modal title="Saved playgrounds" onClose={() => setPanel('none')} width={520}>
      <div className={styles.actions}>
        <button type="button" className="primary" onClick={() => { newPlayground('Untitled Playground'); setPanel('none'); }}>
          + New playground
        </button>
        <button type="button" onClick={loadExample}>
          Load example
        </button>
        {current && <button type="button" onClick={() => duplicatePlayground()}>Duplicate current</button>}
      </div>

      {index.length === 0 ? (
        <p className="muted">No saved playgrounds yet.</p>
      ) : (
        <ul className={styles.list}>
          {index.map((p) => (
            <li key={p.id} className={`${styles.item} ${p.id === current?.id ? styles.active : ''}`}>
              <button type="button" className={styles.open} onClick={() => { void loadPlayground(p.id); setPanel('none'); }}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.date}>{new Date(p.updatedAt).toLocaleString()}</span>
              </button>
              <button
                type="button"
                className={`${styles.deleteBtn} danger`}
                aria-label={`Delete ${p.name}`}
                onClick={async () => {
                  const ok = await requestConfirm({
                    title: 'Delete playground',
                    message: `Delete playground "${p.name}"? This cannot be undone.`,
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (ok) void deletePlayground(p.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
