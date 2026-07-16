import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { agentColor } from '../graph/colors';
import { AgentInspector } from './inspector/AgentInspector';
import { ConnectionInspector } from './inspector/ConnectionInspector';
import styles from './inspector/Inspector.module.css';

export function Inspector() {
  const { t } = useTranslation();
  const selection = useUiStore((s) => s.selection);
  const playground = useDomainStore((s) => s.playground);

  const agent =
    selection.kind === 'agent' ? playground?.agents.find((a) => a.id === selection.id) : undefined;
  const connection =
    selection.kind === 'connection'
      ? playground?.connections.find((c) => c.id === selection.id)
      : undefined;

  return (
    <aside className={styles.inspector} aria-label={t('inspector.title')}>
      <header className={styles.header}>
        {agent ? (
          <h2 className={styles.title}>
            <span
              className={styles.identityDot}
              style={{ backgroundColor: agentColor(agent.colorCategory) }}
              aria-hidden="true"
            />
            <span className={styles.identityName} title={agent.name} dir="auto">
              {agent.name || t('inspector.unnamedAgent')}
            </span>
          </h2>
        ) : (
          <h2 className={styles.title}>{connection ? t('inspector.connectionTitle') : t('inspector.title')}</h2>
        )}
      </header>
      {agent ? (
        // key resets the inspector's local form state (e.g. the "Connect to…"
        // draft) when a different agent/connection is selected — otherwise the
        // draft bleeds across selections and can create the wrong connection.
        <AgentInspector key={agent.id} agent={agent} />
      ) : connection ? (
        <ConnectionInspector key={connection.id} connection={connection} />
      ) : (
        <div className={styles.emptyState}>
          <p>{t('inspector.emptyStatePrimary')}</p>
          <p className="muted">{t('inspector.emptyStateSecondary')}</p>
        </div>
      )}
    </aside>
  );
}
