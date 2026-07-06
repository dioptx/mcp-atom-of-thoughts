/**
 * Tests for CLI hint helpers plus spawn-level coverage of `aot graph` raw
 * output. The spawn tests run against `build/cli.js`, so the build must be
 * current (same contract as e2e.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { graphFormatMisuseHint, GRAPH_RENDER_FORMATS } from '../src/cli-hints.js';

describe('graphFormatMisuseHint', () => {
  it.each([...GRAPH_RENDER_FORMATS])('hints --graphFormat when --format %s is passed', (fmt) => {
    const hint = graphFormatMisuseHint(['graph', '--format', fmt]);
    expect(hint).toContain(`aot graph --graphFormat ${fmt}`);
    expect(hint).toContain(`Invalid format: "${fmt}"`);
  });

  it('handles the --format=value form', () => {
    expect(graphFormatMisuseHint(['graph', '--format=mermaid'])).toContain('--graphFormat mermaid');
  });

  it('ignores valid envelope formats and unrelated argv', () => {
    expect(graphFormatMisuseHint(['graph', '--format', 'json'])).toBeNull();
    expect(graphFormatMisuseHint(['graph', '--format', 'toon'])).toBeNull();
    expect(graphFormatMisuseHint(['graph', '--graphFormat', 'mermaid'])).toBeNull();
    expect(graphFormatMisuseHint(['list'])).toBeNull();
    expect(graphFormatMisuseHint([])).toBeNull();
  });

  it('ignores a dangling --format with no value', () => {
    expect(graphFormatMisuseHint(['graph', '--format'])).toBeNull();
  });
});

describe('aot graph output (built CLI)', () => {
  const CLI_PATH = path.resolve(__dirname, '..', 'build', 'cli.js');
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [CLI_PATH, ...args], { env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  beforeAll(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-cli-hints-'));
    env = { ...process.env, AOT_STATE: path.join(stateDir, 'state.json'), AOT_BR_AUTO: '0' };
    const seeded = runCli(['fast', 'p', 'P1', 'raw render premise', '--confidence', '0.9']);
    expect(seeded.status).toBe(0);
  });

  afterAll(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('prints the tree render raw to stdout with metadata on stderr by default', () => {
    const { status, stdout, stderr } = runCli(['graph']);
    expect(status).toBe(0);
    expect(stdout).toContain('P1');
    expect(stdout).toContain('raw render premise');
    expect(stdout).not.toContain('rendered:');
    expect(stdout).not.toContain('\\n');
    expect(stderr).toContain('session=');
    expect(stderr).toContain('graphFormat=tree');
  });

  it('prints mermaid raw (multi-line, unescaped) by default', () => {
    const { status, stdout } = runCli(['graph', '--graphFormat', 'mermaid']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^graph TD\n/);
    expect(stdout).not.toContain('\\n');
  });

  it('returns the structured payload when --format json is explicit', () => {
    const { status, stdout } = runCli(['graph', '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.format).toBe('tree');
    expect(typeof parsed.sessionId).toBe('string');
    expect(parsed.rendered).toContain('P1');
  });

  it('suggests --graphFormat when a render format is passed to --format', () => {
    const { status, stderr } = runCli(['graph', '--format', 'mermaid']);
    expect(status).toBe(1);
    expect(stderr).toContain('Invalid format: "mermaid"');
    expect(stderr).toContain('aot graph --graphFormat mermaid');
  });
});
