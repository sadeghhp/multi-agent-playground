import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { AgentFlowNode } from './graphAdapter';
import { agentColor } from './colors';
import styles from './AgentNode.module.css';

/**
 * Custom agent node (spec §10.1). Shows name, role, provider/model, and runtime
 * status. Status is conveyed by BOTH a text badge and color so it never depends
 * on color alone (spec §22).
 */

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  queued: 'Queued',
  generating: 'Generating…',
  completed: 'Done',
  failed: 'Failed',
  disabled: 'Disabled',
};

/** Visual treatment per lifecycle kind. `participant` shows no chip (the default). */
const KIND_META: Record<
  'moderator' | 'summarizer' | 'finalizer',
  { icon: string; label: string; wrapUp: boolean; hint: string }
> = {
  moderator: {
    icon: '⚖',
    label: 'Moderator',
    wrapUp: false,
    hint: 'Facilitates the discussion; scheduled by edges but always sees the full transcript.',
  },
  summarizer: {
    icon: '⏹',
    label: 'Summarizer',
    wrapUp: true,
    hint: 'Runs automatically in the wrap-up phase, after the discussion ends.',
  },
  finalizer: {
    icon: '🏁',
    label: 'Finalizer',
    wrapUp: true,
    hint: 'Runs last, in the wrap-up phase — after every other agent.',
  },
};

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const status = data.runtimeState;
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
          title={`Category: ${data.colorCategory}`}
        />
        <span className={styles.name} title={data.name}>
          {data.name || 'Unnamed agent'}
        </span>
        <span className={`${styles.badge} ${styles[`badge_${status}`] ?? ''}`}>
          {data.hasError ? 'Error' : STATUS_LABEL[status] ?? status}
        </span>
      </div>
      {data.role && <div className={styles.role}>{data.role}</div>}
      {data.kind !== 'participant' && (
        <div
          className={`${styles.kindChip} ${KIND_META[data.kind].wrapUp ? styles.kindWrapUp : ''}`}
          title={KIND_META[data.kind].hint}
        >
          <span aria-hidden="true">{KIND_META[data.kind].icon}</span> {KIND_META[data.kind].label}
          {KIND_META[data.kind].wrapUp ? ' · wrap-up' : ''}
        </div>
      )}
      <div className={styles.provider} title={data.providerLabel}>
        {data.providerLabel}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
