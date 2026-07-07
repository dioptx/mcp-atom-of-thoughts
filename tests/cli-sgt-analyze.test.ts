/**
 * Built-CLI tests for the round-3 analyze/gate awareness: the informational
 * advise_pending lint (pinned to adviseCandidates tiers 1-2), issue ordering
 * (graph-analysis issues first, advise_pending sorted atomId asc), gate
 * exemption in BOTH directions with an honest gate payload, and skillRef
 * export/import round-trip parity for `aot analyze --from`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sgtNamespace } from '../src/sgt-bridge.js';
import { chmodFixtures, createHarness, fixture, requireBuild, type SgtCliHarness } from './helpers/sgt-cli-harness.js';

requireBuild();

const QUERY = 'deploy kubernetes service';
const NS = sgtNamespace(QUERY);
const SLUG = 'k8s-manifest-generator';
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';
const SPARSE = 'sparse-notes-skill';
const NO_BIN = { SGT_BIN: '/nonexistent/binary' };

type Issue = { code: string; atomIds: string[]; message: string };

let h: SgtCliHarness;

beforeAll(() => {
  chmodFixtures();
});

beforeEach(() => {
  h = createHarness('aot-sgt-analyze-test-');
});

afterEach(() => {
  h.cleanup();
});

function issuesOf(result: Record<string, unknown>): Issue[] {
  return result.issues as Issue[];
}

describe('advise_pending lint pinned to adviseCandidates (built CLI)', () => {
  it('after route: one issue per tier-1 candidate with the exact pinned shape and "awaits expand"; sub-gate hypotheses produce none', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const issues = issuesOf(h.runJson(['analyze'], NO_BIN));
    const pending = issues.filter(issue => issue.code === 'advise_pending');
    // SLUG (0.66) and LONG_SLUG (0.70) are >= 0.65; sparse (0.60) is below the gate.
    expect(pending).toEqual([
      {
        code: 'advise_pending',
        atomIds: [`${NS}h:${SLUG}`],
        message: `Skill hypothesis ${NS}h:${SLUG} (${SLUG}) awaits expand`,
      },
      {
        code: 'advise_pending',
        atomIds: [`${NS}h:${LONG_SLUG}`],
        message: `Skill hypothesis ${NS}h:${LONG_SLUG} (${LONG_SLUG}) awaits expand`,
      },
    ]);
    expect(pending.some(issue => issue.atomIds[0] === `${NS}h:${SPARSE}`)).toBe(false);
  });

  it('issue ordering: graph-analysis issues first, then advise_pending sorted atomId asc', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const issues = issuesOf(h.runJson(['analyze'], NO_BIN));
    expect(issues.map(issue => issue.code)).toEqual([
      'untested_hypothesis', 'untested_hypothesis', 'untested_hypothesis',
      'advise_pending', 'advise_pending',
    ]);
    const pendingIds = issues.filter(i => i.code === 'advise_pending').map(i => i.atomIds[0]);
    expect(pendingIds).toEqual([...pendingIds].sort());
  });

  it('after expand: the disclosed hypothesis awaits judge (tier 2)', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'expand', SLUG]);
    const pending = issuesOf(h.runJson(['analyze'], NO_BIN)).filter(issue => issue.code === 'advise_pending');
    const forSlug = pending.find(issue => issue.atomIds[0] === `${NS}h:${SLUG}`)!;
    expect(forSlug.message).toContain('awaits judge');
    expect(pending.find(issue => issue.atomIds[0] === `${NS}h:${LONG_SLUG}`)!.message).toContain('awaits expand');
  });

  it('no issue after judge --supports, judge --refutes, or supersede', () => {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'judge', SLUG, '--supports=true']);
    h.runJson(['sgt', 'judge', LONG_SLUG, '--refutes=true']);
    let pending = issuesOf(h.runJson(['analyze'], NO_BIN)).filter(issue => issue.code === 'advise_pending');
    expect(pending).toEqual([]);

    // Fresh state: supersede via the v2 re-route (drops SLUG).
    h.cleanup();
    h = createHarness('aot-sgt-analyze-test-');
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') });
    pending = issuesOf(h.runJson(['analyze'], NO_BIN)).filter(issue => issue.code === 'advise_pending');
    expect(pending.some(issue => issue.atomIds[0] === `${NS}h:${SLUG}`)).toBe(false);
  });

  it('sessions without sgt atoms are untouched: analyze issues identical to pre-round-3 (no advise_pending code)', () => {
    h.runJson(['fast', 'premise', 'P1', 'seed', '--confidence', '0.9']);
    const issues = issuesOf(h.runJson(['analyze'], NO_BIN));
    expect(issues.every(issue => issue.code !== 'advise_pending')).toBe(true);
  });
});

describe('gate exemption both directions + payload honesty (built CLI)', () => {
  /** State whose ONLY issue is one advise_pending (SLUG awaits judge). */
  function seedSinglePendingState(): void {
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'expand', SLUG]); // scaffold: SLUG tested, tier 2 pending
    h.runJson(['sgt', 'judge', LONG_SLUG, '--supports=true']);
    h.runJson(['sgt', 'judge', SPARSE, '--supports=true']);
  }

  it('--gate exits 0 when advise_pending is the only issue; the issues array STILL contains it; gate payload reports the exemption', () => {
    seedSinglePendingState();
    // weakThreshold 0.3: keeps the deep sgt chain (eff conf ~0.43 on the
    // scaffolded hypothesis) out of weak_support so advise_pending is
    // genuinely the ONLY issue in play.
    const result = h.run(['analyze', '--gate=true', '--weakThreshold', '0.3', '--format', 'json'], NO_BIN);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    const pending = (payload.issues as Issue[]).filter(issue => issue.code === 'advise_pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].atomIds).toEqual([`${NS}h:${SLUG}`]);
    // Pinned gate payload shape when --failOn is absent: 'all' + exempt list.
    expect(payload.gate).toEqual({
      failed: false,
      failingIssueCount: 0,
      failOn: 'all',
      exempt: ['advise_pending'],
    });
  });

  it('--gate --failOn advise_pending opts back in: exit 1, failingIssueCount 1, no exempt field', () => {
    seedSinglePendingState();
    const result = h.run(['analyze', '--gate=true', '--failOn', 'advise_pending', '--weakThreshold', '0.3', '--format', 'json'], NO_BIN);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(payload.gate).toEqual({
      failed: true,
      failingIssueCount: 1,
      failOn: ['advise_pending'],
    });
  });

  it('--gate --failOn cycle with only advise_pending pending: exit 0', () => {
    seedSinglePendingState();
    const result = h.run(['analyze', '--gate=true', '--failOn', 'cycle', '--weakThreshold', '0.3', '--format', 'json'], NO_BIN);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout).gate as Record<string, unknown>).failed).toBe(false);
  });

  it('non-exempt issues still fail the default gate (advise_pending never shields them)', () => {
    h.runJson(['sgt', 'route', QUERY]); // untested_hypothesis x3 + advise_pending x2
    const result = h.run(['analyze', '--gate=true', '--format', 'json'], NO_BIN);
    expect(result.status).toBe(1);
    const gate = JSON.parse(result.stdout).gate as Record<string, unknown>;
    expect(gate.failed).toBe(true);
    expect(gate.failingIssueCount).toBe(3); // the advise_pending pair is exempt
  });
});

describe('skillRef export/import round-trip + analyze --from parity (built CLI)', () => {
  it('no-skill export carries NO skillRef key anywhere', () => {
    h.runJson(['fast', 'premise', 'P1', 'seed', '--confidence', '0.9']);
    const exported = h.runJson(['export'], NO_BIN);
    expect(JSON.stringify(exported)).not.toContain('skillRef');
  });

  it('routed hypothesis exports skillRef; import restores it; re-export is byte-identical; analyze --from matches the live session', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const exported = h.runJson(['export'], NO_BIN);
    const graph = exported.graph as { nodes: Array<Record<string, unknown>> };
    const node = graph.nodes.find(n => n.id === `${NS}h:${SLUG}`)!;
    expect((node.skillRef as Record<string, unknown>).slug).toBe(SLUG);

    // Round-trip: import into a fresh session, re-export, compare bytes.
    const exportPath = path.join(h.stateDir, 'export.json');
    fs.writeFileSync(exportPath, JSON.stringify(graph));
    h.runJson(['import', exportPath, '--sessionId', 'restored'], NO_BIN);
    const reExported = h.runJson(['export', '--sessionId', 'restored'], NO_BIN);
    expect(JSON.stringify(reExported.graph)).toBe(JSON.stringify(graph));

    // File-based analysis sees the same advise_pending issues as the session.
    const live = issuesOf(h.runJson(['analyze'], NO_BIN)).filter(issue => issue.code === 'advise_pending');
    const fromFile = issuesOf(h.runJson(['analyze', '--from', exportPath], NO_BIN)).filter(issue => issue.code === 'advise_pending');
    expect(fromFile).toEqual(live);
    expect(fromFile.length).toBeGreaterThan(0);
  });
});
