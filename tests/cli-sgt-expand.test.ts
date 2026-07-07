/**
 * Built-CLI tests for `aot sgt expand` (round 2 progressive disclosure):
 * refusal matrix (refuted/verified/superseded, gated BEFORE any subprocess),
 * e:{slug} scaffold creation + diff-idempotency, supersede interplay with
 * re-routes, judge evidence inheritance, SGT_UNAVAILABLE byte-identical
 * failure paths, and the route -> expand -> judge -> advise workflow chain.
 *
 * Isolation matches tests/cli-sgt.test.ts: per-test AOT_STATE temp file,
 * POSIX #!/bin/sh fixture SGT_BINs, chmod +x re-applied in beforeAll.
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
const NS = sgtNamespace(QUERY);
const SLUG = 'k8s-manifest-generator';
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';
const SCAFFOLD_EVIDENCE = [
  `sgt:packet:${SLUG}:trigger-when:0`,
  `sgt:packet:${SLUG}:usage:1`,
  `sgt:ref:${SLUG}:references:SKILL.md`,
  `sgt:ref:${SLUG}:scripts:render.sh`,
];

let stateDir: string;
let statePath: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  for (const file of fs.readdirSync(FIXTURES)) {
    if (file.endsWith('.sh')) fs.chmodSync(fixture(file), 0o755);
  }
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sgt-expand-test-'));
  statePath = path.join(stateDir, 'state.json');
  env = {
    ...process.env,
    AOT_STATE: statePath,
    AOT_BR_AUTO: '0',
    SGT_BIN: fixture('sgt-dispatch.sh'),
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

function route(extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  return runJson(['sgt', 'route', QUERY], extraEnv);
}

function expand(target: string, extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  return runJson(['sgt', 'expand', target, ...extraArgs], extraEnv);
}

/** Run a command expected to fail, asserting the state file never changes. */
function expectFailureLeavesStateUntouched(args: string[], extraEnv: NodeJS.ProcessEnv, ...expectedFragments: string[]): string {
  const before = fs.readFileSync(statePath, 'utf8');
  const result = run([...args, '--format', 'json'], extraEnv);
  expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  const output = `${result.stdout}${result.stderr}`;
  for (const fragment of expectedFragments) expect(output).toContain(fragment);
  expect(fs.readFileSync(statePath, 'utf8')).toBe(before); // byte-identical
  return output;
}

describe('aot sgt expand success path (built CLI)', () => {
  beforeEach(() => {
    route();
  });

  it('creates the pinned e:{slug} scaffold: verification, dep on the hypothesis, confidence 0.70, unverified, no polarity, provenance evidence', () => {
    const result = expand(SLUG);
    expect(result.status).toBe('success');
    expect(result.atomId).toBe(`${NS}e:${SLUG}`);
    expect(result.hypothesisId).toBe(`${NS}h:${SLUG}`);
    expect(result.created).toBe(true);
    expect(result.packChanged).toBe(true);
    expect(result.excerptCount).toBe(2);
    expect(result.budget).toBe(1200);

    const scaffold = sessionAtoms()[`${NS}e:${SLUG}`];
    expect(scaffold).toMatchObject({
      atomType: 'verification',
      dependencies: [`${NS}h:${SLUG}`],
      confidence: 0.70,
      isVerified: false,
      content: `sgt expand: ${SLUG} (2 excerpts, budget 1200)`,
      evidence: SCAFFOLD_EVIDENCE,
    });
    expect('polarity' in scaffold).toBe(false); // NO polarity ever on the scaffold
    expect(scaffold.evidence).toContain(`sgt:packet:${SLUG}:trigger-when:0`);
    expect(scaffold.evidence).toContain(`sgt:ref:${SLUG}:references:SKILL.md`);
    // The hypothesis itself stays unsettled: disclosure is not a verdict.
    expect(sessionAtoms()[`${NS}h:${SLUG}`].isVerified).toBe(false);
  });

  it('stdout surfaces excerpts, references, and omittedDueToBudget', () => {
    const result = expand(SLUG);
    const excerpts = result.excerpts as Array<Record<string, unknown>>;
    expect(excerpts.map(e => e.heading)).toEqual(['Trigger & When', 'Usage']);
    expect(String(excerpts[0].excerpt)).toContain('Kubernetes Deployment');
    const references = result.references as Array<Record<string, unknown>>;
    expect(references.map(r => r.path)).toEqual([
      `store/${SLUG}/references/SKILL.md`,
      `store/${SLUG}/scripts/render.sh`,
    ]);
    expect(result.omittedDueToBudget).toEqual(['sparse-notes-skill']);
    expect(result.contextDeferred).toBeUndefined(); // this packet was fully disclosed
  });

  it('surfaces contextDeferred + omittedReason when sgt deferred the packet body', () => {
    const result = expand(LONG_SLUG);
    expect(result.contextDeferred).toBe(true);
    expect(result.omittedReason).toBe('excerpt packet exceeds requested budget');
    expect(result.excerptCount).toBe(0);
    expect(sessionAtoms()[`${NS}e:${LONG_SLUG}`].evidence).toBeUndefined(); // nothing disclosed, nothing cited
  });

  it('re-expand with an identical pack is diff-idempotent: packChanged false, state file byte-identical', () => {
    expand(SLUG);
    const before = fs.readFileSync(statePath, 'utf8');
    const second = expand(SLUG);
    expect(second.created).toBe(false);
    expect(second.packChanged).toBe(false);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('re-expand with a CHANGED pack updates in place (updateAtom, never a processAtom overwrite)', () => {
    expand(SLUG);
    const createdAt = sessionAtoms()[`${NS}e:${SLUG}`].created;
    const changed = expand(SLUG, [], { SGT_BIN: fixture('sgt-pack-changed.sh') });
    expect(changed.created).toBe(false);
    expect(changed.packChanged).toBe(true);
    expect(changed.excerptCount).toBe(1);
    const scaffold = sessionAtoms()[`${NS}e:${SLUG}`];
    expect(scaffold.content).toBe(`sgt expand: ${SLUG} (1 excerpts, budget 1200)`);
    expect(scaffold.evidence).toEqual([
      `sgt:packet:${SLUG}:trigger-when:0`,
      `sgt:ref:${SLUG}:references:SKILL.md`,
      `sgt:ref:${SLUG}:scripts:render.sh`,
    ]);
    // updateAtom preserves creation metadata; an overwrite would reset it.
    expect(scaffold.created).toBe(createdAt);
    expect(scaffold.confidence).toBe(0.70);
  });

  it('honors --budget in the scaffold content and result', () => {
    const result = expand(SLUG, ['--budget', '600']);
    expect(result.budget).toBe(600);
    expect(sessionAtoms()[`${NS}e:${SLUG}`].content).toBe(`sgt expand: ${SLUG} (2 excerpts, budget 600)`);
  });
});

describe('aot sgt expand refusal matrix (no subprocess: SGT_BIN=/nonexistent)', () => {
  const NO_BIN = { SGT_BIN: '/nonexistent/binary' };

  beforeEach(() => {
    route();
  });

  it('refuted hypothesis -> SGT_EXPAND_REFUSED containing "refuted", never SGT_UNAVAILABLE, state byte-identical', () => {
    runJson(['sgt', 'judge', SLUG, '--refutes=true']);
    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], NO_BIN, 'SGT_EXPAND_REFUSED', 'refuted');
    expect(output).not.toContain('SGT_UNAVAILABLE');
  });

  it('verified hypothesis -> SGT_EXPAND_REFUSED containing "verified"', () => {
    runJson(['sgt', 'judge', SLUG, '--supports=true']);
    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], NO_BIN, 'SGT_EXPAND_REFUSED', 'verified');
    expect(output).not.toContain('SGT_UNAVAILABLE');
  });

  it('superseded hypothesis (dropped by a re-route) -> SGT_EXPAND_REFUSED containing "superseded"', () => {
    route({ SGT_BIN: fixture('sgt-ok-v2.sh') }); // v2 plan drops k8s-manifest-generator
    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', `${NS}h:${SLUG}`], NO_BIN, 'SGT_EXPAND_REFUSED', 'superseded');
    expect(output).not.toContain('SGT_UNAVAILABLE');
  });

  it('precedence: refuted beats superseded, verified beats superseded', () => {
    runJson(['sgt', 'judge', SLUG, '--refutes=true']);
    route({ SGT_BIN: fixture('sgt-ok-v2.sh') }); // drops the refuted hypothesis: prefix applies, flags stay
    const refutedOut = expectFailureLeavesStateUntouched(['sgt', 'expand', `${NS}h:${SLUG}`], NO_BIN, 'SGT_EXPAND_REFUSED', 'refuted');
    expect(refutedOut).not.toContain('superseded');

    runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
    route({ SGT_BIN: fixture('sgt-ok-v2.sh') });
    const verifiedOut = expectFailureLeavesStateUntouched(['sgt', 'expand', `${NS}h:${LONG_SLUG}`], NO_BIN, 'SGT_EXPAND_REFUSED', 'verified');
    expect(verifiedOut).not.toContain('superseded');
  });
});

describe('aot sgt expand resolver parity with judge', () => {
  beforeEach(() => {
    route();
  });

  it('bare slug under two query hashes -> SGT_AMBIGUOUS_SLUG listing both full ids; full id succeeds', () => {
    const otherNs = sgtNamespace('containerize the app');
    runJson(['sgt', 'route', 'containerize the app']);

    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], {}, 'SGT_AMBIGUOUS_SLUG');
    expect(output).toContain(`${NS}h:${SLUG}`);
    expect(output).toContain(`${otherNs}h:${SLUG}`);

    const resolved = expand(`${otherNs}h:${SLUG}`);
    expect(resolved.atomId).toBe(`${otherNs}e:${SLUG}`);
    expect(resolved.hypothesisId).toBe(`${otherNs}h:${SLUG}`);
  });

  it('non-hypothesis target -> SGT_NOT_HYPOTHESIS; unknown -> SGT_HYPOTHESIS_NOT_FOUND', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', `${NS}p`], {}, 'SGT_NOT_HYPOTHESIS');
    expectFailureLeavesStateUntouched(['sgt', 'expand', 'no-such-skill'], {}, 'SGT_HYPOTHESIS_NOT_FOUND');
  });
});

describe('aot sgt expand bridge failures leave state byte-identical (I1)', () => {
  beforeEach(() => {
    route();
  });

  it('unresolved slug (valid JSON, packets:[]) -> SGT_SLUG_UNRESOLVED', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-pack-unresolved.sh') }, 'SGT_SLUG_UNRESOLVED');
  });

  it('exit error -> SGT_UNAVAILABLE/SGT_EXIT_ERROR (non-zero exit wins over valid stdout)', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-exit-error.sh') }, 'SGT_UNAVAILABLE', 'SGT_EXIT_ERROR');
  });

  it('bad JSON -> SGT_UNAVAILABLE/SGT_BAD_JSON', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-bad-json.sh') }, 'SGT_UNAVAILABLE', 'SGT_BAD_JSON');
  });

  it('schema mismatch -> SGT_UNAVAILABLE/SGT_SCHEMA_MISMATCH', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-schema-mismatch.sh') }, 'SGT_UNAVAILABLE', 'SGT_SCHEMA_MISMATCH');
  });

  it('timeout -> SGT_UNAVAILABLE/SGT_TIMEOUT via kill/signal classification', () => {
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-slow.sh'), SGT_TIMEOUT_MS: '200' }, 'SGT_UNAVAILABLE', 'SGT_TIMEOUT');
  }, 20_000);
});

describe('re-route interplay with e:{slug} scaffolds', () => {
  beforeEach(() => {
    route();
    expand(SLUG);
  });

  it('route -> expand -> byte-identical re-route: planChanged false, scaffold untouched (supersede exempts live scaffolds)', () => {
    const before = fs.readFileSync(statePath, 'utf8');
    const second = route();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.superseded).toBe(0);
    expect(second.planChanged).toBe(false);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
    const scaffold = sessionAtoms()[`${NS}e:${SLUG}`];
    expect(String(scaffold.content).startsWith('[superseded by re-route] ')).toBe(false);
    expect(scaffold.confidence).toBe(0.70);
  });

  it('a re-route that DROPS the slug supersedes both h:{slug} and e:{slug} (prefix once, confidence min(prev, 0.35))', () => {
    const v2 = route({ SGT_BIN: fixture('sgt-ok-v2.sh') });
    const supersededIds = (v2.supersededIds as string[] | undefined) ?? [];
    expect(supersededIds).toContain(`${NS}h:${SLUG}`);
    expect(supersededIds).toContain(`${NS}e:${SLUG}`);

    let atoms = sessionAtoms();
    expect(String(atoms[`${NS}h:${SLUG}`].content).startsWith('[superseded by re-route] ')).toBe(true);
    expect(String(atoms[`${NS}e:${SLUG}`].content).startsWith('[superseded by re-route] ')).toBe(true);
    expect(atoms[`${NS}h:${SLUG}`].confidence).toBe(0.35);
    expect(atoms[`${NS}e:${SLUG}`].confidence).toBe(0.35);

    // Re-running v2 is quiet: no double prefix, nothing superseded again.
    const v2Again = route({ SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(v2Again.superseded).toBe(0);
    expect(v2Again.planChanged).toBe(false);
    atoms = sessionAtoms();
    expect(String(atoms[`${NS}e:${SLUG}`].content).match(/\[superseded by re-route\] /g)).toHaveLength(1);
  });

  it('routing back restores the hypothesis, and a re-expand revives the superseded scaffold via updateAtom', () => {
    route({ SGT_BIN: fixture('sgt-ok-v2.sh') });
    route(); // hypothesis restored; scaffold stays superseded until re-expanded
    let scaffold = sessionAtoms()[`${NS}e:${SLUG}`];
    expect(String(scaffold.content).startsWith('[superseded by re-route] ')).toBe(true);

    const redo = expand(SLUG);
    expect(redo.created).toBe(false);
    expect(redo.packChanged).toBe(true);
    scaffold = sessionAtoms()[`${NS}e:${SLUG}`];
    expect(scaffold.content).toBe(`sgt expand: ${SLUG} (2 excerpts, budget 1200)`);
    expect(scaffold.confidence).toBe(0.70);
  });
});

describe('judge evidence inheritance from the expand scaffold (creation only)', () => {
  beforeEach(() => {
    route();
    expand(SLUG);
  });

  it('judge --supports with no --evidence inherits the scaffold packet refs in pack order; hypothesis verified exactly once; scaffold untouched', () => {
    const result = runJson(['sgt', 'judge', SLUG, '--supports=true']);
    expect(result.atomId).toBe(`${NS}j:${SLUG}:supports`);
    const atoms = sessionAtoms();
    expect(atoms[`${NS}j:${SLUG}:supports`].evidence).toEqual(SCAFFOLD_EVIDENCE);
    expect(atoms[`${NS}h:${SLUG}`].isVerified).toBe(true);
    // Exactly one judge atom for the slug; the scaffold is NOT promoted.
    expect(Object.keys(atoms).filter(id => id.startsWith(`${NS}j:${SLUG}:`))).toEqual([`${NS}j:${SLUG}:supports`]);
    expect(atoms[`${NS}e:${SLUG}`].isVerified).toBe(false);
    expect('polarity' in atoms[`${NS}e:${SLUG}`]).toBe(false);
  });

  it('explicit --evidence merges AFTER the packet refs, deduped preserving first occurrence', () => {
    runJson(['sgt', 'judge', SLUG, '--supports=true', '--evidence', `notes/x.md,${SCAFFOLD_EVIDENCE[0]}`]);
    expect(sessionAtoms()[`${NS}j:${SLUG}:supports`].evidence).toEqual([
      ...SCAFFOLD_EVIDENCE, // packet refs first, duplicate user ref collapsed into its first occurrence
      'notes/x.md',
    ]);
  });

  it('inheritance applies ONLY at creation: re-judge with --evidence omitted keeps j: evidence unchanged even after a re-expand changed the scaffold', () => {
    // --pending keeps the hypothesis unsettled, so the scaffold can still be
    // re-expanded between the two judge calls (a settled hypothesis refuses).
    runJson(['sgt', 'judge', SLUG, '--supports=true', '--pending=true']);
    expect(sessionAtoms()[`${NS}j:${SLUG}:supports`].evidence).toEqual(SCAFFOLD_EVIDENCE); // inherited at creation
    expand(SLUG, [], { SGT_BIN: fixture('sgt-pack-changed.sh') }); // scaffold now has 3 refs
    expect(sessionAtoms()[`${NS}e:${SLUG}`].evidence).toHaveLength(3);

    const rejudge = runJson(['sgt', 'judge', SLUG, '--supports=true', '--confidence', '0.9']);
    expect(rejudge.rejudged).toBe(true);
    expect(sessionAtoms()[`${NS}j:${SLUG}:supports`].evidence).toEqual(SCAFFOLD_EVIDENCE); // original 4 refs, no re-sync
  });

  it('judge without any scaffold behaves exactly as round 1 (no inheritance source)', () => {
    runJson(['sgt', 'judge', LONG_SLUG, '--supports=true', '--evidence', 'notes/proof.md']);
    expect(sessionAtoms()[`${NS}j:${LONG_SLUG}:supports`].evidence).toEqual(['notes/proof.md']);
  });
});

describe('workflow chain e2e: route -> expand -> judge -> advise -> re-route -> bridge failure', () => {
  it('runs the full metacognitive loop with pinned state at every step', () => {
    // route: hypotheses materialized.
    route();

    // expand: disclosure scaffold with provenance evidence.
    expand(SLUG);
    expect(sessionAtoms()[`${NS}e:${SLUG}`].evidence).toEqual(SCAFFOLD_EVIDENCE);

    // advise now proposes judging the disclosed hypothesis, not expanding it.
    let advise = runJson(['sgt', 'advise']);
    let advice = advise.advice as Array<Record<string, unknown>>;
    const forSlug = advice.filter(entry => entry.slug === SLUG);
    expect(forSlug.map(entry => entry.action)).toEqual(['judge']);

    // judge --supports: verdict inherits the scaffold evidence, hypothesis verified.
    runJson(['sgt', 'judge', SLUG, '--supports=true']);
    expect(sessionAtoms()[`${NS}j:${SLUG}:supports`].evidence).toEqual(SCAFFOLD_EVIDENCE);
    expect(sessionAtoms()[`${NS}h:${SLUG}`].isVerified).toBe(true);

    // advise: expand/judge suggestions for the slug are gone; 'related' appears.
    advise = runJson(['sgt', 'advise']);
    advice = advise.advice as Array<Record<string, unknown>>;
    const related = advice.filter(entry => entry.slug === SLUG);
    expect(related.map(entry => entry.action)).toEqual(['related']);
    expect(related[0].command).toBe(`sgt graph related ${SLUG}`);

    // re-route v2 drops the slug: hypothesis + scaffold superseded, verdict preserved.
    route({ SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(String(sessionAtoms()[`${NS}h:${SLUG}`].content).startsWith('[superseded by re-route] ')).toBe(true);
    expect(sessionAtoms()[`${NS}j:${SLUG}:supports`].isVerified).toBe(true);

    // advise excludes the superseded slug from EVERY tier.
    advise = runJson(['sgt', 'advise']);
    advice = advise.advice as Array<Record<string, unknown>>;
    expect(advice.some(entry => entry.slug === SLUG)).toBe(false);
    // The v2 addition surfaces as the next expand.
    expect(advice.some(entry => entry.action === 'expand' && entry.slug === 'maintainx-deploy-integration')).toBe(true);

    // mid-chain bridge failure leaves the post-re-route state byte-identical.
    expectFailureLeavesStateUntouchedForChain();
  });

  function expectFailureLeavesStateUntouchedForChain(): void {
    const before = fs.readFileSync(statePath, 'utf8');
    const result = run(['sgt', 'expand', 'maintainx-deploy-integration', '--format', 'json'], { SGT_BIN: fixture('sgt-bad-json.sh') });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SGT_UNAVAILABLE');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  }
});
