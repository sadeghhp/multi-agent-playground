import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { AgentInspector } from './inspector/AgentInspector';
import { ConnectionInspector } from './inspector/ConnectionInspector';
import styles from './inspector/Inspector.module.css';

export function Inspector() {
  const selection = useUiStore((s) => s.selection);
  const playground = useDomainStore((s) => s.playground);

  const agent =
    selection.kind === 'agent' ? playground?.agents.find((a) => a.id === selection.id) : undefined;
  const connection =
    selection.kind === 'connection'
      ? playground?.connections.find((c) => c.id === selection.id)
      : undefined;

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <header className={styles.header}>
        <h2 className={styles.title}>
          {agent ? 'Agent' : connection ? 'Connection' : 'Inspector'}
        </h2>
      </header>
      {agent ? (
        <AgentInspector agent={agent} />
      ) : connection ? (
        <ConnectionInspector connection={connection} />
      ) : (
        <div className={styles.emptyState}>
          <p>Select an agent or connection to edit it.</p>
          <p className="muted">Add an agent from the left palette to get started.</p>
        </div>
      )}
    </aside>
  );
}
