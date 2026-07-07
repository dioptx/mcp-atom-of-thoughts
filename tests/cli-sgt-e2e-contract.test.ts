/**
 * End-to-end integration contract for the sgt bridge against the BUILT CLI
 * (round 3): the full metacognitive loop route -> advise -> expand -> advise
 * -> judge(refute) -> refusal -> judge(re-support) -> re-route(v2/v1) ->
 * revive -> byte-stable advise, with state.json snapshots at every refusal
 * boundary. Also pins the --help examples for every sgt subcommand and runs
 * the operator smoke script.
 *
 * The refute/re-support cycle runs on LONG_SLUG and the supersede/resurrect
 * cycle on SLUG: once a hypothesis is judged it stays as judged through
 * re-routes (§2b) — resurrect semantics are only observable on an UNJUDGED
 * hypothesis.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { sgtNamespace } from '../src/sgt-bridge.js';
import { chmodFixtures, createHarness, fixture, requireBuild, type SgtCliHarness } from './helpers/sgt-cli-harness.js';

requireBuild();

const QUERY = 'deploy kubernetes service';
const NS = sgtNamespace(QUERY);
const SLUG = 'k8s-manifest-generator';
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';
const NO_BIN = { SGT_BIN: '/nonexistent/binary' };
const SUPERSEDED = '[superseded by re-route] ';

let h: SgtCliHarness;

beforeAll(() => {
  chmodFixtures();
  h = createHarness('aot-sgt-e2e-test-');
});

afterAll(() => {
  h.cleanup();
});

function adviceOf(extraEnv: NodeJS.ProcessEnv = NO_BIN): Array<Record<string, unknown>> {
  return h.runJson(['sgt', 'advise'], extraEnv).advice as Array<Record<string, unknown>>;
}

describe('sgt bridge e2e contract (single sequential loop, built CLI)', () => {
  it('drives route -> advise -> expand -> judge -> refusal -> re-support -> re-route -> revive with pinned state at every step', () => {
    // 1. route: hypotheses materialized.
    const routed = h.runJson(['sgt', 'route', QUERY]);
    expect(routed.created).toBe(6);

    // 2. advise: both eligible hypotheses are tier-1 expands.
    let advice = adviceOf();
    expect(advice.filter(a => a.action === 'expand').map(a => a.slug).sort()).toEqual([SLUG, LONG_SLUG].sort());

    // 3. expand SLUG: disclosure scaffold created.
    const expanded = h.runJson(['sgt', 'expand', SLUG]);
    expect(expanded.created).toBe(true);

    // 4. advise: SLUG advanced to tier-2 judge.
    advice = adviceOf();
    expect(advice.find(a => a.slug === SLUG)!.action).toBe('judge');

    // 5. judge --refutes LONG_SLUG.
    h.runJson(['sgt', 'judge', LONG_SLUG, '--refutes=true']);
    expect(h.sessionAtoms()[`${NS}h:${LONG_SLUG}`].isRefuted).toBe(true);

    // 6. advise excludes the refuted slug from every tier.
    advice = adviceOf();
    expect(advice.some(a => a.slug === LONG_SLUG)).toBe(false);

    // 7. expand of the refuted hypothesis fails SGT_EXPAND_REFUSED —
    //    refusal-before-subprocess (SGT_BIN=/nonexistent proves no spawn) and
    //    state.json bytes identical before/after.
    const snapshot = h.snapshotState();
    const refused = h.run(['sgt', 'expand', LONG_SLUG, '--format', 'json'], NO_BIN);
    expect(refused.status).not.toBe(0);
    const refusedOut = `${refused.stdout}${refused.stderr}`;
    expect(refusedOut).toContain('SGT_EXPAND_REFUSED');
    expect(refusedOut).toContain('refuted');
    expect(refusedOut).not.toContain('SGT_UNAVAILABLE');
    h.expectStateBytes(snapshot);

    // 8. judge --supports clears isRefuted via verifyAtom (live refutedSlugs, I3).
    h.runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
    const resupported = h.sessionAtoms()[`${NS}h:${LONG_SLUG}`];
    expect(resupported.isRefuted).toBeFalsy();
    expect(resupported.isVerified).toBe(true);

    // 9. advise re-lists the slug (verified -> tier-3 related).
    advice = adviceOf();
    const relisted = advice.filter(a => a.slug === LONG_SLUG);
    expect(relisted.map(a => a.action)).toEqual(['related']);

    // 10. re-route v2 drops SLUG: BOTH h: and e: prefixed exactly once,
    //     confidence capped at 0.35.
    const v2 = h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(v2.supersededIds).toContain(`${NS}h:${SLUG}`);
    expect(v2.supersededIds).toContain(`${NS}e:${SLUG}`);
    let atoms = h.sessionAtoms();
    for (const id of [`${NS}h:${SLUG}`, `${NS}e:${SLUG}`]) {
      expect(String(atoms[id].content).match(/\[superseded by re-route\] /g)).toHaveLength(1);
      expect(atoms[id].confidence).toBe(0.35);
    }

    // 10b. identical v2 re-run is byte-quiet: the prefix never doubles.
    const v2Snapshot = h.snapshotState();
    const v2Again = h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') });
    expect(v2Again.planChanged).toBe(false);
    h.expectStateBytes(v2Snapshot);

    // 11. re-route v1 resurrects h: (unjudged -> prefix removed, confidence
    //     re-mapped) while e: stays superseded until a fresh expand.
    h.runJson(['sgt', 'route', QUERY]);
    atoms = h.sessionAtoms();
    expect(String(atoms[`${NS}h:${SLUG}`].content).startsWith(SUPERSEDED)).toBe(false);
    expect(atoms[`${NS}h:${SLUG}`].confidence).toBe(0.66);
    expect(String(atoms[`${NS}e:${SLUG}`].content).startsWith(SUPERSEDED)).toBe(true);

    // 12. fresh expand revives e: via updateAtom (never a processAtom overwrite).
    const createdAt = atoms[`${NS}e:${SLUG}`].created;
    const revived = h.runJson(['sgt', 'expand', SLUG]);
    expect(revived.created).toBe(false);
    expect(revived.packChanged).toBe(true);
    atoms = h.sessionAtoms();
    expect(atoms[`${NS}e:${SLUG}`].content).toBe(`sgt expand: ${SLUG} (2 excerpts, budget 1200)`);
    expect(atoms[`${NS}e:${SLUG}`].created).toBe(createdAt);

    // 13. final advise output byte-stable across two consecutive runs.
    const first = h.run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    const second = h.run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    expect(first.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });
});

describe('--help examples per sgt subcommand (pinned)', () => {
  const expectations: Array<[string[], string]> = [
    [['sgt', 'route', '--help'], '--budget 1200'],
    [['sgt', 'expand', '--help'], '--budget 1200'],
    [['sgt', 'judge', '--help'], '--supports'],
    [['sgt', 'advise', '--help'], '--limit 5'],
    [['sgt', 'trace', '--help'], '--graphFormat mermaid'],
  ];

  it.each(expectations)('%j help shows the pinned example', (args, needle) => {
    const result = h.run(args as string[]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(needle);
  });
});

describe('operator smoke script', () => {
  it('bash scripts/sgt-integration-smoke.sh exits 0 against the built CLI + fixture bin', () => {
    const script = path.resolve(__dirname, '..', 'scripts', 'sgt-integration-smoke.sh');
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 120_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 120_000);
});
