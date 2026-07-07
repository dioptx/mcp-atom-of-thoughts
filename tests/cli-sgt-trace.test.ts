/**
 * Built-CLI tests for `aot sgt trace` (round 3 unified trace): baseline
 * byte-identity with `aot graph` (explicit --graphFormat on BOTH commands,
 * stdout only — the non-explicit output-format branch emits a stderr hint and
 * is out of scope), pre-Round-3 golden equality, I1 zero-subprocess
 * operation, and the per-format [sgt:slug] tag grammar.
 *
 * Isolation matches the other cli-sgt suites: per-test AOT_STATE temp file,
 * POSIX #!/bin/sh fixture SGT_BINs (I5), chmod +x re-applied in beforeAll.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sgtNamespace } from '../src/sgt-bridge.js';
import { chmodFixtures, createHarness, requireBuild, type SgtCliHarness } from './helpers/sgt-cli-harness.js';

requireBuild();

const QUERY = 'deploy kubernetes service';
const NS = sgtNamespace(QUERY);
const SLUG = 'k8s-manifest-generator';
const LONG_SLUG = 'kubernetes-deployment-creator--claude-specific--5eda8a52';
const GOLDEN_DIR = path.resolve(__dirname, 'fixtures', 'graph-golden');
const FORMATS = ['tree', 'mermaid', 'dot', 'canvas'] as const;
const NO_BIN = { SGT_BIN: '/nonexistent/binary' };

let h: SgtCliHarness;

beforeAll(() => {
  chmodFixtures();
});

beforeEach(() => {
  h = createHarness('aot-sgt-trace-test-');
});

afterEach(() => {
  h.cleanup();
});

function seedPlainSession(): void {
  h.runJson(['fast', 'premise', 'P1', 'API returns 500', '--confidence', '0.9']);
  h.runJson(['fast', 'reasoning', 'R1', 'Handler throws', '--deps', 'P1', '--confidence', '0.8']);
}

describe('trace baseline byte-identity with aot graph (no skill atoms)', () => {
  it.each(FORMATS)('%s: trace stdout === graph stdout === pre-Round-3 golden bytes', (graphFormat) => {
    seedPlainSession();
    // Explicit --graphFormat on BOTH commands; compare stdout only (the
    // stderr hint label legitimately differs between the two commands).
    const trace = h.run(['sgt', 'trace', '--graphFormat', graphFormat]);
    const graph = h.run(['graph', '--graphFormat', graphFormat]);
    expect(trace.status).toBe(0);
    expect(graph.status).toBe(0);
    expect(trace.stdout).toBe(graph.stdout);
    // Golden files were generated from the pre-Round-3 build: proves the
    // no-skill render path is byte-untouched by the tagging change.
    const golden = fs.readFileSync(path.join(GOLDEN_DIR, `${graphFormat}.txt`), 'utf8');
    expect(trace.stdout).toBe(golden);
  });
});

describe('trace I1: zero subprocess, works with no sgt binary (built CLI)', () => {
  it('identical stdout with SGT_BIN unset and SGT_BIN=/nonexistent/binary', () => {
    seedPlainSession();
    h.runJson(['sgt', 'route', QUERY]); // seed skill atoms with the working fixture
    for (const graphFormat of FORMATS) {
      // spawnSync drops env keys whose value is undefined — SGT_BIN truly unset.
      const withNoBin = h.run(['sgt', 'trace', '--graphFormat', graphFormat], NO_BIN);
      const withUnset = h.run(['sgt', 'trace', '--graphFormat', graphFormat], { SGT_BIN: undefined });
      expect(withNoBin.status, withNoBin.stderr).toBe(0);
      expect(withUnset.status, withUnset.stderr).toBe(0);
      expect(withUnset.stdout).toBe(withNoBin.stdout);
      expect(`${withNoBin.stdout}${withNoBin.stderr}`).not.toContain('SGT_UNAVAILABLE');
    }
  });

  it('advise_pending lint likewise never spawns: analyze stdout identical with SGT_BIN unset vs /nonexistent', () => {
    h.runJson(['sgt', 'route', QUERY]);
    const withNoBin = h.run(['analyze', '--format', 'json'], NO_BIN);
    const withUnset = h.run(['analyze', '--format', 'json'], { SGT_BIN: undefined });
    expect(withNoBin.status).toBe(0);
    expect(withUnset.status).toBe(0);
    // runId/generatedAt do not exist on analyze payloads — raw compare works.
    expect(withUnset.stdout).toBe(withNoBin.stdout);
    expect(JSON.parse(withNoBin.stdout).issues.some((issue: { code: string }) => issue.code === 'advise_pending')).toBe(true);
  });
});

describe('trace tag grammar per format (route-plan fixture)', () => {
  beforeEach(() => {
    h.runJson(['sgt', 'route', QUERY]);
  });

  it('tree: hypothesis line ends with " [sgt:{slug}]" (slug verbatim, double dashes intact); premise and reasoning untagged', () => {
    const out = h.run(['sgt', 'trace', '--graphFormat', 'tree'], NO_BIN).stdout;
    const lines = out.split('\n');
    const hypothesisLine = lines.find(line => line.includes(`${NS}h:${LONG_SLUG}`))!;
    expect(hypothesisLine.endsWith(` [sgt:${LONG_SLUG}]`)).toBe(true);
    // Tag appended AFTER content truncation: the truncated content ellipsis
    // still precedes the tag, so truncation boundaries are unchanged.
    expect(hypothesisLine).toContain(`… [sgt:${LONG_SLUG}]`);
    expect(lines.find(line => line.includes(`${NS}p`))).not.toContain('[sgt:');
    expect(lines.find(line => line.includes(`${NS}r:domain`))).not.toContain('[sgt:');
  });

  it('mermaid: tag sits inside the quoted label, after the truncated content, before the closing quote (post-mermaidEscape)', () => {
    const out = h.run(['sgt', 'trace', '--graphFormat', 'mermaid'], NO_BIN).stdout;
    const line = out.split('\n').find(l => l.startsWith(`  ${NS}h:${SLUG}[`))!;
    expect(line).toMatch(new RegExp(`… \\[sgt:${SLUG}\\]"\\]$`));
    expect(out.split('\n').find(l => l.startsWith(`  ${NS}p[`))).not.toContain('[sgt:');
  });

  it('dot: tag before the closing escaped quote (post quote-escaping)', () => {
    const out = h.run(['sgt', 'trace', '--graphFormat', 'dot'], NO_BIN).stdout;
    const line = out.split('\n').find(l => l.startsWith(`  "${NS}h:${SLUG}"`))!;
    expect(line).toMatch(new RegExp(`… \\[sgt:${SLUG}\\]"\\];$`));
  });

  it('canvas: hypothesis text ends with "\\nsgt:{slug}" (independent of the nodeLabel path); JSON parses; non-skill cards untouched', () => {
    const out = h.run(['sgt', 'trace', '--graphFormat', 'canvas'], NO_BIN).stdout;
    const canvas = JSON.parse(out) as { nodes: Array<{ id: string; text: string }> };
    const hypothesis = canvas.nodes.find(node => node.id === `${NS}h:${SLUG}`)!;
    expect(hypothesis.text.endsWith(`\nsgt:${SLUG}`)).toBe(true);
    const premise = canvas.nodes.find(node => node.id === `${NS}p`)!;
    expect(premise.text).not.toContain('sgt:packet');
    expect(premise.text.endsWith(QUERY)).toBe(true); // content is the last line — no tag
  });

  it('aot graph shows the SAME tags (skill atoms are ordinary atoms, spec I2): stdout byte-identical to trace', () => {
    for (const graphFormat of FORMATS) {
      const trace = h.run(['sgt', 'trace', '--graphFormat', graphFormat], NO_BIN);
      const graph = h.run(['graph', '--graphFormat', graphFormat], NO_BIN);
      expect(trace.stdout).toBe(graph.stdout);
      expect(trace.stdout).toContain(LONG_SLUG);
    }
  });

  it('--out writes the rendered trace to a file with the tags', () => {
    const outPath = path.join(h.stateDir, 'trace.mmd');
    const result = h.runJson(['sgt', 'trace', '--graphFormat', 'mermaid', '--out', outPath], NO_BIN);
    expect(result.out).toBe(outPath);
    expect(fs.readFileSync(outPath, 'utf8')).toContain(` [sgt:${SLUG}]`);
  });
});

describe('empty-session behavior identical to aot graph', () => {
  it('renders the empty graph without error, byte-identical to aot graph', () => {
    for (const graphFormat of FORMATS) {
      const trace = h.run(['sgt', 'trace', '--graphFormat', graphFormat], NO_BIN);
      const graph = h.run(['graph', '--graphFormat', graphFormat], NO_BIN);
      expect(trace.status).toBe(0);
      expect(trace.stdout).toBe(graph.stdout);
    }
  });
});
