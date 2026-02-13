import { describe, it, expect } from 'vitest';
import { VALID_ATOM_TYPES } from '../src/types.js';
import type { AtomType, GraphData, ApprovalResult } from '../src/types.js';

describe('types', () => {
  it('VALID_ATOM_TYPES contains exactly 5 types', () => {
    expect(VALID_ATOM_TYPES).toHaveLength(5);
    expect(VALID_ATOM_TYPES).toEqual(['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion']);
  });

  it('AtomType union accepts valid types', () => {
    const types: AtomType[] = ['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion'];
    types.forEach(t => expect(VALID_ATOM_TYPES).toContain(t));
  });

  it('GraphData shape is valid', () => {
    const data: GraphData = {
      title: 'Test',
      nodes: [{ id: 'P1', type: 'premise', content: 'test', confidence: 0.9, depth: 0 }],
      links: [{ source: 'P1', target: 'R1' }],
    };
    expect(data.title).toBe('Test');
    expect(data.nodes).toHaveLength(1);
    expect(data.links).toHaveLength(1);
  });

  it('ApprovalResult shape is valid', () => {
    const result: ApprovalResult = {
      status: 'APPROVED',
      timestamp: new Date().toISOString(),
      approvedNodes: ['P1', 'R1'],
    };
    expect(result.status).toBe('APPROVED');
    expect(result.approvedNodes).toHaveLength(2);
  });
});
