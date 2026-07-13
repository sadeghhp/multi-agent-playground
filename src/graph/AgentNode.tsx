import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentFlowNode } from './graphAdapter';
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

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const status = data.runtimeState;
  const classNames = [
    styles.node,
    styles[`color_${data.colorCategory}`],
    selected ? styles.selected : '',
    !data.enabled ? styles.disabled : '',
    styles[`state_${status}`] ?? '',
    data.hasError ? styles.errored : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames} data-testid={`agent-node-${data.agentId}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.header}>
        <span className={styles.name} title={data.name}>
          {data.name || 'Unnamed agent'}
        </span>
        <span className={`${styles.badge} ${styles[`badge_${status}`] ?? ''}`}>
          {data.hasError ? 'Error' : STATUS_LABEL[status] ?? status}
        </span>
      </div>
      {data.role && <div className={styles.role}>{data.role}</div>}
      <div className={styles.provider} title={data.providerLabel}>
        {data.providerLabel}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
