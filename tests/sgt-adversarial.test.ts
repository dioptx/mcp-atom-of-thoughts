/**
 * Round-3 adversarial edge suite for the sgt bridge (built CLI): empty
 * packets, unresolved/ambiguous slugs, opposite-polarity verdict siblings,
 * mid-chain bridge failures, superseded-scaffold revival, and the pinned
 * []-vs-undefined matchedTokens idempotency — every failure path asserted
 * byte-identical on state.json.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sgtNamespace } from '../src/sgt-bridge.js';
import { chmodFixtures, createHarness, fixture, requireBuild, type SgtCliHarness } from './helpers/sgt-cli-harness.js';

requireBuild();

const QUERY = 'deploy kubernetes service';
const NS = sgtNamespace(QUERY);
const SLUG = 'k8s-manifest-generator';
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';
const NO_BIN = { SGT_BIN: '/nonexistent/binary' };

let h: SgtCliHarness;

beforeAll(() => {
  chmodFixtures();
});

beforeEach(() => {
  h = createHarness('aot-sgt-adversarial-test-');
});

afterEach(() => {
  h.cleanup();
});

/** Run a command expected to fail, asserting state.json bytes never change. */
function expectFailureLeavesStateUntouched(args: string[], extraEnv: NodeJS.ProcessEnv, ...expectedFragments: string[]): string {
  const before = h.snapshotState();
  const result = h.run([...args, '--format', 'json'], extraEnv);
  expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  const output = `${result.stdout}${result.stderr}`;
  for (const fragment of expectedFragments) expect(output).toContain(fragment);
  h.expectStateBytes(before);
  return output;
}

describe('empty-packet pack (fully resolved, nothing disclosed)', () => {
  it('yields the pinned zero-excerpt scaffold with empty evidence and a valid state file', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const result = h.runJson(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-pack-empty.sh') });
    expect(result.status).toBe('success');
    expect(result.excerptCount).toBe(0);
    expect(result.evidence).toEqual([]);
    expect(result.excerpts).toEqual([]);
    expect(result.references).toEqual([]);

    const scaffold = h.sessionAtoms()[`${NS}e:${SLUG}`];
    expect(scaffold.content).toBe(`sgt expand: ${SLUG} (0 excerpts, budget 1200)`);
    expect(scaffold.evidence).toBeUndefined(); // nothing disclosed, nothing cited
    expect(scaffold.confidence).toBe(0.70);

    // State is valid: subsequent reads and the advise loop keep working.
    const advise = h.runJson(['sgt', 'advise'], NO_BIN);
    expect((advise.advice as Array<{ slug: string; action: string }>).some(entry => entry.slug === SLUG && entry.action === 'judge')).toBe(true);
    expect(h.run(['analyze', '--format', 'json'], NO_BIN).status).toBe(0);
  });
});

describe('unresolved and ambiguous slugs', () => {
  it('unresolved slug -> SGT_SLUG_UNRESOLVED, state bytes unchanged', () => {
    h.runJson(['sgt', 'route', QUERY]);
    expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], { SGT_BIN: fixture('sgt-pack-unresolved.sh') }, 'SGT_SLUG_UNRESOLVED');
  });

  it('bare slug under two query hashes -> SGT_AMBIGUOUS_SLUG listing BOTH full atom ids', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const otherNs = sgtNamespace('containerize the app');
    h.runJson(['sgt', 'route', 'containerize the app']);
    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', SLUG], {}, 'SGT_AMBIGUOUS_SLUG');
    expect(output).toContain(`${NS}h:${SLUG}`);
    expect(output).toContain(`${otherNs}h:${SLUG}`);
  });
});

describe('opposite-polarity verdict siblings', () => {
  it('surface as a contradiction in aot analyze (I2)', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'judge', LONG_SLUG, '--refutes=true']);
    h.runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
    const analysis = h.runJson(['analyze'], NO_BIN);
    const contradictions = analysis.contradictions as Array<{ atomId: string }>;
    expect(contradictions.map(c => c.atomId)).toContain(`${NS}h:${LONG_SLUG}`);
  });
});

describe('mid-chain bridge failures leave state byte-identical', () => {
  it('exit-error fixture mid-chain (after route -> expand -> judge) never partially materializes', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'expand', SLUG]);
    h.runJson(['sgt', 'judge', SLUG, '--supports=true']);
    expectFailureLeavesStateUntouched(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-exit-error.sh') }, 'SGT_UNAVAILABLE', 'SGT_EXIT_ERROR');
    expectFailureLeavesStateUntouched(['sgt', 'expand', LONG_SLUG], { SGT_BIN: fixture('sgt-bad-json.sh') }, 'SGT_UNAVAILABLE', 'SGT_BAD_JSON');
  });
});

describe('expand-after-superseded-revival', () => {
  it('v2 drop -> v1 restore -> fresh expand revives the scaffold via updateAtom (created timestamp preserved)', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'expand', SLUG]);
    const createdAt = h.sessionAtoms()[`${NS}e:${SLUG}`].created;

    h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') }); // drops SLUG: h+e superseded
    h.runJson(['sgt', 'route', QUERY]); // restores h; e stays superseded
    let scaffold = h.sessionAtoms()[`${NS}e:${SLUG}`];
    expect(String(scaffold.content).startsWith('[superseded by re-route] ')).toBe(true);

    const revive = h.runJson(['sgt', 'expand', SLUG]);
    expect(revive.created).toBe(false); // updateAtom path, never processAtom overwrite
    expect(revive.packChanged).toBe(true);
    scaffold = h.sessionAtoms()[`${NS}e:${SLUG}`];
    expect(scaffold.content).toBe(`sgt expand: ${SLUG} (2 excerpts, budget 1200)`);
    expect(scaffold.confidence).toBe(0.70);
    expect(scaffold.created).toBe(createdAt);
  });
});

describe('matchedTokens []-vs-undefined idempotency (skillRefEquals)', () => {
  it('a re-route that adds missingTokens: [] updates exactly once, then identical re-routes are byte-quiet', () => {
    h.runJson(['sgt', 'route', QUERY]); // v1: no token arrays at all (undefined)
    const first = h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-empty-tokens.sh') });
    // [] is a DISTINCT state from undefined (spec §2c): exactly one update.
    expect(first.planChanged).toBe(true);
    expect(first.updated).toBe(1);
    expect(first.updatedIds).toEqual([`${NS}h:${SLUG}`]);
    expect((h.sessionAtoms()[`${NS}h:${SLUG}`].skillRef as Record<string, unknown>).missingTokens).toEqual([]);

    const before = h.snapshotState();
    const quiet = h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-empty-tokens.sh') });
    expect(quiet.planChanged).toBe(false);
    expect(quiet.created).toBe(0);
    expect(quiet.updated).toBe(0);
    expect(quiet.superseded).toBe(0);
    h.expectStateBytes(before);
  });
});

describe('refusal precedence with zero subprocess (SGT_BIN=/nonexistent)', () => {
  it('simultaneously superseded + refuted hypothesis refuses with "refuted" (refuted > superseded), never SGT_UNAVAILABLE', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'judge', SLUG, '--refutes=true']);
    h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') }); // drops the refuted hypothesis
    const output = expectFailureLeavesStateUntouched(['sgt', 'expand', `${NS}h:${SLUG}`], NO_BIN, 'SGT_EXPAND_REFUSED', 'refuted');
    expect(output).not.toContain('superseded');
    expect(output).not.toContain('SGT_UNAVAILABLE');
  });
});
