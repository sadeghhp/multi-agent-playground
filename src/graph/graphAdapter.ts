import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Agent, Connection, Provider, RuntimeState } from '../domain/schema';

/**
 * Graph/domain seam (spec §5). Projects domain agents+connections into the
 * shape React Flow consumes, and nothing else. React Flow never sees an Agent;
 * it sees a node whose `data` carries only what the AgentNode renders. This is
 * the boundary that keeps the graph library swappable.
 */

export interface AgentNodeData extends Record<string, unknown> {
  agentId: string;
  name: string;
  role: string;
  providerLabel: string;
  colorCategory: Agent['colorCategory'];
  enabled: boolean;
  runtimeState: RuntimeState;
  hasError: boolean;
}

export type AgentFlowNode = Node<AgentNodeData, 'agent'>;

export interface ConnectionEdgeData extends Record<string, unknown> {
  connectionId: string;
  connectionType: Connection['type'];
  enabled: boolean;
  active: boolean;
  label?: string;
}

function providerLabel(agent: Agent, providers: Provider[]): string {
  const provider = providers.find((p) => p.id === agent.llm.providerId);
  const model = agent.llm.model ? agent.llm.model : '—';
  if (!provider) return `no provider · ${model}`;
  return `${provider.displayName} · ${model}`;
}

export function agentsToNodes(
  agents: Agent[],
  providers: Provider[],
  opts: {
    agentStates: Record<string, RuntimeState>;
    erroredAgentIds: Set<string>;
  },
): AgentFlowNode[] {
  return agents.map((agent) => {
    const runtimeState: RuntimeState = !agent.runtime.enabled
      ? 'disabled'
      : opts.agentStates[agent.id] ?? 'idle';
    return {
      id: agent.id,
      type: 'agent',
      position: { x: agent.position.x, y: agent.position.y },
      data: {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        providerLabel: providerLabel(agent, providers),
        colorCategory: agent.colorCategory,
        enabled: agent.runtime.enabled,
        runtimeState,
        hasError: opts.erroredAgentIds.has(agent.id),
      },
    };
  });
}

const TYPE_ABBREV: Record<Connection['type'], string> = {
  conversation: 'talk',
  review: 'review',
  handoff: 'handoff',
};

export function connectionsToEdges(
  connections: Connection[],
  activeConnectionId: string | null,
): Edge<ConnectionEdgeData>[] {
  return connections.map((conn) => {
    const active = conn.id === activeConnectionId;
    const label = conn.label || TYPE_ABBREV[conn.type];
    return {
      id: conn.id,
      source: conn.source,
      target: conn.target,
      type: 'smoothstep',
      animated: active,
      label,
      // review flows are dashed to read differently even in grayscale (spec §22)
      style: {
        stroke: active ? 'var(--accent)' : conn.enabled ? 'var(--edge)' : 'var(--edge-muted)',
        strokeWidth: active ? 2.5 : 1.5,
        strokeDasharray: conn.type === 'review' ? '6 4' : conn.enabled ? undefined : '2 3',
        opacity: conn.enabled ? 1 : 0.5,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: active ? 'var(--accent)' : 'var(--edge)' },
      data: {
        connectionId: conn.id,
        connectionType: conn.type,
        enabled: conn.enabled,
        active,
        label,
      },
    };
  });
}
