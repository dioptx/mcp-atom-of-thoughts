import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(REPO_ROOT, 'examples');
const INPUT = path.join(EXAMPLES, 'example-trace.json');

const REVIEW_OUT = path.join(EXAMPLES, 'example-trace-review.html');
const FOCUS_OUT = path.join(EXAMPLES, 'example-trace-focus.html');

afterEach(() => {
  for (const f of [REVIEW_OUT, FOCUS_OUT]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe('examples/', () => {
  it('example-trace.json is valid JSON with the expected graph shape', () => {
    const raw = readFileSync(INPUT, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toHaveProperty('title');
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.links)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(0);
    // At least one verification atom should carry a `kills` field for the demo.
    const killingV = data.nodes.find(
      (n: { type: string; kills?: string[] }) =>
        n.type === 'verification' && Array.isArray(n.kills) && n.kills.length > 0,
    );
    expect(killingV).toBeDefined();
  });

  it('render-review.mjs produces non-empty HTML against the example', () => {
    execSync(`node ${path.join(EXAMPLES, 'render-review.mjs')} ${INPUT}`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    expect(existsSync(REVIEW_OUT)).toBe(true);
    const html = readFileSync(REVIEW_OUT, 'utf-8');
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('<!DOCTYPE html>');
    // The kill marker for the killing V atom should render.
    expect(html.toLowerCase()).toContain('kills');
  });

  it('render-focus.mjs produces non-empty HTML against the example', () => {
    execSync(`node ${path.join(EXAMPLES, 'render-focus.mjs')} ${INPUT}`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    expect(existsSync(FOCUS_OUT)).toBe(true);
    const html = readFileSync(FOCUS_OUT, 'utf-8');
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain('<!DOCTYPE html>');
    // The focus viewer should surface the kill banner.
    expect(html).toContain('KILLS');
  });
});
