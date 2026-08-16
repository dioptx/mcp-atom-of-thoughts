import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn };
});

import { generateVisualizationHtml, writeVisualization, openInBrowser } from '../src/visualization.js';
import { getD3Script } from '../src/d3-bundle.js';
import type { GraphData } from '../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const sampleData: GraphData = {
  title: 'Test Plan',
  nodes: [
    { id: 'P1', type: 'premise', content: 'Test premise', confidence: 0.9, depth: 0 },
    { id: 'R1', type: 'reasoning', content: 'Test reasoning', confidence: 0.85, depth: 1 },
  ],
  links: [{ source: 'P1', target: 'R1' }],
};

describe('d3 bundle', () => {
  it('loads D3 script', () => {
    const d3 = getD3Script();
    expect(d3.length).toBeGreaterThan(0);
  });
});

describe('generateVisualizationHtml', () => {
  it('returns valid HTML string', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('contains window.AOT_DATA injection', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).toContain('window.AOT_DATA');
  });

  it('does not load D3 from CDN script tag', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).not.toContain('<script src="https://d3js.org');
  });

  it('contains inline D3 source', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).not.toContain('<!-- D3_INLINE -->');
  });

  it('injects the title', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).toContain('"Test Plan"');
  });

  it('injects node data', () => {
    const html = generateVisualizationHtml(sampleData);
    expect(html).toContain('"P1"');
    expect(html).toContain('"R1"');
  });
});

describe('writeVisualization', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes file to specified directory', () => {
    const html = '<html>test</html>';
    const filepath = writeVisualization(html, tmpDir);
    expect(fs.existsSync(filepath)).toBe(true);
    expect(filepath).toContain(tmpDir);
  });

  it('creates directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'dir');
    const filepath = writeVisualization('<html/>', nested);
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it('returns timestamped filename', () => {
    const filepath = writeVisualization('<html/>', tmpDir);
    expect(path.basename(filepath)).toMatch(/^aot-review-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.html$/);
  });

  it('uses custom name prefix', () => {
    const filepath = writeVisualization('<html/>', tmpDir, 'myplan');
    expect(path.basename(filepath)).toMatch(/^myplan-/);
  });

  it('file content matches input', () => {
    const html = '<html><body>test content</body></html>';
    const filepath = writeVisualization(html, tmpDir);
    expect(fs.readFileSync(filepath, 'utf-8')).toBe(html);
  });

  it('uses defaultOutputDir when no outputDir given', () => {
    const defaultDir = path.join(tmpDir, 'default');
    const filepath = writeVisualization('<html/>', undefined, undefined, defaultDir);
    expect(filepath).toContain(defaultDir);
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it('prefers outputDir over defaultOutputDir', () => {
    const explicit = path.join(tmpDir, 'explicit');
    const defaultDir = path.join(tmpDir, 'default');
    const filepath = writeVisualization('<html/>', explicit, undefined, defaultDir);
    expect(filepath).toContain(explicit);
  });
});

describe('openInBrowser', () => {
  beforeEach(() => {
    mocks.spawn.mockClear();
  });

  it('launches the platform opener via spawn with an argv array (no shell)', () => {
    openInBrowser('/tmp/plan.html');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(typeof cmd).toBe('string');
    expect(Array.isArray(args)).toBe(true);
    expect(opts?.shell).not.toBe(true);
  });

  it('passes a malicious filepath as a single literal argument (no shell re-parsing)', () => {
    const evil = '"; touch /tmp/aot-pwned; echo "';
    openInBrowser(evil);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = mocks.spawn.mock.calls[0];
    // The payload is carried verbatim as one argv element, never split into
    // separate shell words, so the injected command is never a standalone arg.
    expect(args).toContain(evil);
    expect(args).not.toContain('touch');
    expect(args).not.toContain('/tmp/aot-pwned');
  });
});
