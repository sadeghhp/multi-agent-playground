import type { Connection, ConnectionType } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import styles from './Inspector.module.css';

/**
 * Priority may legitimately be any integer, including 0 or negative — unlike
 * the fields `parseBoundedInt` (inputUtils.ts) covers, there's no positive
 * lower bound to reject a cleared field with. Ignore a cleared/non-numeric
 * field explicitly instead, rather than letting `Number('')` silently
 * coerce it to a valid-looking 0.
 */
function parsePriority(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

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
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  const source = playground.agents.find((a) => a.id === connection.source);
  const target = playground.agents.find((a) => a.id === connection.target);

  return (
    <fieldset className={styles.body} disabled={isRunning}>
      {isRunning && <p className={styles.hint}>Editing is locked while a conversation is running.</p>}
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
        />
        Enabled
      </label>

      <div className="field">
        <label htmlFor="cn-type">Connection type</label>
        <select
          id="cn-type"
          value={connection.type}
          onChange={(e) => update(connection.id, { type: e.target.value as ConnectionType })}
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
        <input
          id="cn-priority"
          type="number"
          value={connection.priority}
          onChange={(e) => {
            const n = parsePriority(e.target.value);
            if (n !== null) update(connection.id, { priority: n });
          }}
        />
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
        onClick={async () => {
          const ok = await requestConfirm({
            title: 'Delete connection',
            message: `Delete the connection ${source?.name ?? 'deleted'} → ${target?.name ?? 'deleted'}?`,
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          remove(connection.id);
          clearSelection();
        }}
      >
        Delete connection
      </button>
    </fieldset>
  );
}
