import { describe, expect, it } from 'vitest';
import { analyzeGraph, detectCycles, effectiveConfidences, topologicalOrder } from '../src/graph-analysis.js';
import type { AtomData } from '../src/types.js';

function atom(partial: Partial<AtomData> & { atomId: string }): AtomData {
  return {
    content: partial.atomId,
    atomType: 'reasoning',
    dependencies: [],
    confidence: 0.8,
    created: 1,
    isVerified: false,
    ...partial,
  } as AtomData;
}

function byId(atoms: AtomData[]): Record<string, AtomData> {
  return Object.fromEntries(atoms.map(a => [a.atomId, a]));
}

describe('graph-analysis', () => {
  const chain = byId([
    atom({ atomId: 'P1', atomType: 'premise', confidence: 0.9 }),
    atom({ atomId: 'R1', dependencies: ['P1'], confidence: 0.8 }),
    atom({ atomId: 'H1', atomType: 'hypothesis', dependencies: ['R1'], confidence: 0.7 }),
    atom({ atomId: 'V1', atomType: 'verification', dependencies: ['H1'], confidence: 0.9, isVerified: true }),
    atom({ atomId: 'C1', atomType: 'conclusion', dependencies: ['H1'], confidence: 0.9, isVerified: true }),
  ]);

  it('computes topological order respecting dependencies', () => {
    const order = topologicalOrder(chain)!;
    expect(order.indexOf('P1')).toBeLessThan(order.indexOf('R1'));
    expect(order.indexOf('R1')).toBeLessThan(order.indexOf('H1'));
    expect(order.indexOf('H1')).toBeLessThan(order.indexOf('C1'));
  });

  it('propagates effective confidence multiplicatively along the weakest chain', () => {
    const eff = effectiveConfidences(chain);
    expect(eff.get('P1')).toBeCloseTo(0.9);
    expect(eff.get('R1')).toBeCloseTo(0.72);
    expect(eff.get('H1')).toBeCloseTo(0.504);
    expect(eff.get('C1')).toBeCloseTo(0.9 * 0.504);
  });

  it('detects cycles and reports them without hanging', () => {
    const cyclic = byId([
      atom({ atomId: 'A', dependencies: ['B'] }),
      atom({ atomId: 'B', dependencies: ['A'] }),
    ]);
    const cycles = detectCycles(cyclic);
    expect(cycles.length).toBeGreaterThan(0);
    expect(topologicalOrder(cyclic)).toBeNull();
    const analysis = analyzeGraph(cyclic);
    expect(analysis.issues.some(issue => issue.code === 'cycle')).toBe(true);
  });

  it('reports dangling dependencies, unverified conclusions, and untested hypotheses', () => {
    const messy = byId([
      atom({ atomId: 'R1', dependencies: ['GHOST'] }),
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'C1', atomType: 'conclusion', isVerified: false }),
    ]);
    const analysis = analyzeGraph(messy);
    const codes = analysis.issues.map(issue => issue.code);
    expect(codes).toContain('dangling_dependency');
    expect(codes).toContain('unverified_conclusion');
    expect(codes).toContain('unsupported_conclusion');
    expect(codes).toContain('untested_hypothesis');
  });

  it('finds contradictions between hypotheses sharing dependencies', () => {
    const graph = byId([
      atom({ atomId: 'P1', atomType: 'premise' }),
      atom({ atomId: 'H1', atomType: 'hypothesis', content: 'It is X', dependencies: ['P1'] }),
      atom({ atomId: 'H2', atomType: 'hypothesis', content: 'It is Y', dependencies: ['P1'] }),
    ]);
    const analysis = analyzeGraph(graph);
    expect(analysis.contradictions).toEqual([
      { a: 'H1', b: 'H2', sharedDependencies: ['P1'] },
    ]);
  });

  it('produces a critical path ending at the best conclusion', () => {
    const analysis = analyzeGraph(chain);
    expect(analysis.criticalPath?.at(-1)).toBe('C1');
    expect(analysis.criticalPath?.[0]).toBe('P1');
  });

  it('flags weak supports below threshold', () => {
    const graph = byId([
      atom({ atomId: 'P1', atomType: 'premise', confidence: 0.3 }),
      atom({ atomId: 'R1', dependencies: ['P1'] }),
    ]);
    const analysis = analyzeGraph(graph, { weakThreshold: 0.5 });
    expect(analysis.issues.some(issue => issue.code === 'weak_support' && issue.atomIds[0] === 'P1')).toBe(true);
  });

  it('reports roots, leaves, and per-type counts', () => {
    const analysis = analyzeGraph(chain);
    expect(analysis.roots).toEqual(['P1']);
    expect(analysis.leaves.sort()).toEqual(['C1', 'V1']);
    expect(analysis.countsByType.premise).toBe(1);
    expect(analysis.countsByType.conclusion).toBe(1);
    expect(analysis.atomCount).toBe(5);
  });
});
