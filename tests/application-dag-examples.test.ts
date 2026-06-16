import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDagAtoms, buildDagGraph, normalizeDag, summarizeDag, type DagInput } from '../src/integrations/dag.js';

const examplesDir = path.join(process.cwd(), 'examples', 'personal-workflows');
const exampleFiles = fs.readdirSync(examplesDir)
  .filter(file => file.endsWith('.dag.json'))
  .sort();
const highRiskPattern = /VALIDATE|VERIFY|AUDIT|GATE|SYNC|UPLOAD|WRITE|RELEASE|PUSH|COMMIT|RETRY|REPLAY|REMOTE|BASELINE|MANIFEST|INVENTORY|SCHEMA|CHECKPOINT|APPROVAL|PRIVACY|SECRET|POLL|ROLLBACK|RECONCILE/;
const safetyRequiredKeys = ['riskLevel', 'mutationSurface', 'dryRunRequired', 'requiresApproval', 'checkpointArtifact', 'rollbackPlan', 'privacyScan', 'maxRetries', 'timeoutSeconds', 'abortOnFailure'];

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
    const highRiskNodes = input.nodes.filter(node => highRiskPattern.test(node.id));

    expect(highRiskNodes.length).toBeGreaterThan(0);
    for (const node of highRiskNodes) {
      expect(node.acceptanceCriteria, `${file}:${node.id} should declare observable acceptance criteria`).toBeDefined();
      expect(node.acceptanceCriteria?.length, `${file}:${node.id} should have at least one acceptance criterion`).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(requiredGateNodes))('gives high-risk nodes typed safety and operational metadata in %s', (file) => {
    const input = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8')) as DagInput;
    const highRiskNodes = input.nodes.filter(node => highRiskPattern.test(node.id));

    for (const node of highRiskNodes) {
      const safety = node.metadata?.safety as Record<string, unknown> | undefined;
      const operational = node.metadata?.operational as Record<string, unknown> | undefined;
      expect(safety, `${file}:${node.id} should have metadata.safety`).toBeDefined();
      for (const key of safetyRequiredKeys) expect(safety, `${file}:${node.id} missing safety.${key}`).toHaveProperty(key);
      expect(['low', 'medium', 'high', 'critical']).toContain(safety?.riskLevel);
      expect(Array.isArray(safety?.mutationSurface) && safety.mutationSurface.length > 0, `${file}:${node.id} needs mutation surfaces`).toBe(true);
      expect(typeof safety?.rollbackPlan).toBe('string');
      expect(typeof safety?.checkpointArtifact).toBe('string');
      expect(typeof safety?.privacyScan).toBe('boolean');
      expect(typeof safety?.abortOnFailure).toBe('boolean');
      expect(Number.isInteger(safety?.maxRetries)).toBe(true);
      expect(Number.isInteger(safety?.timeoutSeconds)).toBe(true);
      expect(operational?.commandTemplate, `${file}:${node.id} needs operational.commandTemplate`).toContain('--dryRun');
      expect(operational?.proofArtifact, `${file}:${node.id} needs operational.proofArtifact`).toContain('{runId}');
      expect(operational?.schemaRef).toBe('schemas/personal-workflows/safety-metadata.schema.json');
    }
  });

  it('ships safety schema, dry-run harness, and npm adoption script', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'schemas', 'personal-workflows', 'safety-metadata.schema.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

    expect(schema.required).toEqual(expect.arrayContaining(safetyRequiredKeys));
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'run-personal-workflows.mjs'))).toBe(true);
    expect(pkg.scripts['examples:dry-run']).toBe('node scripts/run-personal-workflows.mjs --all --dry-run');
    expect(fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')).toContain('out/');
  });

  it('keeps workflow assets included in the npm package surface', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const ci = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'cli.ts'), 'utf8');

    expect(pkg.version).toBe('3.1.0');
    expect(cliSource).toContain("const VERSION = '3.1.0'");
    expect(pkg.files).toEqual(expect.arrayContaining(['docs', 'examples', 'schemas', 'scripts/run-personal-workflows.mjs', 'MIGRATION_v2_to_v3.md', 'SECURITY.md']));
    expect(pkg.bin).toMatchObject({ aot: './build/cli.js', 'mcp-atom-of-thoughts': './build/index.js' });
    expect(ci).toContain('npm run examples:dry-run');
    expect(ci).toContain('npm pack --dry-run');
    expect(ci).toContain('node build/cli.js --llms');
  });
});
