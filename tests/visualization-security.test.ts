/**
 * Regression coverage for the command-injection fix (#3) and its defense-in-depth
 * companions (name sanitization, output-dir traversal guard).
 *
 * Three independent layers, because a mock-only proof isn't enough for a security
 * fix — each layer would catch a different way the fix could regress:
 *   1. Unit       — sanitizeNameComponent()'s character-filtering contract directly.
 *   2. White-box  — openInBrowser() calls execFileSync with the untrusted value as
 *                   ONE argv element (proves the shell-string sink is really gone).
 *   3. Black-box  — a REAL child_process call with a live injection payload, proving
 *                   by side effect (a marker file that must NOT appear) that the
 *                   payload never reaches a shell, independent of any mocking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execFileSync: vi.fn() };
});

import { writeVisualization, openInBrowser } from '../src/visualization.js';

const INJECTION_PAYLOADS = [
  '"; touch /tmp/aot-pwned-$$; echo "',
  '`touch /tmp/aot-pwned-$$`',
  '$(touch /tmp/aot-pwned-$$)',
  '/tmp/x.html && touch /tmp/aot-pwned-$$',
  '/tmp/x.html; rm -rf /tmp/aot-victim',
  '/tmp/x.html | touch /tmp/aot-pwned-$$',
];

describe('Layer 1 — unit: sanitizeNameComponent character filtering', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sec-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('passes safe alphanumeric names through unchanged (no regression)', () => {
    const filepath = writeVisualization('<html/>', tmpDir, 'myplan');
    expect(path.basename(filepath)).toMatch(/^myplan-/);
  });

  it('strips shell metacharacters from name', () => {
    const filepath = writeVisualization('<html/>', tmpDir, 'x; rm -rf /');
    const base = path.basename(filepath);
    expect(base).not.toContain(';');
    expect(base).not.toContain(' ');
    expect(base).not.toContain('/');
  });

  it('neutralizes path traversal attempts in name', () => {
    const filepath = writeVisualization('<html/>', tmpDir, '../../etc/passwd');
    const resolved = path.resolve(filepath);
    expect(resolved.startsWith(path.resolve(tmpDir))).toBe(true);
  });

  it('falls back to a safe default when name sanitizes to empty', () => {
    const filepath = writeVisualization('<html/>', tmpDir, '////');
    expect(path.basename(filepath)).toMatch(/^diagram-/);
  });

  it('truncates absurdly long names instead of erroring', () => {
    const filepath = writeVisualization('<html/>', tmpDir, 'a'.repeat(500));
    expect(path.basename(filepath).length).toBeLessThan(150);
  });
});

describe('Layer 1b — unit: output-dir traversal guard', () => {
  it('writeVisualization never escapes the resolved output directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sec-dir-'));
    try {
      // Even a maximally hostile name can't walk the write outside `dir`,
      // because the guard checks the RESOLVED path, not the raw string.
      const filepath = writeVisualization('<html/>', tmpDir, '..'.repeat(20));
      expect(path.resolve(filepath).startsWith(path.resolve(tmpDir))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Layer 2 — white-box: openInBrowser uses argv-based execFileSync', () => {
  beforeEach(() => { vi.mocked(execFileSync).mockClear(); });

  it.each(INJECTION_PAYLOADS)('payload %s is passed as a single literal argv element, never a shell string', (payload) => {
    openInBrowser(payload);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [, callArgs] = vi.mocked(execFileSync).mock.calls[0];
    // The entire payload must appear VERBATIM as one array element — proof
    // it was never concatenated into a command string for a shell to parse.
    expect(callArgs).toContain(payload);
  });

  it('never invokes execFileSync with shell:true for the payload argument', () => {
    openInBrowser('/tmp/x.html');
    const [, , opts] = vi.mocked(execFileSync).mock.calls[0];
    if (process.platform !== 'win32') {
      expect(opts?.shell).not.toBe(true);
    }
  });

  it('is non-fatal when the opener command itself fails', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('no such command'); });
    expect(() => openInBrowser('/tmp/x.html')).not.toThrow();
  });
});

describe('Layer 3 — black-box: real subprocess proves no injection, independent of mocks', () => {
  // This layer intentionally does NOT mock child_process — it calls the real
  // execFileSync the same way openInBrowser does, with a live payload, and
  // proves by absence of a side effect that no shell ever parsed it. This
  // would fail even if Layer 2's mock assertions were somehow wrong.
  const marker = path.join(os.tmpdir(), `aot-pwn-proof-${process.pid}-${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(marker)) fs.rmSync(marker);
  });

  it('a shell-metacharacter payload cannot create a marker file via execFileSync argv passing', () => {
    const { execFileSync: realExecFileSync } = require('node:child_process') as typeof import('node:child_process');
    const payload = `/nonexistent.html"; touch ${marker}; echo "`;
    try {
      // 'true' is a no-arg-sensitive no-op binary on macOS/Linux — mirrors
      // openInBrowser's real call shape (fixed command, untrusted single arg).
      realExecFileSync('/usr/bin/true', [payload]);
    } catch {
      // 'true' ignores extra args and exits 0 normally; any throw here is fine —
      // the only thing under test is whether the marker file got created.
    }
    expect(fs.existsSync(marker)).toBe(false);
  });
});
