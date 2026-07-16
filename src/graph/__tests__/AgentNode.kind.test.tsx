import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { AgentNode } from '../AgentNode';
import type { AgentFlowNode, AgentNodeData } from '../graphAdapter';

function baseData(overrides: Partial<AgentNodeData>): AgentNodeData {
  return {
    agentId: 'a1',
    name: 'A',
    role: 'r',
    kind: 'participant',
    providerLabel: 'P · m',
    colorCategory: 'blue',
    enabled: true,
    runtimeState: 'idle',
    hasError: false,
    ...overrides,
  };
}

// AgentNode only reads `data` and `selected`; supply those and fill the ~15
// other React Flow-injected NodeProps fields with a single documented cast
// rather than fabricating each unused one.
function nodeProps(data: AgentNodeData): NodeProps<AgentFlowNode> {
  return { data, selected: false } as unknown as NodeProps<AgentFlowNode>;
}

/** AgentNode uses React Flow Handles, which need the provider context. */
function renderNode(data: AgentNodeData) {
  return render(
    <ReactFlowProvider>
      <AgentNode {...nodeProps(data)} />
    </ReactFlowProvider>,
  );
}

afterEach(() => cleanup());

describe('AgentNode — kind badge', () => {
  it('shows no kind chip for a participant', () => {
    renderNode(baseData({ kind: 'participant' }));
    expect(screen.queryByText(/wrap-up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Finalizer|Summarizer|Moderator/)).not.toBeInTheDocument();
  });

  it('shows a wrap-up badge for a finalizer', () => {
    renderNode(baseData({ kind: 'finalizer' }));
    expect(screen.getByText(/Finalizer/)).toBeInTheDocument();
    expect(screen.getByText(/wrap-up/i)).toBeInTheDocument();
  });

  it('shows a moderator chip without the wrap-up marker', () => {
    renderNode(baseData({ kind: 'moderator' }));
    expect(screen.getByText(/Moderator/)).toBeInTheDocument();
    expect(screen.queryByText(/wrap-up/i)).not.toBeInTheDocument();
  });
});
