/**
 * Built-CLI tests for `aot sgt advise` (round 2 metacognition): byte-stable
 * ranking determinism, tier contents and exclusivity, the pinned confidence
 * gate, I3 live-state exclusion (refute -> exclude -> re-support -> eligible),
 * and I1 no-binary operation (zero subprocess).
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

let stateDir: string;
let statePath: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  for (const file of fs.readdirSync(FIXTURES)) {
    if (file.endsWith('.sh')) fs.chmodSync(fixture(file), 0o755);
  }
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sgt-advise-test-'));
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

function adviceOf(result: Record<string, unknown>): Array<Record<string, unknown>> {
  return result.advice as Array<Record<string, unknown>>;
}

const NO_BIN = { SGT_BIN: '/nonexistent/binary' };

describe('aot sgt advise ranking and determinism (built CLI)', () => {
  beforeEach(() => {
    runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-tokens.sh') });
  });

  it('is byte-stable: two runs over the same state produce identical raw stdout', () => {
    const first = run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    const second = run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout); // raw byte comparison
  });

  it('orders by tier asc, score desc, atomId asc with rank 1..N', () => {
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    expect(advice.map(entry => [entry.rank, entry.tier, entry.action, entry.slug])).toEqual([
      [1, 1, 'expand', LONG_SLUG], // tier 1, score 0.70
      [2, 1, 'expand', SLUG], // tier 1, score 0.66
      [3, 4, 'refine', 'sparse-notes-skill'], // tier 4, score 0.66
    ]);
    expect(advice.map(entry => entry.score)).toEqual([0.70, 0.66, 0.66]);
  });

  it('tier exclusivity: a hypothesis qualifying for tier 1 AND tier 4 appears exactly once, as tier 1 expand', () => {
    // LONG_SLUG: confidence 0.70 (>= gate), unexpanded, missingTokens
    // [helm, chart], no coverage — tier 1 and tier 4 both match; tier 1 wins.
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    const entries = advice.filter(entry => entry.slug === LONG_SLUG);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('expand');
    expect(entries[0].command).toBe(`aot sgt expand ${NS}h:${LONG_SLUG} --budget 1200`);
  });

  it('tier 4 refine: score round4(0.50+0.08*min(len,6)) = 0.66 for 2 tokens; command carries premise query + missing tokens', () => {
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    const refine = advice.find(entry => entry.action === 'refine');
    expect(refine).toBeDefined();
    expect(refine!.slug).toBe('sparse-notes-skill');
    expect(refine!.score).toBe(0.66);
    expect(refine!.command).toBe(`aot sgt route "${QUERY} helm chart"`);
  });

  it('--limit truncates before ranking: rank stays 1..N', () => {
    const result = runJson(['sgt', 'advise', '--limit', '2'], NO_BIN);
    const advice = adviceOf(result);
    expect(advice).toHaveLength(2);
    expect(advice.map(entry => entry.rank)).toEqual([1, 2]);
    expect(result.candidateCount).toBe(3); // full candidate set still reported
  });

  it('a re-route adding tokens to an existing atom updates it exactly once, then goes quiet (skillRefEquals extension)', () => {
    // Fresh namespace state came from the tokens fixture; re-route with the
    // token-free v1 plan updates skillRef (tokens removed)...
    const reroute = runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok.sh') });
    expect(reroute.planChanged).toBe(true);
    // ...and re-routing with tokens again updates exactly the token-carrying atoms once...
    const tokensAgain = runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-tokens.sh') });
    expect(tokensAgain.planChanged).toBe(true);
    // ...then the identical tokens plan is a no-op (absent vs [] pinned as distinct, so this converges).
    const before = fs.readFileSync(statePath, 'utf8');
    const quiet = runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-tokens.sh') });
    expect(quiet.planChanged).toBe(false);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });
});

describe('aot sgt advise tier contents across the loop (built CLI)', () => {
  beforeEach(() => {
    runJson(['sgt', 'route', QUERY]); // sgt-dispatch.sh: plain v1 plan (no tokens)
  });

  it('confidence gate: an active unexpanded hypothesis at 0.60 is not suggested at all (EXPAND_ADVISE_MIN_CONFIDENCE=0.65)', () => {
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    // sparse-notes-skill sits at confidence 0.60 with no missing tokens: no tier matches.
    expect(advice.some(entry => entry.slug === 'sparse-notes-skill')).toBe(false);
    expect(advice.map(entry => entry.action)).toEqual(['expand', 'expand']);
  });

  it('scaffold-exists-unsettled -> executable judge command with polarity in argChoices, never a --a|--b alternation', () => {
    runJson(['sgt', 'expand', SLUG]);
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    const judge = advice.find(entry => entry.slug === SLUG);
    expect(judge).toBeDefined();
    expect(judge!.action).toBe('judge');
    expect(judge!.tier).toBe(2);
    expect(judge!.command).toBe(`aot sgt judge ${NS}h:${SLUG}`);
    expect(String(judge!.command)).not.toContain('|');
    expect(judge!.argChoices).toEqual(['--supports', '--refutes']);
    expect(judge!.score).toBe(0.66); // hypothesis confidence
  });

  it('verified -> related with command `sgt graph related <slug>` and score round4(conf*0.85)', () => {
    runJson(['sgt', 'judge', SLUG, '--supports=true']);
    const advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    const related = advice.find(entry => entry.slug === SLUG);
    expect(related).toBeDefined();
    expect(related!.action).toBe('related');
    expect(related!.tier).toBe(3);
    expect(related!.command).toBe(`sgt graph related ${SLUG}`);
    expect(related!.score).toBe(0.561); // round4(0.66 * 0.85)
  });
});

describe('aot sgt advise I3 exclusion from LIVE state (built CLI)', () => {
  beforeEach(() => {
    runJson(['sgt', 'route', QUERY]);
  });

  it('after judge --refutes: absent from every tier and expand refuses; survives re-routes; re-support restores eligibility', () => {
    runJson(['sgt', 'judge', SLUG, '--refutes=true']);
    let advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    expect(advice.some(entry => entry.slug === SLUG)).toBe(false);

    const refused = run(['sgt', 'expand', SLUG, '--format', 'json'], NO_BIN);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain('SGT_EXPAND_REFUSED');

    // Exclusion survives a re-route: the refuted hypothesis is preserved as judged.
    runJson(['sgt', 'route', QUERY]);
    advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    expect(advice.some(entry => entry.slug === SLUG)).toBe(false);

    // verifyAtom escape hatch: a later --supports clears isRefuted, so the
    // slug becomes eligible again — refutedSlugs derives from live hypothesis
    // state, never from mere j:*:refutes atom presence.
    runJson(['sgt', 'judge', SLUG, '--supports=true']);
    advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    const restored = advice.filter(entry => entry.slug === SLUG);
    expect(restored.map(entry => entry.action)).toEqual(['related']); // now verified
  });

  it('superseded slugs are excluded while superseded and return after a restoring re-route', () => {
    runJson(['sgt', 'route', QUERY], { SGT_BIN: fixture('sgt-ok-v2.sh') }); // drops SLUG
    let advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    expect(advice.some(entry => entry.slug === SLUG)).toBe(false);

    runJson(['sgt', 'route', QUERY]); // restores SLUG
    advice = adviceOf(runJson(['sgt', 'advise'], NO_BIN));
    expect(advice.some(entry => entry.slug === SLUG && entry.action === 'expand')).toBe(true);
  });
});

describe('aot sgt advise needs no binary (I1)', () => {
  it('exits 0 with a ranked list when SGT_BIN points nowhere — zero subprocess', () => {
    runJson(['sgt', 'route', QUERY]); // seed state with a working fixture first
    const result = run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.status).toBe('success');
    expect(parsed.sessionId).toBe('default');
    expect((parsed.advice as unknown[]).length).toBeGreaterThan(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain('SGT_UNAVAILABLE');
  });

  it('an empty session yields an empty advice list, still exit 0', () => {
    const result = run(['sgt', 'advise', '--format', 'json'], NO_BIN);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.advice).toEqual([]);
    expect(parsed.candidateCount).toBe(0);
  });
});
