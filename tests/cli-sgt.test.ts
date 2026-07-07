/**
 * Built-CLI tests for the `aot sgt` bridge group: route materialization,
 * idempotent re-route, supersede/restore semantics, judge supports/refutes
 * polarity propagation, SGT_UNAVAILABLE paths (I1), and pipeline re-entry
 * (I2: analyze/graph over colon-and-long-slug atom ids).
 *
 * Isolation: every test points AOT_STATE at a per-test temp file — the
 * default ~/.local/state/aot-cli/state.json is never touched. SGT_BIN points
 * at POSIX #!/bin/sh fixtures (I5: no corpus in repo); chmod +x re-applied in
 * beforeAll because the executable bit does not reliably survive npm pack.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sgtNamespace } from '../src/sgt-bridge.js';
import { requireBuild } from './helpers/sgt-cli-harness.js';

// Fail fast (never skip) when the CLI has not been built — `npm test` builds
// first via the pretest hook, so a clean checkout passes without manual steps.
requireBuild();

const CLI_PATH = path.resolve(__dirname, '..', 'build', 'cli.js');
const FIXTURES = path.resolve(__dirname, 'fixtures', 'sgt-bin');
const fixture = (name: string): string => path.join(FIXTURES, name);

const QUERY = 'deploy kubernetes service';
const NS = sgtNamespace(QUERY); // sgt:q{hash}:
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';

let stateDir: string;
let statePath: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  for (const file of fs.readdirSync(FIXTURES)) {
    if (file.endsWith('.sh')) fs.chmodSync(fixture(file), 0o755);
  }
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sgt-test-'));
  statePath = path.join(stateDir, 'state.json');
  env = {
    ...process.env,
    AOT_STATE: statePath,
    AOT_BR_AUTO: '0',
    SGT_BIN: fixture('sgt-ok.sh'),
    SGT_TIMEOUT_MS: '5000',
  };
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync<string>> {
  return spawnSync('node', [CLI_PATH, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
}

function runJson(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  const result = run([...args, '--format', 'json'], extraEnv);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function sessionAtoms(): Record<string, Record<string, unknown>> {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return state.sessions.default.atoms as Record<string, Record<string, unknown>>;
}

function route(extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  return runJson(['sgt', 'route', QUERY, ...extraArgs], extraEnv);
}

describe('aot sgt route (built CLI)', () => {
  it('materializes premise -> chained reasoning -> skill hypotheses with skillRef and tier-mapped confidence', () => {
    const summary = route();
    expect(summary.status).toBe('success');
    expect(summary.namespace).toBe(NS);
    expect(summary.created).toBe(6);
    expect(summary.updated).toBe(0);
    expect(summary.superseded).toBe(0);
    expect(summary.planChanged).toBe(true);

    const atoms = sessionAtoms();
    const premise = atoms[`${NS}p`];
    expect(premise).toMatchObject({ atomType: 'premise', content: QUERY, confidence: 0.95, dependencies: [] });

    const rDomain = atoms[`${NS}r:domain`];
    const rCapability = atoms[`${NS}r:capability`];
    expect(rDomain.dependencies).toEqual([`${NS}p`]);
    expect(rCapability.dependencies).toEqual([`${NS}r:domain`]);
    expect(rDomain.confidence).toBeCloseTo(0.8285, 3);
    expect(String(rDomain.content)).toContain('domain: Infrastructure/DevOps/Deployment (7114->412)');

    const h1 = atoms[`${NS}h:${LONG_SLUG}`];
    const h2 = atoms[`${NS}h:k8s-manifest-generator`];
    const h3 = atoms[`${NS}h:sparse-notes-skill`];
    for (const hypothesis of [h1, h2, h3]) {
      expect(hypothesis.atomType).toBe('hypothesis');
      expect(hypothesis.dependencies).toEqual([`${NS}r:capability`]); // last reasoning atom
    }
    expect(h1.confidence).toBe(0.70);
    expect(h1.skillRef).toEqual({ slug: LONG_SLUG, source: 'sgt', score: 119.07 });
    expect(h2.confidence).toBe(0.66);
    expect(h2.skillRef).toEqual({ slug: 'k8s-manifest-generator', source: 'sgt', score: 41 });
    expect(h3.confidence).toBe(0.60);
    expect(h3.skillRef).toEqual({ slug: 'sparse-notes-skill', source: 'sgt' });
  });

  it('honors --confidence for the premise', () => {
    route(['--confidence', '0.9']);
    expect(sessionAtoms()[`${NS}p`].confidence).toBe(0.9);
  });

  it('is idempotent: identical re-route reports zero changes and leaves the state file byte-identical', () => {
    route();
    const before = fs.readFileSync(statePath, 'utf8');
    const second = route();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.superseded).toBe(0);
    expect(second.planChanged).toBe(false);
    // Same ids, count, content, confidence, created timestamps, skillRef.
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('normalized query variants share one namespace (no duplicate atoms)', () => {
    route();
    const variant = runJson(['sgt', 'route', 'Deploy  Kubernetes Service ']);
    expect(variant.namespace).toBe(NS);
    // Only the premise/hypothesis contents change (raw query casing).
    expect(variant.created).toBe(0);
    expect(variant.superseded).toBe(0);
    expect(Object.keys(sessionAtoms()).filter(id => id.startsWith('sgt:')).length).toBe(6);
  });

  it('skillRef survives a full save/load round-trip of the CLI state file', () => {
    route();
    // Fresh process: `show` reads state from disk.
    const shown = runJson(['show', `${NS}h:${LONG_SLUG}`]);
    const atom = shown.atom as Record<string, unknown>;
    expect(atom.skillRef).toEqual({ slug: LONG_SLUG, source: 'sgt', score: 119.07 });
  });
});

describe('aot sgt route re-route/supersede semantics (built CLI)', () => {
  it('supersedes drop-outs exactly once, creates additions, and restores on route back', () => {
    route();
    const h2Id = `${NS}h:k8s-manifest-generator`;
    const rCapId = `${NS}r:capability`;

    // v2 plan: capability axis + k8s-manifest-generator dropped; maintainx added.
    const v2 = route([], { SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(v2.planChanged).toBe(true);
    expect(v2.created).toBe(1); // maintainx-deploy-integration
    expect(v2.superseded).toBe(2); // r:capability + h:k8s-manifest-generator
    let atoms = sessionAtoms();
    expect(atoms[`${NS}h:maintainx-deploy-integration`].confidence).toBe(0.70); // score 92.74
    expect(String(atoms[h2Id].content).startsWith('[superseded by re-route] ')).toBe(true);
    expect(atoms[h2Id].confidence).toBe(0.35); // min(0.66, 0.35)
    expect(String(atoms[rCapId].content).startsWith('[superseded by re-route] ')).toBe(true);
    // Hypotheses now hang off the surviving last reasoning atom.
    expect(atoms[`${NS}h:sparse-notes-skill`].dependencies).toEqual([`${NS}r:domain`]);

    // Running v2 again: no double prefix, nothing superseded again.
    const v2Again = route([], { SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(v2Again.superseded).toBe(0);
    expect(v2Again.created).toBe(0);
    expect(v2Again.updated).toBe(0);
    expect(v2Again.planChanged).toBe(false);
    atoms = sessionAtoms();
    expect(String(atoms[h2Id].content).match(/\[superseded by re-route\] /g)).toHaveLength(1);

    // Route back to v1: superseded atoms are restored (prefix removed,
    // confidence re-mapped); maintainx is superseded in turn.
    const v1Again = route();
    expect(v1Again.planChanged).toBe(true);
    atoms = sessionAtoms();
    expect(String(atoms[h2Id].content).startsWith('[superseded by re-route] ')).toBe(false);
    expect(atoms[h2Id].confidence).toBe(0.66);
    expect(String(atoms[rCapId].content).startsWith('[superseded by re-route] ')).toBe(false);
    expect(String(atoms[`${NS}h:maintainx-deploy-integration`].content).startsWith('[superseded by re-route] ')).toBe(true);
  });

  it('never restores a refuted hypothesis (verdicts outrank re-routes)', () => {
    route();
    runJson(['sgt', 'judge', 'k8s-manifest-generator', '--refutes=true']);
    route([], { SGT_BIN: fixture('sgt-ok-v2.sh') }); // drops the refuted hypothesis -> prefix applies, flags untouched
    let atom = sessionAtoms()[`${NS}h:k8s-manifest-generator`];
    expect(atom.isRefuted).toBe(true);

    const back = route(); // plan contains it again, but it stays as judged
    expect((back.preservedIds as string[] | undefined) ?? []).toContain(`${NS}h:k8s-manifest-generator`);
    atom = sessionAtoms()[`${NS}h:k8s-manifest-generator`];
    expect(atom.isRefuted).toBe(true);
    expect(atom.isVerified).toBe(false);
  });
});

describe('aot sgt judge (built CLI)', () => {
  beforeEach(() => {
    route();
  });

  it('judge --supports creates the j: atom and verifies the hypothesis via verifyAtom propagation', () => {
    const result = runJson(['sgt', 'judge', LONG_SLUG, '--supports=true', '--evidence', 'notes/proof.md']);
    expect(result.atomId).toBe(`${NS}j:${LONG_SLUG}:supports`);
    expect(result.hypothesisId).toBe(`${NS}h:${LONG_SLUG}`);
    expect((result.hypothesis as Record<string, unknown>).isVerified).toBe(true);

    const atoms = sessionAtoms();
    const judge = atoms[`${NS}j:${LONG_SLUG}:supports`];
    expect(judge).toMatchObject({
      atomType: 'verification',
      polarity: 'supports',
      isVerified: true,
      confidence: 0.85,
      dependencies: [`${NS}h:${LONG_SLUG}`],
      evidence: ['notes/proof.md'],
    });
    expect(atoms[`${NS}h:${LONG_SLUG}`].isVerified).toBe(true);
  });

  it('judge --pending creates an unverified scaffold that does not propagate', () => {
    const result = runJson(['sgt', 'judge', LONG_SLUG, '--supports=true', '--pending=true']);
    expect((result.hypothesis as Record<string, unknown>).isVerified).toBe(false);
    const atoms = sessionAtoms();
    expect(atoms[`${NS}j:${LONG_SLUG}:supports`].isVerified).toBe(false);
    expect(atoms[`${NS}h:${LONG_SLUG}`].isVerified).toBe(false);
  });

  it('judge --refutes marks the hypothesis refuted (mutually exclusive with verified) and re-judging is idempotent', () => {
    const first = runJson(['sgt', 'judge', 'k8s-manifest-generator', '--refutes=true']);
    expect(first.atomId).toBe(`${NS}j:k8s-manifest-generator:refutes`);
    expect((first.hypothesis as Record<string, unknown>).isRefuted).toBe(true);
    let atoms = sessionAtoms();
    expect(atoms[`${NS}h:k8s-manifest-generator`].isRefuted).toBe(true);
    expect(atoms[`${NS}h:k8s-manifest-generator`].isVerified).toBe(false);

    // Same slug + polarity: updates the existing j: atom, never a duplicate.
    const again = runJson(['sgt', 'judge', 'k8s-manifest-generator', '--refutes=true', '--confidence', '0.95']);
    expect(again.rejudged).toBe(true);
    atoms = sessionAtoms();
    const judgeAtoms = Object.keys(atoms).filter(id => id.startsWith(`${NS}j:k8s-manifest-generator:`));
    expect(judgeAtoms).toEqual([`${NS}j:k8s-manifest-generator:refutes`]);
    expect(atoms[`${NS}j:k8s-manifest-generator:refutes`].confidence).toBe(0.95);
  });

  it('opposite polarity creates the sibling j: atom and aot analyze surfaces the contradiction (I2)', () => {
    runJson(['sgt', 'judge', LONG_SLUG, '--refutes=true']);
    runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
    const atoms = sessionAtoms();
    expect(atoms[`${NS}j:${LONG_SLUG}:refutes`]).toBeDefined();
    expect(atoms[`${NS}j:${LONG_SLUG}:supports`]).toBeDefined();

    const analysis = runJson(['analyze']);
    const contradictions = analysis.contradictions as Array<Record<string, unknown>>;
    expect(contradictions.map(c => c.atomId)).toContain(`${NS}h:${LONG_SLUG}`);
  });

  it('re-running the identical route never overwrites a judged hypothesis (epistemic protection)', () => {
    runJson(['sgt', 'judge', 'k8s-manifest-generator', '--refutes=true']);
    const before = sessionAtoms()[`${NS}h:k8s-manifest-generator`];

    const rerouted = route();
    expect((rerouted.preservedIds as string[] | undefined) ?? []).toContain(`${NS}h:k8s-manifest-generator`);
    const after = sessionAtoms()[`${NS}h:k8s-manifest-generator`];
    expect(after.isRefuted).toBe(true);
    expect(after.content).toBe(before.content);
    expect(after.confidence).toBe(before.confidence);
    expect(after.skillRef).toEqual(before.skillRef);
  });

  it('rejects non-hypothesis targets, unknown slugs, and missing polarity', () => {
    const notHypothesis = run(['sgt', 'judge', `${NS}p`, '--supports=true', '--format', 'json']);
    expect(notHypothesis.status).not.toBe(0);
    expect(`${notHypothesis.stdout}${notHypothesis.stderr}`).toContain('SGT_NOT_HYPOTHESIS');

    const unknown = run(['sgt', 'judge', 'no-such-skill', '--supports=true', '--format', 'json']);
    expect(unknown.status).not.toBe(0);
    expect(`${unknown.stdout}${unknown.stderr}`).toContain('SGT_HYPOTHESIS_NOT_FOUND');

    const noPolarity = run(['sgt', 'judge', LONG_SLUG, '--format', 'json']);
    expect(noPolarity.status).not.toBe(0);
    expect(`${noPolarity.stdout}${noPolarity.stderr}`).toContain('MISSING_POLARITY');
  });

  it('errors on a bare slug matching hypotheses under multiple query hashes, listing candidate full ids', () => {
    // Same fixture plan for a different query -> same slugs under a second namespace.
    const otherNs = sgtNamespace('containerize the app');
    runJson(['sgt', 'route', 'containerize the app']);

    const ambiguous = run(['sgt', 'judge', LONG_SLUG, '--supports=true', '--format', 'json']);
    expect(ambiguous.status).not.toBe(0);
    const output = `${ambiguous.stdout}${ambiguous.stderr}`;
    expect(output).toContain('SGT_AMBIGUOUS_SLUG');
    expect(output).toContain(`${NS}h:${LONG_SLUG}`);
    expect(output).toContain(`${otherNs}h:${LONG_SLUG}`);

    // The full atom id disambiguates, and the j: atom derives its namespace
    // from the resolved hypothesis, never by re-hashing.
    const resolved = runJson(['sgt', 'judge', `${otherNs}h:${LONG_SLUG}`, '--supports=true']);
    expect(resolved.atomId).toBe(`${otherNs}j:${LONG_SLUG}:supports`);
  });
});

describe('SGT_UNAVAILABLE paths (I1) leave state untouched', () => {
  function expectStateUnchangedAfter(extraEnv: NodeJS.ProcessEnv, expectedDetail: string): void {
    runJson(['fast', 'premise', 'P1', 'seed atom']); // ensure a state file exists
    const before = fs.readFileSync(statePath, 'utf8');
    const result = run(['sgt', 'route', QUERY, '--format', 'json'], extraEnv);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('SGT_UNAVAILABLE');
    expect(output).toContain(expectedDetail);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before); // byte-identical
  }

  it('SGT_BIN pointing at a missing binary -> SGT_NOT_FOUND', () => {
    expectStateUnchangedAfter({ SGT_BIN: '/nonexistent/binary' }, 'SGT_NOT_FOUND');
  });

  it('SGT_BIN unset and no sgt on PATH -> SGT_NOT_FOUND', () => {
    const cleanEnv = { ...env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
    delete cleanEnv.SGT_BIN;
    runJson(['fast', 'premise', 'P1', 'seed atom']);
    const before = fs.readFileSync(statePath, 'utf8');
    const result = spawnSync('node', [CLI_PATH, 'sgt', 'route', QUERY, '--format', 'json'], { env: cleanEnv, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SGT_UNAVAILABLE');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('exit error -> SGT_EXIT_ERROR, no partial materialization despite valid stdout JSON', () => {
    expectStateUnchangedAfter({ SGT_BIN: fixture('sgt-exit-error.sh') }, 'SGT_EXIT_ERROR');
  });

  it('bad JSON -> SGT_BAD_JSON', () => {
    expectStateUnchangedAfter({ SGT_BIN: fixture('sgt-bad-json.sh') }, 'SGT_BAD_JSON');
  });

  it('schema mismatch -> SGT_SCHEMA_MISMATCH', () => {
    expectStateUnchangedAfter({ SGT_BIN: fixture('sgt-schema-mismatch.sh') }, 'SGT_SCHEMA_MISMATCH');
  });

  it('timeout (SGT_TIMEOUT_MS=200) -> SGT_TIMEOUT with no partial atoms', () => {
    expectStateUnchangedAfter({ SGT_BIN: fixture('sgt-slow.sh'), SGT_TIMEOUT_MS: '200' }, 'SGT_TIMEOUT');
  }, 20_000);

  it('non-sgt commands are unaffected by a missing sgt binary', () => {
    const result = runJson(['fast', 'premise', 'P1', 'works fine'], { SGT_BIN: '/nonexistent/binary' });
    expect(result.atomId).toBe('P1');
  });
});

describe('bridge atoms re-enter the standard pipeline (I2)', () => {
  beforeEach(() => {
    route();
    runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
  });

  it('aot analyze runs clean over colon-and-long-slug atom ids', () => {
    const analysis = runJson(['analyze']);
    expect(analysis.source).toBe('session:default');
    const order = analysis.topologicalOrder as string[] | undefined;
    if (order) expect(order).toContain(`${NS}h:${LONG_SLUG}`);
  });

  it('aot graph renders tree, mermaid, and dot without error', () => {
    for (const graphFormat of ['tree', 'mermaid', 'dot'] as const) {
      const result = run(['graph', '--graphFormat', graphFormat]);
      expect(result.status, `${graphFormat}: ${result.stderr}`).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).toContain(LONG_SLUG);
    }
  });

  it('aot export carries the sgt atoms as ordinary atoms', () => {
    const exported = runJson(['export']);
    const graph = exported.graph as { nodes: Array<{ id: string }> };
    expect(graph.nodes.map(n => n.id)).toContain(`${NS}h:${LONG_SLUG}`);
  });
});
