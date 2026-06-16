import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDagAtoms, buildDagGraph, normalizeDag, summarizeDag, type DagInput } from '../src/integrations/dag.js';

const examplesDir = path.join(process.cwd(), 'examples', 'personal-workflows');
const exampleFiles = fs.readdirSync(examplesDir)
  .filter(file => file.endsWith('.dag.json'))
  .sort();

const requiredGateNodes: Record<string, string[]> = {
  'anzca-saq-syntopical-factory.dag.json': ['DRY_RUN_PREVIEW', 'EVIDENCE_MANIFEST', 'CITATION_AUDIT', 'REGRESSION_CHECK', 'REVIEW_SIGNOFF', 'REPLAY_GATE'],
  'pageindex-r2l-evidence-crosswalk.dag.json': ['UPLOAD_SMOKE_TEST', 'POLL_R2L_READY', 'MANIFEST_VALIDATE', 'CROSSWALK_VALIDATE', 'ROLLBACK_OR_RECONCILE'],
  'mak95-mcq-five-gate-closure.dag.json': ['ROW_INVENTORY', 'SCHEMA_LOCK', 'ROUTE_AUDIT', 'RETRY_OR_ESCALATE', 'MERGE_DRY_RUN'],
  'memex-graph-maintenance.dag.json': ['BASELINE', 'DEDUP', 'WRITE_DRY_RUN', 'PRE_SYNC_VALIDATE', 'POST_SYNC_VERIFY'],
  'agent-tooling-release-orchestrator.dag.json': ['OWNERSHIP', 'VERIFY_TESTS', 'VERIFY_SMOKE', 'VERIFY_CALIBER', 'VERIFY_REMOTE', 'VERIFY_REMOTE_STATE', 'CAPTURE_LEARNING'],
};

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

  it.each(Object.entries(requiredGateNodes))('keeps subagent-derived safety gates in %s', (file, gates) => {
    const input = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8')) as DagInput;
    const nodeIds = new Set(input.nodes.map(node => node.id));

    for (const gate of gates) expect(nodeIds.has(gate)).toBe(true);
    expect(input.constraints?.some(constraint => constraint.includes('executable DAG nodes'))).toBe(true);
  });

  it.each(Object.keys(requiredGateNodes))('gives high-risk gates acceptance criteria in %s', (file) => {
    const input = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8')) as DagInput;
    const highRiskNodes = input.nodes.filter(node => /VALIDATE|VERIFY|AUDIT|GATE|SYNC|UPLOAD|WRITE|RELEASE|PUSH|COMMIT|RETRY|REPLAY|REMOTE|BASELINE|MANIFEST|INVENTORY|SCHEMA/.test(node.id));

    expect(highRiskNodes.length).toBeGreaterThan(0);
    for (const node of highRiskNodes) {
      expect(node.acceptanceCriteria, `${file}:${node.id} should declare observable acceptance criteria`).toBeDefined();
      expect(node.acceptanceCriteria?.length, `${file}:${node.id} should have at least one acceptance criterion`).toBeGreaterThan(0);
    }
  });
});
