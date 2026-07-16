import { useTranslation } from 'react-i18next';
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

const TYPE_DESC_KEYS: Record<ConnectionType, string> = {
  conversation: 'inspector.connTypeDesc_conversation',
  review: 'inspector.connTypeDesc_review',
  handoff: 'inspector.connTypeDesc_handoff',
};

export function ConnectionInspector({ connection }: { connection: Connection }) {
  const { t } = useTranslation();
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
      {isRunning && <p className={styles.hint}>{t('inspector.editingLocked')}</p>}
      <div className={styles.connHeader}>
        <strong dir="auto">{source?.name ?? t('inspector.deleted')}</strong>
        <span className={styles.arrow}>→</span>
        <strong dir="auto">{target?.name ?? t('inspector.deleted')}</strong>
      </div>

      <label className={styles.enableToggle}>
        <input
          type="checkbox"
          checked={connection.enabled}
          onChange={(e) => update(connection.id, { enabled: e.target.checked })}
        />
        {t('inspector.enabled')}
      </label>

      <div className="field">
        <label htmlFor="cn-type">{t('inspector.connectionType')}</label>
        <select
          id="cn-type"
          value={connection.type}
          onChange={(e) => update(connection.id, { type: e.target.value as ConnectionType })}
        >
          <option value="conversation">{t('inspector.connTypeConversationOption')}</option>
          <option value="review">{t('inspector.connTypeReviewOption')}</option>
          <option value="handoff">{t('inspector.connTypeHandoffOption')}</option>
        </select>
        <p className={styles.hint}>{t(TYPE_DESC_KEYS[connection.type])}</p>
      </div>

      <div className="field">
        <label htmlFor="cn-label">{t('inspector.labelOptionalLabel')}</label>
        <input id="cn-label" value={connection.label ?? ''} onChange={(e) => update(connection.id, { label: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="cn-priority">{t('inspector.priorityLabel')}</label>
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
        <label htmlFor="cn-override">{t('inspector.instructionOverrideLabel')}</label>
        <textarea
          id="cn-override"
          rows={2}
          value={connection.instructionOverride ?? ''}
          onChange={(e) => update(connection.id, { instructionOverride: e.target.value })}
          placeholder={t('inspector.instructionOverridePlaceholder')}
        />
      </div>

      <button
        type="button"
        className="danger"
        onClick={async () => {
          const ok = await requestConfirm({
            title: t('inspector.deleteConnectionTitle'),
            message: t('inspector.deleteConnectionMessage', {
              source: source?.name ?? t('inspector.deleted'),
              target: target?.name ?? t('inspector.deleted'),
            }),
            confirmLabel: t('common.delete'),
            danger: true,
          });
          if (!ok) return;
          remove(connection.id);
          clearSelection();
        }}
      >
        {t('inspector.deleteConnectionButton')}
      </button>
    </fieldset>
  );
}
