import { describe, expect, it } from 'vitest';
import { createAgent } from '../../domain/factories';
import type { Connection } from '../../domain/schema';
import { layoutArrangement } from '../autoLayout';

function conn(source: string, target: string, priority = 0): Pick<Connection, 'source' | 'target' | 'enabled' | 'priority'> {
  return { source, target, enabled: true, priority };
}

const A = createAgent({ id: 'a', name: 'A' });
const B = createAgent({ id: 'b', name: 'B' });
const C = createAgent({ id: 'c', name: 'C' });
const S = createAgent({ id: 's', name: 'S', kind: 'summarizer' });
const F = createAgent({ id: 'f', name: 'F', kind: 'finalizer' });

describe('layoutArrangement', () => {
  it('lays a chain out left-to-right by depth', () => {
    const pos = layoutArrangement([A, B, C], [conn('a', 'b'), conn('b', 'c')], 'a');
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x);
    expect(pos.get('b')!.x).toBeLessThan(pos.get('c')!.x);
    expect(pos.get('a')!.y).toBe(pos.get('b')!.y);
  });

  it('stacks branch targets in one column, ordered by edge priority', () => {
    const pos = layoutArrangement([A, B, C], [conn('a', 'c', 1), conn('a', 'b', 5)], 'a');
    expect(pos.get('b')!.x).toBe(pos.get('c')!.x);
    // b has the higher-priority edge → scheduled (and stacked) first.
    expect(pos.get('b')!.y).toBeLessThan(pos.get('c')!.y);
  });

  it('places summarizers and finalizers in the last columns regardless of roster order', () => {
    const pos = layoutArrangement([F, S, A, B], [conn('a', 'b')], 'a');
    expect(pos.get('s')!.x).toBeGreaterThan(pos.get('b')!.x);
    expect(pos.get('f')!.x).toBeGreaterThan(pos.get('s')!.x);
  });

  it('puts unreached flow agents in an overflow column', () => {
    const pos = layoutArrangement([A, B, C], [conn('a', 'b')], 'a');
    expect(pos.get('c')!.x).toBeGreaterThan(pos.get('b')!.x);
  });

  it('is deterministic and collision-free', () => {
    const agents = [A, B, C, S, F];
    const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
    const p1 = layoutArrangement(agents, conns, 'a');
    const p2 = layoutArrangement(agents, conns, 'a');
    expect([...p1.entries()]).toEqual([...p2.entries()]);
    const coords = [...p1.values()].map((p) => `${p.x},${p.y}`);
    expect(new Set(coords).size).toBe(coords.length);
    expect(p1.size).toBe(agents.length);
  });

  it('honors a kind override map (corrections applied before layout)', () => {
    const pos = layoutArrangement(
      [A, B, C],
      [conn('a', 'b')],
      'a',
      (id) => (id === 'c' ? 'summarizer' : 'participant'),
    );
    // c treated as terminal → last column, after b.
    expect(pos.get('c')!.x).toBeGreaterThan(pos.get('b')!.x);
  });
});
