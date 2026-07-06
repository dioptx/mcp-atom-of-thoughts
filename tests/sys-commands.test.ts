/**
 * Server-level and built-CLI tests for the systems layer: causal link
 * storage (add/remove/get), duplicate and refuted rejection, persistence via
 * exportState/importState, reset/rm sweeps, export/import round-trip, and
 * `aot sys link|unlink|loops` against the built CLI with isolated AOT_STATE.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AtomOfThoughtsServer, type AtomServerSnapshot } from '../src/atom-server.js';
import { exportGraph, graphDataToAtoms } from '../src/graph-export.js';
import type { Session } from '../src/types.js';

function seed(server: AtomOfThoughtsServer, ids: Array<[string, string]>): void {
  for (const [atomId, atomType] of ids) {
    server.processAtom({ atomId, content: atomId, atomType });
  }
}

describe('causal link server helpers', () => {
  it('adds, reads, and removes causal links', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const link = server.addCausalLink({ from: 'P1', to: 'R1', sign: '+', label: 'drives' });
    expect(link.id).toBe('cl:P1>R1');
    expect(link.gain).toBe('med'); // default applied at write time
    expect(server.getCausalLinks()).toEqual([link]);
    const removed = server.removeCausalLink('P1', 'R1');
    expect(removed.id).toBe('cl:P1>R1');
    expect(server.getCausalLinks()).toEqual([]);
  });

  it('rejects duplicate (from,to) pairs and unknown removals', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    server.addCausalLink({ from: 'P1', to: 'R1', sign: '+' });
    expect(() => server.addCausalLink({ from: 'P1', to: 'R1', sign: '-' })).toThrow(/already exists/i);
    // Reverse direction is a different pair.
    expect(() => server.addCausalLink({ from: 'R1', to: 'P1', sign: '-' })).not.toThrow();
    expect(() => server.removeCausalLink('R1', 'GHOST')).toThrow(/not found/i);
  });

  it('rejects missing and refuted endpoints', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['H1', 'hypothesis']]);
    expect(() => server.addCausalLink({ from: 'P1', to: 'GHOST', sign: '+' })).toThrow(/not found/i);
    server.getAtoms().H1.isRefuted = true;
    expect(() => server.addCausalLink({ from: 'P1', to: 'H1', sign: '+' })).toThrow(/refuted atom/i);
    expect(() => server.addCausalLink({ from: 'H1', to: 'P1', sign: '+' })).toThrow(/refuted atom/i);
  });

  it('persists causal links through exportState/importState and dedupes hand-edited duplicates', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const link = server.addCausalLink({ from: 'P1', to: 'R1', sign: '-' });
    const snapshot = JSON.parse(JSON.stringify(server.exportState())) as AtomServerSnapshot;

    const restored = new AtomOfThoughtsServer(5);
    restored.importState(snapshot);
    expect(restored.getCausalLinks()).toEqual([link]);

    // Hand-edited duplicate pair: normalization keeps the earliest created.
    const dup = JSON.parse(JSON.stringify(snapshot)) as AtomServerSnapshot;
    dup.sessions.default.causalLinks!.push({ ...link, sign: '+', created: link.created + 1000 });
    const deduped = new AtomOfThoughtsServer(5);
    deduped.importState(dup);
    expect(deduped.getCausalLinks()).toHaveLength(1);
    expect(deduped.getCausalLinks()[0].sign).toBe('-');
  });

  it('loads old snapshots without causalLinks and materializes the array on first mutation', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const snapshot = JSON.parse(JSON.stringify(server.exportState())) as AtomServerSnapshot;
    delete (snapshot.sessions.default as Partial<Session>).causalLinks; // pre-upgrade state file

    const upgraded = new AtomOfThoughtsServer(5);
    upgraded.importState(snapshot);
    expect(upgraded.getCausalLinks()).toEqual([]); // read path normalizes
    const link = upgraded.addCausalLink({ from: 'P1', to: 'R1', sign: '+' }); // mutation path materializes
    expect(upgraded.getCausalLinks()).toEqual([link]);
  });

  it('resetSession clears causal links (no stale-link leak)', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    server.addCausalLink({ from: 'P1', to: 'R1', sign: '+' });
    server.resetSession();
    expect(server.getAtoms()).toEqual({});
    expect(server.getCausalLinks()).toEqual([]);
  });

  it('removing an atom removes all causal links touching it, with and without --force', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning'], ['H1', 'hypothesis']]);
    server.addCausalLink({ from: 'P1', to: 'H1', sign: '+' });
    server.addCausalLink({ from: 'H1', to: 'R1', sign: '-' });
    server.addCausalLink({ from: 'P1', to: 'R1', sign: '+' });

    const noForce = server.removeAtom('H1');
    expect(noForce.removedCausalLinks?.sort()).toEqual(['cl:H1>R1', 'cl:P1>H1']);
    expect(server.getCausalLinks().map(l => l.id)).toEqual(['cl:P1>R1']);

    // Forced removal (R1 has a dependent? none here — force an atom with dependents)
    server.processAtom({ atomId: 'R2', content: 'R2', atomType: 'reasoning', dependencies: ['P1'] });
    server.addCausalLink({ from: 'R2', to: 'P1', sign: '-' });
    const forced = server.removeAtom('P1', undefined, true);
    expect(forced.removedCausalLinks?.sort()).toEqual(['cl:P1>R1', 'cl:R2>P1']);
    expect(server.getCausalLinks()).toEqual([]);
  });

  it('exportGraph carries causalLinks (endpoint-filtered) and omits the field when empty', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const link = server.addCausalLink({ from: 'P1', to: 'R1', sign: '-', gain: 'high' });
    const graph = exportGraph(server.getAtoms(), server.getAtomOrder(), 'T', server.getCausalLinks());
    expect(graph.causalLinks).toEqual([link]);
    // Round-trip: atoms rebuild cleanly and the causal layer survives alongside.
    const { atoms } = graphDataToAtoms(graph);
    expect(Object.keys(atoms).sort()).toEqual(['P1', 'R1']);

    const bare = exportGraph(server.getAtoms(), server.getAtomOrder());
    expect('causalLinks' in bare).toBe(false);
    const filtered = exportGraph({ P1: server.getAtoms().P1 }, ['P1'], 'T', server.getCausalLinks());
    expect('causalLinks' in filtered).toBe(false); // R1 endpoint missing -> link dropped -> field omitted
  });
});

describe('aot sys commands (built CLI)', () => {
  const CLI_PATH = path.resolve(__dirname, '..', 'build', 'cli.js');
  const hasBuild = fs.existsSync(CLI_PATH);
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-sys-test-'));
    env = { ...process.env, AOT_STATE: path.join(stateDir, 'state.json'), AOT_BR_AUTO: '0' };
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function runJson(args: string[]): Record<string, unknown> {
    const result = spawnSync('node', [CLI_PATH, ...args, '--format', 'json'], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  it.skipIf(!hasBuild)('sys link persists across processes; sys loops classifies; unlink removes', () => {
    runJson(['fast', 'premise', 'P1', 'load rises']);
    runJson(['fast', 'reasoning', 'R1', 'latency rises']);
    const linked = runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus', '--gain', 'high']);
    expect((linked.link as Record<string, unknown>).id).toBe('cl:P1>R1');
    runJson(['sys', 'link', 'R1', 'P1', '--sign', 'minus']);

    // Fresh process: state round-trips from disk.
    const loops = runJson(['sys', 'loops']);
    expect(loops.loopCount).toBe(1);
    expect(loops.truncated).toBe(false);
    const loop = (loops.loops as Array<Record<string, unknown>>)[0];
    expect(loop.id).toBe('loop:P1>R1');
    expect(loop.kind).toBe('balancing');
    expect(loop.loopGain).toBe(2);

    const kindFiltered = runJson(['sys', 'loops', '--kind', 'reinforcing']);
    expect(kindFiltered.loopCount).toBe(0);
    expect(kindFiltered.totalLoopCount).toBe(1);

    const unlinked = runJson(['sys', 'unlink', 'R1', 'P1']);
    expect(unlinked.removed).toBe('cl:R1>P1');
    expect(runJson(['sys', 'loops']).loopCount).toBe(0);
  });

  it.skipIf(!hasBuild)('rejects duplicate links with CAUSAL_LINK_EXISTS and refuted endpoints with REFUTED_ATOM', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'hypothesis', 'H1', 'b']);
    runJson(['sys', 'link', 'P1', 'H1', '--sign', 'plus']);
    const dup = spawnSync('node', [CLI_PATH, 'sys', 'link', 'P1', 'H1', '--sign', 'minus', '--format', 'json'], { env, encoding: 'utf8' });
    expect(dup.status).not.toBe(0);
    expect(`${dup.stdout}${dup.stderr}`).toContain('CAUSAL_LINK_EXISTS');

    runJson(['fast', 'verification', 'V1', 'refuting evidence', '--deps', 'H1', '--refutes=true', '--verified=true']);
    const refuted = spawnSync('node', [CLI_PATH, 'sys', 'link', 'H1', 'P1', '--sign', 'plus', '--format', 'json'], { env, encoding: 'utf8' });
    expect(refuted.status).not.toBe(0);
    expect(`${refuted.stdout}${refuted.stderr}`).toContain('REFUTED_ATOM');
  });

  it.skipIf(!hasBuild)('export/import round-trips the causal layer', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b', '--deps', 'P1']);
    runJson(['sys', 'link', 'P1', 'R1', '--sign', 'minus', '--gain', 'low']);
    const exported = runJson(['export']);
    const graph = (exported.graph as Record<string, unknown>);
    expect(Array.isArray(graph.causalLinks)).toBe(true);

    const file = path.join(stateDir, 'graph.json');
    fs.writeFileSync(file, JSON.stringify(graph));
    const imported = runJson(['import', file, '--sessionId', 'restored']);
    expect(imported.importedCausalLinks).toBe(1);

    const loops = runJson(['sys', 'loops', '--sessionId', 'restored']);
    expect(loops.causalLinkCount).toBe(1);
    // Loops also readable straight from the file via --from.
    const fromFile = runJson(['sys', 'loops', '--from', file]);
    expect(fromFile.causalLinkCount).toBe(1);
  });

  it.skipIf(!hasBuild)('sys leverage ranks atoms with --top slicing', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b']);
    runJson(['fast', 'reasoning', 'R2', 'c']);
    runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus', '--gain', 'high']);
    runJson(['sys', 'link', 'R1', 'P1', '--sign', 'plus', '--gain', 'high']);
    runJson(['sys', 'link', 'P1', 'R2', '--sign', 'plus']);

    const full = runJson(['sys', 'leverage']);
    expect(full.source).toMatch(/^session:/);
    expect(full.truncated).toBe(false);
    expect(full.totalAtoms).toBe(3);
    const points = full.leveragePoints as Array<Record<string, unknown>>;
    expect(points).toHaveLength(3);
    expect(points[0].atomId).toBe('P1'); // hub: 2 out-links + reinforcing loop
    expect(points[0].rank).toBe(1);
    expect(points[0].score).toBe(1);
    expect(points[0].rationaleCodes).toContain('HIGH_CAUSAL_OUT_DEGREE');

    const top = runJson(['sys', 'leverage', '--top', '1']);
    expect(top.leveragePoints as unknown[]).toHaveLength(1);
  });

  it.skipIf(!hasBuild)('sys simulate propagates a perturbation with source/truncated envelope', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b']);
    runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus']);
    runJson(['sys', 'link', 'R1', 'P1', '--sign', 'minus']);

    const sim = runJson(['sys', 'simulate', 'P1', '--direction', 'up']);
    expect(sim.source).toMatch(/^session:/);
    expect(sim.truncated).toBe(false);
    expect(sim.sourceAtomId).toBe('P1');
    expect(sim.inputDirection).toBe('up');
    const effects = sim.effects as Array<Record<string, unknown>>;
    expect(effects).toHaveLength(1);
    expect(effects[0].atomId).toBe('R1');
    expect(sim.loopsTraversed).toEqual(['loop:P1>R1']);

    const missing = spawnSync('node', [CLI_PATH, 'sys', 'simulate', 'GHOST', '--direction', 'up', '--format', 'json'], { env, encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(`${missing.stdout}${missing.stderr}`).toContain('ATOM_NOT_FOUND');
  });

  it.skipIf(!hasBuild)('sys lint reports issues with counts; --gate exits 1; --failOn filters', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'premise', 'P2', 'b']);
    runJson(['sys', 'link', 'P1', 'P2', '--sign', 'minus']);
    runJson(['sys', 'link', 'P2', 'P1', '--sign', 'plus']);

    const lint = runJson(['sys', 'lint']);
    expect(lint.source).toMatch(/^session:/);
    expect(lint.truncated).toBe(false);
    const issues = lint.issues as Array<Record<string, unknown>>;
    expect(issues.map(i => i.code)).toContain('BALANCING_LOOP_NO_SENSOR');
    expect((lint.counts as Record<string, number>).BALANCING_LOOP_NO_SENSOR).toBe(1);
    expect(lint.gate).toBeUndefined(); // no gate envelope without --gate

    const gated = spawnSync('node', [CLI_PATH, 'sys', 'lint', '--gate=true', '--format', 'json'], { env, encoding: 'utf8' });
    expect(gated.status).toBe(1);
    const gatedPayload = JSON.parse(gated.stdout) as Record<string, unknown>;
    expect((gatedPayload.gate as Record<string, unknown>).failed).toBe(true);

    // --failOn excluding the firing code (incl. truncation-style exclusion) passes the gate.
    const excused = spawnSync('node', [CLI_PATH, 'sys', 'lint', '--gate=true', '--failOn', 'LOOP_ENUMERATION_TRUNCATED', '--format', 'json'], { env, encoding: 'utf8' });
    expect(excused.status).toBe(0);
    const excusedPayload = JSON.parse(excused.stdout) as Record<string, unknown>;
    expect((excusedPayload.gate as Record<string, unknown>).failed).toBe(false);
    expect((excusedPayload.gate as Record<string, unknown>).failOn).toEqual(['LOOP_ENUMERATION_TRUNCATED']);
  });

  it.skipIf(!hasBuild)('missing --sign: atom existence beats MISSING_SIGN, no raw zod dump, plus still works', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b']);

    // 1. Unknown atom without --sign: the atom error wins.
    const ghost = spawnSync('node', [CLI_PATH, 'sys', 'link', 'GHOST', 'R1', '--format', 'json'], { env, encoding: 'utf8' });
    expect(ghost.status).not.toBe(0);
    expect(`${ghost.stdout}${ghost.stderr}`).toContain('ATOM_NOT_FOUND');

    // 2. Valid atoms without --sign: friendly MISSING_SIGN domain error.
    const unsigned = spawnSync('node', [CLI_PATH, 'sys', 'link', 'P1', 'R1', '--format', 'json'], { env, encoding: 'utf8' });
    expect(unsigned.status).not.toBe(0);
    const output = `${unsigned.stdout}${unsigned.stderr}`;
    expect(output).toContain('MISSING_SIGN');
    expect(output).toContain('missing required option --sign');
    expect(output).not.toContain('VALIDATION_ERROR');

    // 3. Regression: --sign plus still succeeds.
    const linked = runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus']);
    expect((linked.link as Record<string, unknown>).id).toBe('cl:P1>R1');
  });

  it.skipIf(!hasBuild)('sys help paths exit 0 with usage text (regression pin)', () => {
    const sysHelp = spawnSync('node', [CLI_PATH, 'sys', '--help'], { env, encoding: 'utf8' });
    expect(sysHelp.status).toBe(0);
    expect(`${sysHelp.stdout}${sysHelp.stderr}`).toMatch(/link/);
    const linkHelp = spawnSync('node', [CLI_PATH, 'sys', 'link', '--help'], { env, encoding: 'utf8' });
    expect(linkHelp.status).toBe(0);
    expect(`${linkHelp.stdout}${linkHelp.stderr}`).toMatch(/--sign/);
    expect(`${linkHelp.stdout}${linkHelp.stderr}`).toMatch(/\(required\)/);
  });

  it.skipIf(!hasBuild)('reset clears causal links via the CLI too', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b']);
    runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus']);
    runJson(['sys', 'link', 'R1', 'P1', '--sign', 'plus']);
    expect(runJson(['sys', 'loops']).loopCount).toBe(1);
    runJson(['reset']);
    const after = runJson(['sys', 'loops']);
    expect(after.causalLinkCount).toBe(0);
    expect(after.loopCount).toBe(0);
  });

  it.skipIf(!hasBuild)('R3-CLI-01: session graph render includes causal links (both paths)', () => {
    runJson(['fast', 'premise', 'A', 'demand']);
    runJson(['fast', 'reasoning', 'B', 'capacity']);
    runJson(['sys', 'link', 'A', 'B', '--sign', 'plus', '--gain', 'high', '--label', 'drives']);
    // Session path: raw stdout render (no --format).
    const mer = spawnSync('node', [CLI_PATH, 'graph', '--graphFormat', 'mermaid'], { env, encoding: 'utf8' });
    expect(mer.status).toBe(0);
    expect(mer.stdout).toContain('A -.->|+/high drives| B');
    // --from path regression (R3-CLI-02): export to file, render from it.
    const exp = runJson(['export']);
    const graphFile = path.join(stateDir, 'g.json');
    fs.writeFileSync(graphFile, JSON.stringify((exp as { graph: unknown }).graph));
    const dot = spawnSync('node', [CLI_PATH, 'graph', '--from', graphFile, '--graphFormat', 'dot'], { env, encoding: 'utf8' });
    expect(dot.stdout).toContain('style=dashed');
    expect(dot.stdout).toContain('#9467bd');
  });

  it.skipIf(!hasBuild)('R3-UPD: sys link --update upserts (create then update in place)', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    runJson(['fast', 'reasoning', 'R1', 'b']);
    const created = runJson(['sys', 'link', 'P1', 'R1', '--sign', 'plus', '--update']);
    expect(created.updated).toBe(false);
    const cid = (created.link as Record<string, unknown>).id;
    const ccreated = (created.link as Record<string, unknown>).created;
    const updated = runJson(['sys', 'link', 'P1', 'R1', '--sign', 'minus', '--gain', 'high', '--update']);
    expect(updated.updated).toBe(true);
    expect((updated.link as Record<string, unknown>).id).toBe(cid);
    expect((updated.link as Record<string, unknown>).created).toBe(ccreated);
    expect((updated.link as Record<string, unknown>).sign).toBe('-');
    // Without --update the duplicate still errors.
    const dup = spawnSync('node', [CLI_PATH, 'sys', 'link', 'P1', 'R1', '--sign', 'plus', '--format', 'json'], { env, encoding: 'utf8' });
    expect(dup.status).not.toBe(0);
    expect(`${dup.stdout}${dup.stderr}`).toContain('CAUSAL_LINK_EXISTS');
  });

  it.skipIf(!hasBuild)('R3-P1: sys simulate --direction error names the flag (missing, bad, positional)', () => {
    runJson(['fast', 'premise', 'P1', 'a']);
    for (const args of [['sys', 'simulate', 'P1'], ['sys', 'simulate', 'P1', '--direction', 'sideways'], ['sys', 'simulate', 'P1', 'up']]) {
      const r = spawnSync('node', [CLI_PATH, ...args, '--format', 'json'], { env, encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain('VALIDATION_ERROR');
      expect(out).toContain('--direction');
    }
  });
});


describe('upsertCausalLink (round 3)', () => {
  it('updates an existing link in place, preserving id and created', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const created = server.addCausalLink({ from: 'P1', to: 'R1', sign: '+', gain: 'low', label: 'drives' });
    const { link, updated } = server.upsertCausalLink({ from: 'P1', to: 'R1', sign: '-', gain: 'high' });
    expect(updated).toBe(true);
    expect(link.id).toBe(created.id);
    expect(link.created).toBe(created.created);
    expect(link.sign).toBe('-');
    expect(link.gain).toBe('high');
    expect(link.label).toBeUndefined(); // omitted label clears the old one
    expect(server.getCausalLinks()).toHaveLength(1);
  });

  it('creates when the pair is absent (updated:false)', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['R1', 'reasoning']]);
    const { link, updated } = server.upsertCausalLink({ from: 'P1', to: 'R1', sign: '+' });
    expect(updated).toBe(false);
    expect(link.id).toBe('cl:P1>R1');
    expect(link.gain).toBe('med');
  });

  it('rejects refuted and missing endpoints like addCausalLink', () => {
    const server = new AtomOfThoughtsServer(5);
    seed(server, [['P1', 'premise'], ['H1', 'hypothesis']]);
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'refutes', dependencies: ['H1'], confidence: 0.9, isVerified: true, polarity: 'refutes' });
    expect(() => server.upsertCausalLink({ from: 'H1', to: 'P1', sign: '+' })).toThrow(/refuted/i);
    expect(() => server.upsertCausalLink({ from: 'P1', to: 'GHOST', sign: '+' })).toThrow(/not found/i);
  });
});
