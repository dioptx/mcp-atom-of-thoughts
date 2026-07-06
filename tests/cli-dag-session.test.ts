/**
 * State-file round-trip tests for `aot dag` session routing, run against the
 * built CLI (`build/cli.js`) with an isolated AOT_STATE.
 *
 * Invariant under test: `aot dag` writes into the session resolved as
 * explicit --session-id > payload sessionId > active session > 'default'.
 * The old wrong outcome — an active session api500 with dag atoms silently
 * landing in 'default' — must be impossible, in dry-run and real runs alike.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CLI_PATH = path.resolve(__dirname, '..', 'build', 'cli.js');
const DAG_JSON = JSON.stringify({
  title: 'routing check',
  nodes: [
    { id: 'A', content: 'first task' },
    { id: 'B', content: 'second task', dependencies: ['A'] },
  ],
});
const DAG_FLAGS = ['--noBr', '--noBv', '--noGit', '--format', 'json'];

describe('aot dag session routing (built CLI)', () => {
  let stateDir: string;
  let statePath: string;
  let env: NodeJS.ProcessEnv;

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [CLI_PATH, ...args], { env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function runJson(args: string[]): Record<string, unknown> {
    const result = runCli(args);
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  function sessionCounts(): Record<string, number> {
    const payload = runJson(['sessions', '--format', 'json']);
    const sessions = payload.sessions as Array<{ id: string; atomCount: number }>;
    return Object.fromEntries(sessions.map(s => [s.id, s.atomCount]));
  }

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-dag-session-'));
    statePath = path.join(stateDir, 'state.json');
    env = { ...process.env, AOT_STATE: statePath, AOT_BR_AUTO: '0' };
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('writes into the active session by default, and dry-run previews the same session', () => {
    expect(runCli(['new', 'api500']).status).toBe(0);

    const preview = runJson(['dag', DAG_JSON, '--dryRun', ...DAG_FLAGS]);
    expect(preview.sessionId).toBe('api500');
    expect(preview.sessionSource).toBe('active');
    const previewAtoms = (preview.atoms as { atoms: Array<{ sessionId: string; content: string }> }).atoms;
    expect(previewAtoms.map(atom => atom.sessionId)).toEqual(['api500', 'api500']);
    for (const atom of previewAtoms) expect(atom.content).toContain('AoT external ref: aot:api500:');
    // Dry run must not write.
    expect(sessionCounts()).toMatchObject({ api500: 0, default: 0 });

    const real = runJson(['dag', DAG_JSON, ...DAG_FLAGS]);
    expect(real.sessionId).toBe('api500');
    expect(real.sessionSource).toBe('active');
    expect(sessionCounts()).toMatchObject({ api500: 2, default: 0 });
  });

  it('honors an explicit --session-id (auto-creating it) and leaves the active session untouched', () => {
    expect(runCli(['new', 'api500']).status).toBe(0);

    const result = runJson(['dag', DAG_JSON, '--sessionId', 'other', ...DAG_FLAGS]);
    expect(result.sessionId).toBe('other');
    expect(result.sessionSource).toBe('flag');

    const counts = sessionCounts();
    expect(counts).toMatchObject({ other: 2, api500: 0, default: 0 });
    // Active session must not have been switched.
    expect(runJson(['sessions', '--format', 'json']).activeSessionId).toBe('api500');
  });

  it('prefers a sessionId embedded in the DAG payload over the active session', () => {
    expect(runCli(['new', 'api500']).status).toBe(0);
    const dagWithSession = JSON.stringify({ ...JSON.parse(DAG_JSON), sessionId: 'embedded' });

    const result = runJson(['dag', dagWithSession, ...DAG_FLAGS]);
    expect(result.sessionId).toBe('embedded');
    expect(result.sessionSource).toBe('payload');
    expect(sessionCounts()).toMatchObject({ embedded: 2, api500: 0 });
  });

  it('warns loudly (but still writes) when the active session is completed', () => {
    const session = (id: string, status: string) => ({
      id,
      status,
      createdAt: Date.now(),
      atoms: {},
      atomOrder: [],
      verifiedConclusions: [],
      decompositionStates: {},
      currentDecompositionId: null,
    });
    fs.writeFileSync(statePath, JSON.stringify({
      version: 1,
      activeSessionId: 'api500',
      maxDepth: 5,
      sessions: { default: session('default', 'active'), api500: session('api500', 'completed') },
    }, null, 2));

    const raw = runCli(['dag', DAG_JSON, ...DAG_FLAGS]);
    expect(raw.status).toBe(0);
    expect(raw.stderr).toContain('aot dag: active session "api500" is completed');
    const payload = JSON.parse(raw.stdout) as Record<string, unknown>;
    expect(payload.sessionId).toBe('api500');
    expect(payload.sessionSource).toBe('active');
    expect(String(payload.sessionWarning)).toContain('completed');
    // Never silently misrouted to 'default'.
    expect(sessionCounts()).toMatchObject({ api500: 2, default: 0 });
  });
});
