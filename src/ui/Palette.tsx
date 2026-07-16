import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { createAgent, createAgentFromTemplate, templateList, type TemplateKey } from '../domain/factories';
import styles from './Palette.module.css';

export function Palette() {
  const playground = useDomainStore((s) => s.playground);
  const addAgent = useDomainStore((s) => s.addAgent);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const setPanel = useUiStore((s) => s.setPanel);
  const isRunning = useRuntimeStore((s) => s.status === 'running');
  const hasEnabledProvider = useProviderStore((s) => s.providers.some((p) => p.enabled));
  const enabledAgentCount = playground?.agents.filter((a) => a.runtime.enabled).length ?? 0;

  // Stagger new nodes so they don't stack exactly on top of each other.
  function nextPosition() {
    const n = playground?.agents.length ?? 0;
    return { x: 80 + (n % 4) * 60, y: 80 + Math.floor(n / 4) * 60 + (n % 4) * 30 };
  }

  function handleAddBlank() {
    const agent = createAgent({ name: 'New Agent', position: nextPosition() });
    addAgent(agent);
    selectAgent(agent.id);
  }

  function handleAddTemplate(key: TemplateKey) {
    const agent = createAgentFromTemplate(key, { position: nextPosition() });
    addAgent(agent);
    selectAgent(agent.id);
  }

  return (
    <aside className={styles.palette} aria-label="Component palette">
      <section className={styles.section}>
        <h3 className={styles.heading}>Agents</h3>
        <button type="button" className={`primary ${styles.block}`} onClick={handleAddBlank} disabled={isRunning}>
          + Add agent
        </button>
        <button
          type="button"
          className={styles.block}
          onClick={() => setPanel('createAgentAi')}
          disabled={isRunning || !hasEnabledProvider}
          title={!hasEnabledProvider ? 'Add an enabled provider first' : undefined}
        >
          ✨ Create agent with AI
        </button>
        <button
          type="button"
          className={styles.block}
          onClick={() => setPanel('smartArrange')}
          disabled={isRunning || !hasEnabledProvider || enabledAgentCount < 2}
          title={
            !hasEnabledProvider
              ? 'Add an enabled provider first'
              : enabledAgentCount < 2
                ? 'Add at least 2 enabled agents first'
                : 'AI connects your agents into a conversation flow for a subject'
          }
        >
          ✨ Smart Arrange
        </button>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Templates</h3>
        <div className={styles.templates}>
          {templateList()
            .filter((t) => t.key !== 'blank')
            .map((t) => (
              <button
                key={t.key}
                type="button"
                className={styles.template}
                onClick={() => handleAddTemplate(t.key)}
                disabled={isRunning}
              >
                {t.label}
              </button>
            ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Manage</h3>
        <button type="button" className={styles.block} onClick={() => setPanel('providers')}>
          Provider manager
        </button>
        <button type="button" className={styles.block} onClick={() => setPanel('playgrounds')}>
          Saved playgrounds
        </button>
        <button type="button" className={styles.block} onClick={() => setPanel('library')}>
          Agent library
        </button>
      </section>

      <div className={styles.spacer} />
      <p className={styles.warn}>
        Provider credentials are stored and used in this browser. Do not use unrestricted
        production keys.
      </p>
    </aside>
  );
}
