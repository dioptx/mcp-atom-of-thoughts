import { describe, it, expect } from 'vitest';
import { exportGraph } from '../src/graph-export.js';
import type { AtomData } from '../src/types.js';

function makeAtom(id: string, type: AtomData['atomType'], deps: string[] = [], confidence = 0.9, depth?: number): AtomData {
  return { atomId: id, content: `Content of ${id}`, atomType: type, dependencies: deps, confidence, created: Date.now(), isVerified: false, depth };
}

describe('exportGraph', () => {
  it('returns empty graph for no atoms', () => {
    const result = exportGraph({}, []);
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(result.title).toBe('AoT Plan Visualization');
  });

  it('exports a single premise', () => {
    const atoms = { P1: makeAtom('P1', 'premise') };
    const result = exportGraph(atoms, ['P1']);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('P1');
    expect(result.nodes[0].type).toBe('premise');
    expect(result.links).toHaveLength(0);
  });

  it('exports P1 -> R1 with correct link', () => {
    const atoms = {
      P1: makeAtom('P1', 'premise'),
      R1: makeAtom('R1', 'reasoning', ['P1']),
    };
    const result = exportGraph(atoms, ['P1', 'R1']);
    expect(result.nodes).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toEqual({ source: 'P1', target: 'R1' });
  });

  it('uses custom title', () => {
    const result = exportGraph({}, [], 'My Plan');
    expect(result.title).toBe('My Plan');
  });

  it('node format includes all required fields', () => {
    const atoms = { P1: makeAtom('P1', 'premise', [], 0.95, 0) };
    const result = exportGraph(atoms, ['P1']);
    const node = result.nodes[0];
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('type');
    expect(node).toHaveProperty('content');
    expect(node).toHaveProperty('confidence');
    expect(node).toHaveProperty('depth');
  });

  it('calculates depth from type when atom depth is undefined', () => {
    const atoms = { H1: makeAtom('H1', 'hypothesis') };
    const result = exportGraph(atoms, ['H1']);
    expect(result.nodes[0].depth).toBe(2); // hypothesis = 2
  });

  it('preserves atom order', () => {
    const atoms = {
      R1: makeAtom('R1', 'reasoning'),
      P1: makeAtom('P1', 'premise'),
    };
    const result = exportGraph(atoms, ['P1', 'R1']);
    expect(result.nodes[0].id).toBe('P1');
    expect(result.nodes[1].id).toBe('R1');
  });

  it('skips links to missing atoms', () => {
    const atoms = { R1: makeAtom('R1', 'reasoning', ['MISSING']) };
    const result = exportGraph(atoms, ['R1']);
    expect(result.links).toHaveLength(0);
  });
});
