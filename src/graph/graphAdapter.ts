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

// Connection types are distinguished by dash pattern so they read apart even in
// grayscale (spec §22): review long-dashed, handoff dotted, conversation solid.
// A disabled edge (whatever its type) falls back to the muted short-dash.
function dashFor(conn: Connection): string | undefined {
  if (!conn.enabled) return '2 3';
  if (conn.type === 'review') return '6 4';
  if (conn.type === 'handoff') return '1 5';
  return undefined;
}

export function connectionsToEdges(
  connections: Connection[],
  activeConnectionId: string | null,
  selectedConnectionId: string | null = null,
): Edge<ConnectionEdgeData>[] {
  return connections.map((conn) => {
    const active = conn.id === activeConnectionId;
    const selected = conn.id === selectedConnectionId;
    const label = conn.label || TYPE_ABBREV[conn.type];
    // Runtime-active and selected both read accent (active also animates + is
    // thicker); otherwise enabled edges use --edge, muted ones --edge-muted. The
    // arrowhead follows the same color so muted edges don't keep a solid tip.
    const strokeColor =
      active || selected ? 'var(--accent)' : conn.enabled ? 'var(--edge)' : 'var(--edge-muted)';
    return {
      id: conn.id,
      source: conn.source,
      target: conn.target,
      type: 'smoothstep',
      animated: active,
      label,
      style: {
        stroke: strokeColor,
        strokeWidth: active || selected ? 2.5 : 1.5,
        strokeDasharray: dashFor(conn),
        opacity: conn.enabled ? 1 : 0.5,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor },
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
