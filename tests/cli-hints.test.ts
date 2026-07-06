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
import { z } from 'incur';
import { booleanFlagLiteralHint, booleanOptionNames, graphFormatMisuseHint, GRAPH_RENDER_FORMATS } from '../src/cli-hints.js';

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

  it('is scoped to the graph command and stays silent elsewhere', () => {
    expect(graphFormatMisuseHint(['list', '--format', 'mermaid'])).toBeNull();
    expect(graphFormatMisuseHint(['analyze', '--format=tree'])).toBeNull();
    expect(graphFormatMisuseHint(['--format', 'mermaid'])).toBeNull();
  });
});

describe('booleanOptionNames', () => {
  it('extracts boolean option names through optional/default wrappers', () => {
    const schema = z.object({
      verified: z.boolean().optional(),
      dryRun: z.boolean().default(false),
      force: z.boolean(),
      confidence: z.coerce.number().optional(),
      content: z.string().optional(),
    });
    expect(booleanOptionNames(schema)).toEqual(new Set(['verified', 'dryRun', 'force']));
  });

  it('returns an empty set for undefined or non-schema input', () => {
    expect(booleanOptionNames(undefined).size).toBe(0);
    expect(booleanOptionNames({ shape: null }).size).toBe(0);
    expect(booleanOptionNames('nope').size).toBe(0);
  });
});

describe('booleanFlagLiteralHint', () => {
  const flags = new Set(['verified', 'dryRun', 'force']);

  it('hints the = form for --verified false', () => {
    const hint = booleanFlagLiteralHint(['set', 'H1', '--verified', 'false'], flags);
    expect(hint).toContain('--verified=false');
    expect(hint).toContain('--no-verified');
  });

  it('hints the = form for --verified true', () => {
    const hint = booleanFlagLiteralHint(['set', 'H1', '--verified', 'true'], flags);
    expect(hint).toContain('--verified=true');
  });

  it('handles kebab-case flags (--dry-run true)', () => {
    const hint = booleanFlagLiteralHint(['gc', '--dry-run', 'true'], flags);
    expect(hint).toContain('--dryRun=true');
  });

  it('handles negated flags (--no-verified true)', () => {
    const hint = booleanFlagLiteralHint(['set', 'H1', '--no-verified', 'true'], flags);
    expect(hint).toContain('--verified=true');
  });

  it('is case-insensitive on the literal (--verified False/TRUE/FaLsE)', () => {
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'False'], flags)).toContain('--verified=false');
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'FALSE'], flags)).toContain('--verified=false');
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'TRUE'], flags)).toContain('--verified=true');
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'True'], flags)).toContain('--verified=true');
    expect(booleanFlagLiteralHint(['gc', '--dry-run', 'FaLsE'], flags)).toContain('--dryRun=false');
    expect(booleanFlagLiteralHint(['set', 'H1', '--no-verified', 'True'], flags)).toContain('--verified=true');
  });

  // Adversarial negatives: inputs that must NOT trigger the guard.
  it('does not fire on non-boolean flags taking literal true/false values', () => {
    expect(booleanFlagLiteralHint(['set', 'H1', '--content', 'true'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--content', 'false'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--content', 'True'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--content', 'FALSE'], flags)).toBeNull();
  });

  it('does not fire on the explicit = form or bare boolean flags', () => {
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified=false'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified=true'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--no-verified'], flags)).toBeNull();
  });

  it('does not fire on positionals or values that merely contain true/false', () => {
    expect(booleanFlagLiteralHint(['fast', 'p', 'P1', 'true'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'truthy'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--content', 'it is true'], flags)).toBeNull();
  });

  it('does not fire on unknown flags or after a bare -- separator', () => {
    expect(booleanFlagLiteralHint(['set', 'H1', '--bogus', 'false'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['server', '--', '--verified', 'false'], flags)).toBeNull();
    expect(booleanFlagLiteralHint(['set', 'H1', '--verified', 'false'], new Set())).toBeNull();
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
    expect(stderr).toContain('session:');
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
    expect(typeof parsed.source).toBe('string');
    expect(parsed.rendered).toContain('P1');
  });

  it('suggests --graphFormat when a render format is passed to --format', () => {
    const { status, stderr } = runCli(['graph', '--format', 'mermaid']);
    expect(status).toBe(1);
    expect(stderr).toContain('Invalid format: "mermaid"');
    expect(stderr).toContain('aot graph --graphFormat mermaid');
  });

  it('does not emit the graph-specific hint on other commands', () => {
    const { stderr } = runCli(['list', '--format', 'mermaid']);
    expect(stderr).not.toContain('--graphFormat');
  });

  it('rejects --verified false instead of silently setting verified=true', () => {
    const { status, stderr } = runCli(['set', 'P1', '--verified', 'false']);
    expect(status).toBe(1);
    expect(stderr).toContain('--verified=false');
    const shown = runCli(['show', 'P1', '--format', 'json']);
    expect(JSON.parse(shown.stdout).atom.isVerified).toBe(false);
  });

  it('honors the explicit = form for both polarities', () => {
    const on = runCli(['set', 'P1', '--verified=true', '--format', 'json']);
    expect(on.status).toBe(0);
    expect(JSON.parse(on.stdout).atom.isVerified).toBe(true);

    const rejected = runCli(['set', 'P1', '--verified', 'false']);
    expect(rejected.status).toBe(1);
    let shown = runCli(['show', 'P1', '--format', 'json']);
    expect(JSON.parse(shown.stdout).atom.isVerified).toBe(true); // unchanged by the rejected call

    const off = runCli(['set', 'P1', '--verified=false', '--format', 'json']);
    expect(off.status).toBe(0);
    expect(JSON.parse(off.stdout).atom.isVerified).toBe(false);
  });

  it('still allows literal true/false as values of non-boolean flags', () => {
    const { status, stdout } = runCli(['set', 'P1', '--content', 'true', '--format', 'json']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).atom.content).toBe('true');
    const restore = runCli(['set', 'P1', '--content', 'raw render premise']);
    expect(restore.status).toBe(0);
  });

  it('renders help examples in the --flag=value form', () => {
    const { stdout, stderr } = runCli(['set', '--help']);
    const help = stdout + stderr;
    expect(help).toContain('--verified=true');
    expect(help).not.toMatch(/--verified (true|false)/);
  });
});
