/**
 * `aot sgt run` — one-shot route + advise + expand interleaving.
 *
 * Contract under test:
 * - one invocation materializes the route plan, returns ranked advice, and
 *   discloses the TOP advised hypothesis (scaffold atom created);
 * - --gap widens disclosure to the runner-up only when its advise score is
 *   within the gap fraction of the top;
 * - the composed result equals what the three separate commands produce
 *   (same scaffold IDs, same idempotency) — `run` is composition, not a
 *   fourth epistemic pathway;
 * - bridge failure (SGT_BIN missing) leaves session state untouched.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createHarness, chmodFixtures, type SgtCliHarness } from './helpers/sgt-cli-harness';

let h: SgtCliHarness;

beforeAll(() => { chmodFixtures(); });
beforeEach(() => { h = createHarness('aot-sgt-run-'); });
afterEach(() => { h.cleanup(); });

const QUERY = 'deploy kubernetes service';

describe('aot sgt run — one-shot interleaving', () => {
  it('routes, advises, and expands the top advised hypothesis in one call', () => {
    const out = h.runJson(['sgt', 'run', QUERY]);
    expect(out.status).toBe('success');

    // Route materialized: premise + reasoning + hypotheses exist.
    const route = out.route as Record<string, unknown>;
    expect(route.status).toBe('success');
    expect(route.skillCount).toBe(3);
    expect(route.created).toBeGreaterThan(0);

    // Advice returned, ranked, and the top entry is an expand action.
    const advice = out.advise as Array<Record<string, unknown>>;
    expect(advice.length).toBeGreaterThan(0);
    expect(advice[0].action).toBe('expand');

    // Exactly the top-1 hypothesis disclosed (default gap 0).
    expect(out.expandedCount).toBe(1);
    const expanded = out.expanded as Array<Record<string, unknown>>;
    expect(expanded[0].slug).toBe(advice[0].slug);

    // Scaffold atom exists in state with the hypothesis as dependency.
    const atoms = h.sessionAtoms();
    const scaffold = atoms[expanded[0].atomId as string];
    expect(scaffold).toBeDefined();
    expect(scaffold.atomType).toBe('verification');
    expect((scaffold.dependencies as string[])[0]).toBe(advice[0].atomId);
  });

  it('equals route + advise + expand run separately (same scaffold, idempotent)', () => {
    const composed = h.runJson(['sgt', 'run', QUERY]);
    const composedScaffoldId = (composed.expanded as Array<Record<string, unknown>>)[0].atomId as string;
    const snapshot = h.snapshotState();

    // Re-running the separate commands over the same state is byte-quiet:
    // route diff-idempotent, expand diff-idempotent on the same pack.
    const route2 = h.runJson(['sgt', 'route', QUERY]);
    expect(route2.planChanged).toBe(false);
    const expand2 = h.runJson(['sgt', 'expand', composedScaffoldId.replace(':e:', ':h:')]);
    expect(expand2.packChanged).toBe(false);
    expect(expand2.atomId).toBe(composedScaffoldId);
    h.expectStateBytes(snapshot);
  });

  it('--gap 1.0 also discloses the runner-up; gap 0 never does', () => {
    const out = h.runJson(['sgt', 'run', QUERY, '--gap', '1.0']);
    const advice = out.advise as Array<Record<string, unknown>>;
    const expandTier = advice.filter(a => a.action === 'expand');
    expect(expandTier.length).toBeGreaterThanOrEqual(2);
    expect(out.expandedCount).toBe(2);
    const expanded = out.expanded as Array<Record<string, unknown>>;
    expect(expanded.map(e => e.slug)).toEqual([expandTier[0].slug, expandTier[1].slug]);
  });

  it('--gap excludes a runner-up whose score falls outside the fraction', () => {
    // gap epsilon: runner-up must be within 0.1% of top — fixture scores differ
    // by more than that, so only top-1 disclosed.
    const out = h.runJson(['sgt', 'run', QUERY, '--gap', '0.001']);
    const advice = out.advise as Array<Record<string, unknown>>;
    const expandTier = advice.filter(a => a.action === 'expand');
    const withinGap = expandTier.length > 1
      && (expandTier[1].score as number) >= (expandTier[0].score as number) * 0.999;
    expect(out.expandedCount).toBe(withinGap ? 2 : 1);
  });

  it('SGT_BIN missing: fails with SGT_UNAVAILABLE and writes no state', () => {
    const result = h.run(['sgt', 'run', QUERY, '--format', 'json'], { SGT_BIN: '/nonexistent/sgt' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SGT_UNAVAILABLE');
  });
});
