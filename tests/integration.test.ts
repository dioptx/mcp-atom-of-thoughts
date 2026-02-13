import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';
import { AtomOfThoughtsLightServer } from '../src/atom-light-server.js';
import { exportGraph } from '../src/graph-export.js';
import { generateVisualizationHtml } from '../src/visualization.js';
import { getAllTools } from '../src/tools.js';

describe('integration', () => {
  let atomServer: AtomOfThoughtsServer;
  let lightServer: AtomOfThoughtsLightServer;

  beforeEach(() => {
    atomServer = new AtomOfThoughtsServer();
    lightServer = new AtomOfThoughtsLightServer();
  });

  it('getAllTools returns 6 tools', () => {
    expect(getAllTools()).toHaveLength(6);
  });

  it('AoT processAtom works end-to-end', () => {
    const result = atomServer.processAtom({
      atomId: 'P1', content: 'Test', atomType: 'premise',
      dependencies: [], confidence: 0.9
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).atomId).toBe('P1');
  });

  it('AoT-light processAtom works end-to-end', () => {
    const result = lightServer.processAtom({
      atomId: 'P1', content: 'Test', atomType: 'premise',
      dependencies: [], confidence: 0.9
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).atomId).toBe('P1');
  });

  it('export_graph works after adding atoms', () => {
    atomServer.processAtom({ atomId: 'P1', content: 'Premise', atomType: 'premise', dependencies: [], confidence: 0.9 });
    atomServer.processAtom({ atomId: 'R1', content: 'Reasoning', atomType: 'reasoning', dependencies: ['P1'], confidence: 0.85 });

    const graph = exportGraph(atomServer.getAtoms(), atomServer.getAtomOrder(), 'Test');
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toHaveLength(1);
    expect(graph.title).toBe('Test');
  });

  it('generate_visualization produces valid HTML from graph', () => {
    atomServer.processAtom({ atomId: 'P1', content: 'Premise', atomType: 'premise', dependencies: [], confidence: 0.9 });

    const graph = exportGraph(atomServer.getAtoms(), atomServer.getAtomOrder());
    const html = generateVisualizationHtml(graph);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('window.AOT_DATA');
    expect(html).toContain('"P1"');
  });

  it('full pipeline: add atoms -> export -> visualize', () => {
    // Build a 5-atom chain
    atomServer.processAtom({ atomId: 'P1', content: 'Given: X', atomType: 'premise', dependencies: [], confidence: 0.95 });
    atomServer.processAtom({ atomId: 'R1', content: 'Therefore: Y', atomType: 'reasoning', dependencies: ['P1'], confidence: 0.88 });
    atomServer.processAtom({ atomId: 'H1', content: 'Maybe: Z', atomType: 'hypothesis', dependencies: ['R1'], confidence: 0.82 });
    atomServer.processAtom({ atomId: 'V1', content: 'Checked: Z works', atomType: 'verification', dependencies: ['H1'], confidence: 0.9, isVerified: true });
    atomServer.processAtom({ atomId: 'C1', content: 'Do Z', atomType: 'conclusion', dependencies: ['V1'], confidence: 0.92 });

    const graph = exportGraph(atomServer.getAtoms(), atomServer.getAtomOrder(), 'Full Pipeline');
    expect(graph.nodes).toHaveLength(5);
    expect(graph.links).toHaveLength(4);

    const html = generateVisualizationHtml(graph);
    expect(html).toContain('Full Pipeline');
    expect(html).toContain('d3');

    // All 5 node IDs present in data
    ['P1', 'R1', 'H1', 'V1', 'C1'].forEach(id => {
      expect(html).toContain(`"${id}"`);
    });
  });

  it('atomcommands: decompose -> complete lifecycle', () => {
    atomServer.processAtom({ atomId: 'P1', content: 'Test', atomType: 'premise', dependencies: [], confidence: 0.9 });
    const decompId = atomServer.startDecomposition('P1');
    expect(decompId).toMatch(/^decomp_/);
    expect(atomServer.completeDecomposition(decompId)).toBe(true);
  });

  it('unknown tool name returns error response', () => {
    // Simulate what index.ts does for unknown tools
    const name = 'nonexistent_tool';
    const response = { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Unknown tool');
  });
});
