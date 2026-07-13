import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { newConnectionId } from '../domain/ids';
import { AgentNode } from './AgentNode';
import { agentsToNodes, connectionsToEdges, type AgentFlowNode } from './graphAdapter';
import styles from './GraphCanvas.module.css';

const nodeTypes = { agent: AgentNode };

function CanvasInner() {
  const playground = useDomainStore((s) => s.playground);
  const setAgentPosition = useDomainStore((s) => s.setAgentPosition);
  const removeAgent = useDomainStore((s) => s.removeAgent);
  const removeConnection = useDomainStore((s) => s.removeConnection);
  const addConnection = useDomainStore((s) => s.addConnection);

  const selectAgent = useUiStore((s) => s.selectAgent);
  const selectConnection = useUiStore((s) => s.selectConnection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const showToast = useUiStore((s) => s.showToast);

  const isRunning = useRuntimeStore((s) => s.status === 'running');
  const agentStates = useRuntimeStore((s) => s.agentStates);
  const activeConnectionId = useRuntimeStore((s) => s.activeConnectionId);
  const errors = useRuntimeStore((s) => s.errors);

  const { fitView } = useReactFlow();

  const erroredAgentIds = useMemo(
    () => new Set(errors.filter((e) => e.agentId).map((e) => e.agentId as string)),
    [errors],
  );

  const nodes = useMemo<AgentFlowNode[]>(() => {
    if (!playground) return [];
    return agentsToNodes(playground.agents, playground.providers, {
      agentStates,
      erroredAgentIds,
    });
  }, [playground, agentStates, erroredAgentIds]);

  const edges = useMemo<Edge[]>(() => {
    if (!playground) return [];
    return connectionsToEdges(playground.connections, activeConnectionId);
  }, [playground, activeConnectionId]);

  // Node drag -> persist position. Deletion handled via onNodesDelete.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isRunning) return;
      for (const change of changes) {
        // Persist position as the node moves; autosave debounce coalesces writes.
        if (change.type === 'position' && change.position) {
          setAgentPosition(change.id, change.position.x, change.position.y);
        }
      }
    },
    [isRunning, setAgentPosition],
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
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={(_e, node) => selectAgent(node.id)}
        onEdgeClick={(_e, edge) => selectConnection(edge.id)}
        onPaneClick={() => clearSelection()}
        nodesDraggable={!isRunning}
        nodesConnectable={!isRunning}
        elementsSelectable={!isRunning}
        deleteKeyCode={isRunning ? null : ['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className={styles.minimap} />
      </ReactFlow>
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
