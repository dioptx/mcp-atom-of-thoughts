/**
 * Shared built-CLI harness for the `aot sgt` test suites (round 3):
 * per-test AOT_STATE temp file, fixture SGT_BIN (I5: no corpus in repo),
 * run/runJson wrappers, and byte-level state snapshot assertions.
 *
 * Build gap closed atomically: requireBuild() FAILS with an actionable
 * message when build/cli.js is missing — never a silent skip. `npm test`
 * runs the build first via the package.json pretest hook, so a clean
 * checkout passes without manual steps.
 */

import { expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CLI_PATH = path.resolve(__dirname, '..', '..', 'build', 'cli.js');
export const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'sgt-bin');

export const fixture = (name: string): string => path.join(FIXTURES, name);

/** Throws (fails the suite, never skips) when the CLI has not been built. */
export function requireBuild(): void {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(
      `build/cli.js missing at ${CLI_PATH} — run \`npm run build\` first (\`npm test\` does this automatically via the pretest hook)`,
    );
  }
}

/** chmod +x every fixture script — the executable bit does not survive npm pack. */
export function chmodFixtures(): void {
  for (const file of fs.readdirSync(FIXTURES)) {
    if (file.endsWith('.sh')) fs.chmodSync(fixture(file), 0o755);
  }
}

export interface SgtCliHarness {
  stateDir: string;
  statePath: string;
  env: NodeJS.ProcessEnv;
  run(args: string[], extraEnv?: NodeJS.ProcessEnv): SpawnSyncReturns<string>;
  runJson(args: string[], extraEnv?: NodeJS.ProcessEnv): Record<string, unknown>;
  sessionAtoms(sessionId?: string): Record<string, Record<string, unknown>>;
  /** Raw state.json bytes right now. */
  snapshotState(): string;
  /** Asserts the state file is byte-identical to a prior snapshot. */
  expectStateBytes(snapshot: string): void;
  cleanup(): void;
}

export function createHarness(prefix = 'aot-sgt-harness-'): SgtCliHarness {
  requireBuild();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const statePath = path.join(stateDir, 'state.json');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AOT_STATE: statePath,
    AOT_BR_AUTO: '0',
    SGT_BIN: fixture('sgt-dispatch.sh'),
    SGT_TIMEOUT_MS: '5000',
  };

  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> =>
    spawnSync('node', [CLI_PATH, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });

  const runJson = (args: string[], extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> => {
    const result = run([...args, '--format', 'json'], extraEnv);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };

  return {
    stateDir,
    statePath,
    env,
    run,
    runJson,
    sessionAtoms(sessionId = 'default') {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return state.sessions[sessionId].atoms as Record<string, Record<string, unknown>>;
    },
    snapshotState() {
      return fs.readFileSync(statePath, 'utf8');
    },
    expectStateBytes(snapshot: string) {
      expect(fs.readFileSync(statePath, 'utf8')).toBe(snapshot);
    },
    cleanup() {
      fs.rmSync(stateDir, { recursive: true, force: true });
    },
  };
}
