import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDagAtoms, buildDagGraph, normalizeDag, summarizeDag, type DagInput } from '../src/integrations/dag.js';

const examplesDir = path.join(process.cwd(), 'examples', 'personal-workflows');
const exampleFiles = fs.readdirSync(examplesDir)
  .filter(file => file.endsWith('.dag.json'))
  .sort();

describe('personal workflow DAG examples', () => {
  it('includes the portfolio meta DAG and five concrete application DAGs', () => {
    expect(exampleFiles).toEqual([
      'agent-tooling-release-orchestrator.dag.json',
      'anzca-saq-syntopical-factory.dag.json',
      'mak95-mcq-five-gate-closure.dag.json',
      'memex-graph-maintenance.dag.json',
      'pageindex-r2l-evidence-crosswalk.dag.json',
      'portfolio-meta.dag.json',
    ]);
  });

  it.each(exampleFiles)('normalizes and renders %s as AoT atoms and br graph', (file) => {
    const input = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8')) as DagInput;
    const dag = normalizeDag(input);
    const summary = summarizeDag(dag);
    const atoms = buildDagAtoms(dag);
    const graph = buildDagGraph(dag);

    expect(summary).toMatchObject({ title: input.title, sessionId: input.sessionId });
    expect(atoms).toHaveLength(dag.nodes.length);
    expect(graph.nodes).toHaveLength(dag.nodes.length);
    expect(graph.links).toHaveLength(dag.edges.length);
    expect(atoms.every(atom => atom.content.includes(`AoT external ref: aot:${dag.sessionId}:`))).toBe(true);
    expect(dag.nodes.some(node => node.dependencies.length > 0)).toBe(true);
  });
});
