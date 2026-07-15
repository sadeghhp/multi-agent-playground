import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { AgentNode } from '../AgentNode';
import type { AgentNodeData } from '../graphAdapter';

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

/** AgentNode uses React Flow Handles, which need the provider context. */
function renderNode(data: AgentNodeData) {
  return render(
    <ReactFlowProvider>
      {/* @ts-expect-error NodeProps has many fields the component ignores; data is what matters. */}
      <AgentNode data={data} selected={false} />
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
