import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { newConnectionId } from '../domain/ids';
import { createAgent } from '../domain/factories';
import { AgentNode } from './AgentNode';
import { agentColor } from './colors';
import { agentsToNodes, connectionsToEdges, type AgentFlowNode } from './graphAdapter';
import styles from './GraphCanvas.module.css';

const nodeTypes = { agent: AgentNode };

function CanvasInner() {
  const playground = useDomainStore((s) => s.playground);
  const setAgentPosition = useDomainStore((s) => s.setAgentPosition);
  const removeAgent = useDomainStore((s) => s.removeAgent);
  const removeConnection = useDomainStore((s) => s.removeConnection);
  const addConnection = useDomainStore((s) => s.addConnection);
  const addAgent = useDomainStore((s) => s.addAgent);

  const selectAgent = useUiStore((s) => s.selectAgent);
  const selectConnection = useUiStore((s) => s.selectConnection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const showToast = useUiStore((s) => s.showToast);
  const setPanel = useUiStore((s) => s.setPanel);
  const selection = useUiStore((s) => s.selection);
  const selectedConnectionId = selection.kind === 'connection' ? selection.id : null;

  const providers = useProviderStore((s) => s.providers);
  const isRunning = useRuntimeStore((s) => s.status === 'running');
  const agentStates = useRuntimeStore((s) => s.agentStates);
  const activeConnectionId = useRuntimeStore((s) => s.activeConnectionId);
  const errors = useRuntimeStore((s) => s.errors);

  const { fitView } = useReactFlow();

  const erroredAgentIds = useMemo(
    () => new Set(errors.filter((e) => e.agentId).map((e) => e.agentId as string)),
    [errors],
  );

  // React Flow owns node state (canonical v12 pattern) so it can manage live drag
  // and keep its internal measured dimensions. We reconcile FROM the domain into
  // this state on structural/data changes, and write positions BACK to the domain
  // once per drag on drag-stop — never per animation frame.
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<AgentFlowNode>([]);

  // Desired nodes projected from the domain. Recomputed only when the domain
  // changes (not during a drag, which doesn't touch the domain).
  const desiredNodes = useMemo<AgentFlowNode[]>(() => {
    if (!playground) return [];
    return agentsToNodes(playground.agents, providers, {
      agentStates,
      erroredAgentIds,
    });
  }, [playground, providers, agentStates, erroredAgentIds]);

  useEffect(() => {
    // Merge desired data onto existing nodes, preserving each node's live
    // position and React Flow internals (measured/selected/dragging). New agents
    // adopt their domain position; removed agents drop out.
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return desiredNodes.map((d) => {
        const existing = prevById.get(d.id);
        if (!existing) return d;
        // Adopt the domain position for any non-drag reposition (undo/redo,
        // auto-layout, re-import over the same id) while leaving an in-progress
        // drag untouched, so the canvas can't fight the pointer.
        const position = existing.dragging ? existing.position : d.position;
        return { ...existing, data: d.data, position };
      });
    });
  }, [desiredNodes, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    if (!playground) return [];
    return connectionsToEdges(playground.connections, activeConnectionId, selectedConnectionId);
  }, [playground, activeConnectionId, selectedConnectionId]);

  const onNodesChange = useCallback(
    (changes: NodeChange<AgentFlowNode>[]) => {
      if (isRunning) {
        // Structure is locked during a run (spec §10.3), but allow selection and
        // measurement so a user can still click a node to inspect it read-only.
        const safe = changes.filter((c) => c.type === 'select' || c.type === 'dimensions');
        if (safe.length) onNodesChangeInternal(safe);
        return;
      }
      onNodesChangeInternal(changes);
    },
    [isRunning, onNodesChangeInternal],
  );

  // Persist the final position once, when a drag ends.
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      setAgentPosition(node.id, node.position.x, node.position.y);
    },
    [setAgentPosition],
  );

  const onEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // Edge geometry is derived; deletions handled via onEdgesDelete.
  }, []);

  const onConnect = useCallback(
    (conn: FlowConnection) => {
      if (isRunning || !conn.source || !conn.target) return;
      if (conn.source === conn.target) {
        showToast('warn', 'Self-connections create loops — allowed, but bounded by turn limits.');
      }
      addConnection({
        id: newConnectionId(),
        source: conn.source,
        target: conn.target,
        enabled: true,
        type: 'conversation',
        priority: 0,
      });
    },
    [isRunning, addConnection, showToast],
  );

  const onNodesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (isRunning) return;
      deleted.forEach((n) => removeAgent(n.id));
      clearSelection();
    },
    [isRunning, removeAgent, clearSelection],
  );

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (isRunning) return;
      deleted.forEach((e) => removeConnection(e.id));
      clearSelection();
    },
    [isRunning, removeConnection, clearSelection],
  );

  if (!playground) {
    return <div className={styles.empty}>No playground loaded.</div>;
  }

  return (
    <div className={styles.canvas} data-running={isRunning || undefined}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={(_e, node) => selectAgent(node.id)}
        onEdgeClick={(_e, edge) => selectConnection(edge.id)}
        onPaneClick={() => clearSelection()}
        nodesDraggable={!isRunning}
        nodesConnectable={!isRunning}
        elementsSelectable
        deleteKeyCode={isRunning ? null : ['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className={styles.minimap}
          nodeColor={(n) => agentColor((n.data as AgentFlowNode['data']).colorCategory)}
        />
      </ReactFlow>
      {playground.agents.length === 0 && !isRunning && (
        <div className={styles.emptyGraph}>
          <div className={styles.emptyCard}>
            <h2 className={styles.emptyTitle}>Start building your agent graph</h2>
            <p className={styles.emptyText}>
              Add an agent and wire edges, or try a sample playground to see how
              multi-agent workflows work across domains like product, science, and law.
            </p>
            <div className={styles.emptyActions}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const n = playground.agents.length;
                  const agent = createAgent({
                    name: 'New Agent',
                    position: { x: 120 + (n % 4) * 60, y: 100 + Math.floor(n / 4) * 60 },
                  });
                  addAgent(agent);
                  selectAgent(agent.id);
                }}
              >
                + Add your first agent
              </button>
              <button type="button" onClick={() => setPanel('playgrounds')}>
                Browse sample playgrounds
              </button>
            </div>
          </div>
        </div>
      )}
      {isRunning && <div className={styles.lockBadge}>Graph locked during run</div>}
      <div className={styles.viewButtons}>
        <button type="button" onClick={() => void fitView({ duration: 200 })}>
          Fit graph
        </button>
        <button type="button" onClick={() => void fitView({ duration: 200, maxZoom: 1 })}>
          Reset view
        </button>
      </div>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
