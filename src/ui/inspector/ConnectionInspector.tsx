import type { Connection, ConnectionType } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import styles from './Inspector.module.css';

const TYPE_DESCRIPTIONS: Record<ConnectionType, string> = {
  conversation: 'The target may respond after the source.',
  review: "The target reviews the source's most recent answer.",
  handoff: "The target receives the source output as its primary task context.",
};

export function ConnectionInspector({ connection }: { connection: Connection }) {
  const playground = useDomainStore((s) => s.playground)!;
  const update = useDomainStore((s) => s.updateConnection);
  const remove = useDomainStore((s) => s.removeConnection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  const source = playground.agents.find((a) => a.id === connection.source);
  const target = playground.agents.find((a) => a.id === connection.target);

  return (
    <div className={styles.body}>
      <div className={styles.connHeader}>
        <strong>{source?.name ?? 'deleted'}</strong>
        <span className={styles.arrow}>→</span>
        <strong>{target?.name ?? 'deleted'}</strong>
      </div>

      <label className={styles.enableToggle}>
        <input
          type="checkbox"
          checked={connection.enabled}
          onChange={(e) => update(connection.id, { enabled: e.target.checked })}
          disabled={isRunning}
        />
        Enabled
      </label>

      <div className="field">
        <label htmlFor="cn-type">Connection type</label>
        <select
          id="cn-type"
          value={connection.type}
          onChange={(e) => update(connection.id, { type: e.target.value as ConnectionType })}
          disabled={isRunning}
        >
          <option value="conversation">Conversation flow</option>
          <option value="review">Review flow</option>
          <option value="handoff">Handoff flow</option>
        </select>
        <p className={styles.hint}>{TYPE_DESCRIPTIONS[connection.type]}</p>
      </div>

      <div className="field">
        <label htmlFor="cn-label">Label (optional)</label>
        <input id="cn-label" value={connection.label ?? ''} onChange={(e) => update(connection.id, { label: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="cn-priority">Priority (higher runs first)</label>
        <input id="cn-priority" type="number" value={connection.priority} onChange={(e) => update(connection.id, { priority: Number(e.target.value) })} />
      </div>

      <div className="field">
        <label htmlFor="cn-override">Instruction override (optional)</label>
        <textarea
          id="cn-override"
          rows={2}
          value={connection.instructionOverride ?? ''}
          onChange={(e) => update(connection.id, { instructionOverride: e.target.value })}
          placeholder="Focus only on factual weaknesses in the previous response."
        />
      </div>

      <button
        type="button"
        className="danger"
        disabled={isRunning}
        onClick={() => {
          remove(connection.id);
          clearSelection();
        }}
      >
        Delete connection
      </button>
    </div>
  );
}
