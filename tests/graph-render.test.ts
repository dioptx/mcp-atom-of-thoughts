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

describe('graph-render causal layer (round 3)', () => {
  const causalGraph: GraphData = {
    title: 'Causal Graph',
    nodes: [
      { id: 'A', type: 'premise', content: 'demand', confidence: 0.8, depth: 0 },
      { id: 'B', type: 'reasoning', content: 'capacity', confidence: 0.8, depth: 1 },
    ],
    links: [{ source: 'A', target: 'B' }],
    causalLinks: [
      { id: 'cl:A>B', from: 'A', to: 'B', sign: '+', gain: 'high', label: 'drives', created: 1 },
      { id: 'cl:B>A', from: 'B', to: 'A', sign: '-', gain: 'med', created: 2 },
    ],
  };

  it('R3-TRE-01: appends a Causal links section in tree format', () => {
    const tree = renderTree(causalGraph);
    expect(tree).toContain('\nCausal links:\n');
    expect(tree).toContain('  A --(+/high)--> B  drives');
    expect(tree).toContain('  B --(-)--> A');
  });

  it('R3-TRE-02: byte-identical to no-causal output when there are no causal links', () => {
    const withEmpty: GraphData = { ...causalGraph, causalLinks: [] };
    const withAbsent: GraphData = { title: causalGraph.title, nodes: causalGraph.nodes, links: causalGraph.links };
    expect(renderTree(withEmpty)).toBe(renderTree(withAbsent));
    expect(renderTree(withEmpty)).not.toContain('Causal links');
  });

  it('R3-MER-01: mermaid dashed causal edges appear before the classDef block', () => {
    const g: GraphData = { ...causalGraph, nodes: causalGraph.nodes.map(n => n.id === 'A' ? { ...n, isVerified: true } : n) };
    const mer = renderMermaid(g);
    expect(mer).toContain('  A -.->|+/high drives| B');
    expect(mer).toContain('  B -.->|-| A'); // sign-only edge (no label, med gain)
    expect(mer.indexOf('-.->')).toBeLessThan(mer.indexOf('classDef verified'));
  });

  it('R3-MER-02: escapes pipe and quote in edge labels, never the sign', () => {
    const g: GraphData = { ...causalGraph, causalLinks: [{ id: 'cl:A>B', from: 'A', to: 'B', sign: '-', gain: 'med', label: 'a|b "c"', created: 1 }] };
    const mer = renderMermaid(g);
    expect(mer).toContain('|- a#124;b #quot;c#quot;|');
    expect(mer).not.toContain('a|b');
  });

  it('R3-DOT-01: dot dashed purple causal edges', () => {
    const dot = renderDot(causalGraph);
    expect(dot).toContain('"A" -> "B" [style=dashed, label="+/high drives", color="#9467bd"];');
    expect(dot).toContain('"B" -> "A" [style=dashed, label="-", color="#9467bd"];');
  });

  it('R3-CVS-01: canvas causal edges numbered, orange, bottom->top', () => {
    const canvas = JSON.parse(renderCanvas(causalGraph));
    const causal = canvas.edges.filter((e: { id: string }) => e.id.startsWith('causal-edge-'));
    expect(causal).toHaveLength(2);
    expect(causal[0]).toMatchObject({ id: 'causal-edge-0', fromNode: 'A', fromSide: 'bottom', toNode: 'B', toSide: 'top', color: '2', label: '+/high drives' });
    expect(causal[1].label).toBe('-'); // sign-only label always present
    // dep edges keep their own ids and routing
    expect(canvas.edges.find((e: { id: string }) => e.id === 'edge-0')).toMatchObject({ fromSide: 'right', toSide: 'left' });
  });

  it('R3-ORD-01: deterministic ordering regardless of input link order', () => {
    const shuffled: GraphData = { ...causalGraph, causalLinks: [...causalGraph.causalLinks!].reverse() };
    expect(renderTree(shuffled)).toBe(renderTree(causalGraph));
    expect(renderMermaid(shuffled)).toBe(renderMermaid(causalGraph));
  });

  it('R3-FIL-01: silently drops causal links with an endpoint absent from nodes', () => {
    const g: GraphData = { ...causalGraph, causalLinks: [...causalGraph.causalLinks!, { id: 'cl:A>Z', from: 'A', to: 'Z', sign: '+', gain: 'med', created: 3 }] };
    const dot = renderDot(g);
    expect(dot).not.toContain('"Z"');
    expect((dot.match(/style=dashed/g) ?? []).length).toBe(2);
  });

  it('renderGraph dispatches causal rendering for every format', () => {
    for (const fmt of ['tree', 'mermaid', 'dot', 'canvas'] as const) {
      expect(renderGraph(causalGraph, fmt)).toContain(fmt === 'canvas' ? 'causal-edge-0' : (fmt === 'tree' ? 'Causal links' : '+/high drives'.slice(0, 3)));
    }
  });
});
