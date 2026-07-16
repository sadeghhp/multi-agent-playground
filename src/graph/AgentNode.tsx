import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentFlowNode } from './graphAdapter';
import { useRuntimeStore } from '../store/runtimeStore';
import { agentColor } from './colors';
import styles from './AgentNode.module.css';

/**
 * Custom agent node (spec §10.1). Shows name, role, provider/model, and runtime
 * status. Status is conveyed by BOTH a text badge and color so it never depends
 * on color alone (spec §22).
 */

/** Lifecycle-kind icons. `participant` shows no chip (the default). Labels/hints
 *  are translated via the `graph.kind.*` catalog; only the glyph + wrap-up flag
 *  live here. */
const KIND_META: Record<
  'moderator' | 'summarizer' | 'finalizer',
  { icon: string; wrapUp: boolean }
> = {
  moderator: { icon: '⚖', wrapUp: false },
  summarizer: { icon: '⏹', wrapUp: true },
  finalizer: { icon: '🏁', wrapUp: true },
};

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const { t } = useTranslation();
  const status = data.runtimeState;
  // Mid-turn tool execution label ("Using Wikipedia search…"); replaces the
  // generic generating badge while a tool call is in flight.
  const toolStatus = useRuntimeStore((s) => s.toolStatus[data.agentId] ?? null);
  const classNames = [
    styles.node,
    selected ? styles.selected : '',
    !data.enabled ? styles.disabled : '',
    styles[`state_${status}`] ?? '',
    data.hasError ? styles.errored : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Identity color is driven by the single source of truth in colors.ts and
  // applied as an inline CSS variable, so the palette lives in exactly one place.
  const style = { '--agent-color': agentColor(data.colorCategory) } as CSSProperties;

  return (
    <div className={classNames} style={style} data-testid={`agent-node-${data.agentId}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.header}>
        <span
          className={styles.dot}
          aria-hidden="true"
          title={t('graph.categoryTitle', { category: data.colorCategory })}
        />
        <span className={styles.name} title={data.name} dir="auto">
          {data.name || t('graph.unnamedAgent')}
        </span>
        <span className={`${styles.badge} ${styles[`badge_${status}`] ?? ''}`}>
          {data.hasError
            ? t('graph.error')
            : status === 'generating' && toolStatus
              ? toolStatus
              : t(`graph.status.${status}`, { defaultValue: status })}
        </span>
      </div>
      {data.role && (
        <div className={styles.role} dir="auto">
          {data.role}
        </div>
      )}
      {data.kind !== 'participant' && KIND_META[data.kind] && (
        <div
          className={`${styles.kindChip} ${KIND_META[data.kind].wrapUp ? styles.kindWrapUp : ''}`}
          title={t(`graph.kind.${data.kind}.hint`)}
        >
          <span aria-hidden="true">{KIND_META[data.kind].icon}</span>{' '}
          {t(`graph.kind.${data.kind}.label`)}
          {KIND_META[data.kind].wrapUp ? t('graph.wrapUpSuffix') : ''}
        </div>
      )}
      <div className={styles.provider} title={data.providerLabel} dir="auto">
        {data.providerLabel}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
