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

  it('propagates effective confidence multiplicatively, with verification anchoring the chain', () => {
    const eff = effectiveConfidences(chain);
    expect(eff.get('P1')).toBeCloseTo(0.9);
    expect(eff.get('R1')).toBeCloseTo(0.72);
    expect(eff.get('H1')).toBeCloseTo(0.504);
    // C1 is VERIFIED: empirical verification resets the support discount.
    expect(eff.get('C1')).toBeCloseTo(0.9);
  });

  it('unverified atoms keep the multiplicative discount; refuted atoms drop to zero', () => {
    const graph = byId([
      atom({ atomId: 'P1', atomType: 'premise', confidence: 0.9 }),
      atom({ atomId: 'H1', atomType: 'hypothesis', dependencies: ['P1'], confidence: 0.7 }),
      atom({ atomId: 'C1', atomType: 'conclusion', dependencies: ['H1'], confidence: 0.9 }),
      atom({ atomId: 'H2', atomType: 'hypothesis', dependencies: ['P1'], confidence: 0.8, isRefuted: true }),
      atom({ atomId: 'C2', atomType: 'conclusion', dependencies: ['H2'], confidence: 0.95 }),
    ]);
    const eff = effectiveConfidences(graph);
    expect(eff.get('C1')).toBeCloseTo(0.9 * 0.7 * 0.9);
    expect(eff.get('H2')).toBe(0);
    expect(eff.get('C2')).toBe(0);
    const analysis = analyzeGraph(graph);
    expect(analysis.refuted).toEqual(['H2']);
    const codes = analysis.issues.map(issue => issue.code);
    expect(codes).toContain('refuted_support');
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

  it('flags contradictions only for atoms with BOTH verified supporting and refuting evidence', () => {
    const graph = byId([
      atom({ atomId: 'P1', atomType: 'premise' }),
      // Sibling hypotheses sharing a dependency are rivals, NOT contradictions.
      atom({ atomId: 'H1', atomType: 'hypothesis', content: 'It is X', dependencies: ['P1'] }),
      atom({ atomId: 'H2', atomType: 'hypothesis', content: 'It is Y', dependencies: ['P1'] }),
      atom({ atomId: 'V1', atomType: 'verification', dependencies: ['H1'], isVerified: true }),
      atom({ atomId: 'V2', atomType: 'verification', dependencies: ['H1'], isVerified: true, polarity: 'refutes' }),
    ]);
    const analysis = analyzeGraph(graph);
    expect(analysis.contradictions).toEqual([
      { atomId: 'H1', supportedBy: ['V1'], refutedBy: ['V2'] },
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
