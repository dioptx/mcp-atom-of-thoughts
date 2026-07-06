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
});
