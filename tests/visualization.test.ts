import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateVisualizationHtml, writeVisualization, escapeHtml } from '../src/visualization.js';
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

// Payload used across the DOM-XSS regression tests. A classic non-script
// vector (fires on image load error) plus a script-element breakout attempt.
const XSS_PAYLOAD = '<img src=x onerror=alert(1)>';
const BREAKOUT_PAYLOAD = '</script><img src=x onerror=alert(1)>';

const maliciousData: GraphData = {
  title: 'Evil Plan',
  nodes: [
    { id: 'P1', type: 'premise', content: XSS_PAYLOAD, confidence: 0.9, depth: 0 },
    { id: 'R1', type: 'reasoning', content: BREAKOUT_PAYLOAD, confidence: 0.8, depth: 1 },
  ],
  links: [{ source: 'P1', target: 'R1' }],
};

describe('escapeHtml', () => {
  // --- unit: the shared HTML-escape helper neutralizes every markup-significant char
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  // --- unit: a full XSS payload becomes inert text (no tag-opening '<' survives)
  it('neutralizes an <img onerror> payload', () => {
    const out = escapeHtml(XSS_PAYLOAD);
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  // --- unit: escapes '&' first so it does not double-encode entities, and is total
  it('is idempotent-safe on the ampersand and leaves plain text intact', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});

describe('generateVisualizationHtml - DOM-XSS hardening', () => {
  // --- security: the primary regression test. Attacker-influenceable atom
  //     content must NOT reach the generated HTML as live markup.
  it('does not emit attacker content as a raw, parseable HTML tag', () => {
    const html = generateVisualizationHtml(maliciousData);
    // The raw payload must never appear verbatim; embedding escapes '<' to \u003c.
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    // The escaped unicode form is what actually lands in the inline data script.
    expect(html).toContain('\\u003cimg src=x onerror=alert(1)\\u003e');
  });

  // --- security: data must not be able to close the <script> element early
  //     (e.g. "</script><img ...>") and inject nodes into the document.
  it('prevents <script> breakout from atom content', () => {
    const html = generateVisualizationHtml(maliciousData);
    expect(html).not.toContain('</script><img');
    expect(html).not.toContain(BREAKOUT_PAYLOAD);
    expect(html).toContain('\\u003c/script\\u003e');
  });

  // --- security/functional: the in-browser renderer escapes atom text at both
  //     innerHTML sinks (node content + phase bullet points) instead of
  //     concatenating it raw.
  it('wraps both innerHTML sinks with the escapeHtml helper', () => {
    const html = generateVisualizationHtml(maliciousData);
    expect(html).toContain('function escapeHtml(value)');
    expect(html).toContain('escapeHtml(node.content)');
    expect(html).toContain('escapeHtml(bp)');
    // The vulnerable bare concatenations must be gone.
    expect(html).not.toContain("'<div class=\"node-content-text\">' + node.content +");
    expect(html).not.toContain("'<li>' + bp +");
  });

  // --- functional: escaping a benign atom still round-trips the readable text
  //     (the data is present, just safely encoded).
  it('still carries benign content through (escaped) for rendering', () => {
    const html = generateVisualizationHtml({
      title: 'Plan',
      nodes: [{ id: 'P1', type: 'premise', content: 'a < b && c', confidence: 0.9, depth: 0 }],
      links: [],
    });
    expect(html).toContain('a \\u003c b \\u0026\\u0026 c');
  });

  // --- performance: escaping/embedding stays linear and fast even for a large,
  //     payload-laden graph (guards against catastrophic regex backtracking).
  it('escapes a large malicious graph quickly', () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => ({
      id: `N${i}`,
      type: 'reasoning' as const,
      content: XSS_PAYLOAD.repeat(5),
      confidence: 0.8,
      depth: 1,
    }));
    const start = Date.now();
    const html = generateVisualizationHtml({ title: 'Big', nodes, links: [] });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  // --- integration: the escaped payload survives the write-to-disk step, so the
  //     file a browser actually opens is also safe.
  it('writes a file whose on-disk HTML contains no raw payload', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-xss-'));
    try {
      const filepath = writeVisualization(generateVisualizationHtml(maliciousData), tmp);
      const onDisk = fs.readFileSync(filepath, 'utf-8');
      expect(onDisk).not.toContain('<img src=x onerror=alert(1)>');
      expect(onDisk).toContain('\\u003cimg');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
