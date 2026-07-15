import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { agentColor } from '../../graph/colors';
import { createAgent } from '../../domain/factories';
import { Modal } from '../Modal';
import { AgentInspector } from '../inspector/AgentInspector';
import { ConnectionInspector } from '../inspector/ConnectionInspector';
import { PlusIcon, ChevronRightIcon } from './icons';
import styles from './MobileApp.module.css';

/** Touch list of the playground's agents; tapping one opens a full-screen editor sheet. */
export function MobileAgents() {
  const playground = useDomainStore((s) => s.playground);
  const addAgent = useDomainStore((s) => s.addAgent);
  const providers = useProviderStore((s) => s.providers);
  const selection = useUiStore((s) => s.selection);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setPanel = useUiStore((s) => s.setPanel);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  const agents = playground?.agents ?? [];
  const connections = playground?.connections ?? [];
  const hasEnabledProvider = providers.length > 0;

  const selectedAgent =
    selection.kind === 'agent' ? agents.find((a) => a.id === selection.id) : undefined;
  const selectedConnection =
    selection.kind === 'connection' ? connections.find((c) => c.id === selection.id) : undefined;

  function providerLabel(providerId: string | null, model: string | null): string {
    const p = providerId ? providers.find((pr) => pr.id === providerId) : undefined;
    const m = model || '—';
    return p ? `${p.displayName} · ${m}` : `no provider · ${m}`;
  }

  function handleAdd() {
    if (isRunning) return;
    const agent = createAgent({ name: 'New Agent', position: { x: 40, y: 40 } });
    addAgent(agent);
    selectAgent(agent.id);
  }

  return (
    <div className={styles.agents}>
      <div className={styles.agentsHeader}>
        <button type="button" className={`${styles.addBtn} primary`} onClick={handleAdd} disabled={isRunning}>
          <PlusIcon className={styles.btnIcon} /> Add agent
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setPanel('createAgentAi')}
          disabled={isRunning || !hasEnabledProvider}
          title={hasEnabledProvider ? 'Generate an agent with AI' : 'Add a provider first'}
        >
          ✨ AI
        </button>
      </div>

      {agents.length === 0 ? (
        <div className={styles.chatEmpty}>
          <p className={styles.chatEmptyTitle}>No agents yet</p>
          <p className={styles.chatEmptyText}>Add your first agent to start building a conversation.</p>
        </div>
      ) : (
        <ul className={styles.agentList}>
          {agents.map((a) => {
            const outgoing = connections.filter((c) => c.source === a.id).length;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={styles.agentCard}
                  style={{ ['--agent-color' as string]: agentColor(a.colorCategory) }}
                  onClick={() => selectAgent(a.id)}
                >
                  <span className={styles.agentDot} aria-hidden="true" />
                  <span className={styles.agentMain}>
                    <span className={styles.agentName}>{a.name || 'Unnamed agent'}</span>
                    <span className={styles.agentSub}>
                      {a.role ? `${a.role} · ` : ''}{providerLabel(a.llm.providerId, a.llm.model)}
                    </span>
                    <span className={styles.agentMeta}>
                      {outgoing} connection{outgoing === 1 ? '' : 's'}
                      {!a.runtime.enabled && ' · disabled'}
                    </span>
                  </span>
                  <ChevronRightIcon className={styles.agentChevron} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.desktopHint}>
        Tip: arranging the graph and wiring agents visually is available on a larger screen.
      </p>

      {selectedAgent && (
        <Modal title={selectedAgent.name || 'Agent'} onClose={clearSelection}>
          <AgentInspector key={selectedAgent.id} agent={selectedAgent} />
        </Modal>
      )}
      {selectedConnection && (
        <Modal title="Connection" onClose={clearSelection}>
          <ConnectionInspector key={selectedConnection.id} connection={selectedConnection} />
        </Modal>
      )}
    </div>
  );
}
