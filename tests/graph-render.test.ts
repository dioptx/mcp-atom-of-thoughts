import { describe, expect, it } from 'vitest';
import { renderCanvas, renderDot, renderGraph, renderMermaid, renderTree } from '../src/graph-render.js';
import type { GraphData } from '../src/types.js';

const graph: GraphData = {
  title: 'Test Graph',
  nodes: [
    { id: 'P1', type: 'premise', content: 'API returns 500', confidence: 0.9, depth: 0, isVerified: true },
    { id: 'R1', type: 'reasoning', content: 'Handler throws', confidence: 0.8, depth: 1 },
    { id: 'C1', type: 'conclusion', content: 'Fix the handler', confidence: 0.85, depth: 2 },
  ],
  links: [
    { source: 'P1', target: 'R1' },
    { source: 'R1', target: 'C1', relation: 'entails' },
  ],
};

describe('graph-render', () => {
  it('renders an ASCII tree from roots with confidence and verification markers', () => {
    const tree = renderTree(graph);
    expect(tree).toContain('Test Graph');
    expect(tree).toContain('[P] P1 ✓ (90%) API returns 500');
    expect(tree).toContain('└── [R] R1 (80%) Handler throws');
    expect(tree).toContain('    └── [C] C1 (85%) Fix the handler');
  });

  it('marks revisited nodes instead of looping on diamond/cyclic shapes', () => {
    const diamond: GraphData = {
      title: 'Diamond',
      nodes: [
        { id: 'A', type: 'premise', content: 'a', confidence: 1, depth: 0 },
        { id: 'B', type: 'reasoning', content: 'b', confidence: 1, depth: 1 },
        { id: 'C', type: 'reasoning', content: 'c', confidence: 1, depth: 1 },
        { id: 'D', type: 'conclusion', content: 'd', confidence: 1, depth: 2 },
      ],
      links: [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'B', target: 'D' },
        { source: 'C', target: 'D' },
      ],
    };
    const tree = renderTree(diamond);
    expect(tree).toContain('D (see above)');
  });

  it('renders mermaid with edges, relation labels, and verified class', () => {
    const mermaid = renderMermaid(graph);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('P1 --> R1');
    expect(mermaid).toContain('R1 -->|entails| C1');
    expect(mermaid).toContain('class P1 verified;');
  });

  it('renders valid dot output', () => {
    const dot = renderDot(graph);
    expect(dot).toContain('digraph aot {');
    expect(dot).toContain('"P1" -> "R1";');
    expect(dot).toContain('label="entails"');
  });

  it('renders parseable JSON Canvas with depth-column layout', () => {
    const canvas = JSON.parse(renderCanvas(graph));
    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);
    const p1 = canvas.nodes.find((n: { id: string }) => n.id === 'P1');
    const r1 = canvas.nodes.find((n: { id: string }) => n.id === 'R1');
    expect(p1.x).toBeLessThan(r1.x);
    expect(p1.text).toContain('**P1**');
    expect(canvas.edges[1].label).toBe('entails');
  });

  it('dispatches formats through renderGraph', () => {
    expect(renderGraph(graph, 'tree')).toContain('└──');
    expect(renderGraph(graph, 'mermaid')).toContain('graph TD');
    expect(renderGraph(graph, 'dot')).toContain('digraph');
    expect(() => JSON.parse(renderGraph(graph, 'canvas'))).not.toThrow();
  });
});
