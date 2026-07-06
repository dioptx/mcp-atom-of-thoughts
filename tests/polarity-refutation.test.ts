import { describe, expect, it } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';
import { AtomOfThoughtsLightServer } from '../src/atom-light-server.js';
import { exportGraph, graphDataToAtoms } from '../src/graph-export.js';

describe('refuting evidence (polarity)', () => {
  it('a verified refuting verification marks its hypothesis refuted, never verified', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'cache is the bottleneck', confidence: 0.8 });
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'benchmark REFUTES H1', dependencies: ['H1'], confidence: 0.9, isVerified: true, polarity: 'refutes' });
    const atoms = server.getAtoms();
    expect(atoms['H1'].isVerified).toBe(false);
    expect(atoms['H1'].isRefuted).toBe(true);
    // No auto-conclusion may be spawned from refuted support.
    expect(Object.keys(atoms).filter(id => /^C\d+$/.test(id))).toEqual([]);
  });

  it('refuting a conclusion removes it from verifiedConclusions and blocks termination', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'C9', atomType: 'conclusion', content: 'ship it', confidence: 0.95, isVerified: true });
    expect(server.getBestConclusion()?.atomId).toBe('C9');
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'prod incident REFUTES C9', dependencies: ['C9'], confidence: 0.9, isVerified: true, polarity: 'refutes' });
    expect(server.getBestConclusion()).toBeNull();
    expect(server.getTerminationStatus().shouldTerminate).toBe(false);
    expect(server.getAtoms()['C9'].isRefuted).toBe(true);
  });

  it('set --verified on a refuting verification propagates refutation (create/set parity)', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'H2', atomType: 'hypothesis', content: 'pool size unset', confidence: 0.8 });
    server.processAtom({ atomId: 'V2', atomType: 'verification', content: 'env dump REFUTES H2', dependencies: ['H2'], confidence: 0.9, polarity: 'refutes' });
    server.updateAtom('V2', { isVerified: true });
    expect(server.getAtoms()['H2'].isRefuted).toBe(true);
    expect(server.getAtoms()['H2'].isVerified).toBe(false);
  });

  it('supporting verification does not verify premise/reasoning deps, but does verify conclusions and nested verifications', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'p', confidence: 0.9 });
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'c', dependencies: ['P1'], confidence: 0.92 });
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'v', dependencies: ['P1', 'C1'], confidence: 0.9, isVerified: true });
    const atoms = server.getAtoms();
    expect(atoms['P1'].isVerified).toBe(false);
    expect(atoms['C1'].isVerified).toBe(true);
    expect(server.getBestConclusion()?.atomId).toBe('C1');
  });

  it('polarity is rejected on non-verification atoms', () => {
    const server = new AtomOfThoughtsServer(5);
    const result = server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'h', polarity: 'refutes' });
    expect(JSON.parse(result.content[0].text).error).toMatch(/polarity/i);
    server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'h' });
    expect(() => server.updateAtom('H1', { polarity: 'refutes' })).toThrow(/polarity/i);
  });
});

describe('fast/full parity', () => {
  it('fast mode rejects dangling dependencies and derives depth', () => {
    const light = new AtomOfThoughtsLightServer(3);
    const bad = JSON.parse(light.processAtom({ atomId: 'R1', atomType: 'reasoning', content: 'r', dependencies: ['GHOST'] }).content[0].text);
    expect(bad.error).toMatch(/not yet created/);
    light.processAtom({ atomId: 'P1', atomType: 'premise', content: 'p' });
    const ok = JSON.parse(light.processAtom({ atomId: 'R1', atomType: 'reasoning', content: 'r', dependencies: ['P1'] }).content[0].text);
    expect(ok.depth).toBe(1);
    expect(light.getAtoms()['P1'].depth).toBe(0);
  });

  it('creation-time verified conclusion registers in verifiedConclusions (both servers)', () => {
    for (const server of [new AtomOfThoughtsServer(5), new AtomOfThoughtsLightServer(3)]) {
      server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', confidence: 0.92, isVerified: true });
      expect(server.getBestConclusion()?.atomId).toBe('C1');
      expect(server.getTerminationStatus().shouldTerminate).toBe(true);
    }
  });

  it('overwrites are marked in the payload', () => {
    const server = new AtomOfThoughtsServer(5);
    const first = JSON.parse(server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'a' }).content[0].text);
    expect(first.overwritten).toBeUndefined();
    const second = JSON.parse(server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'b' }).content[0].text);
    expect(second.overwritten).toBe(true);
  });

  it('auto-spawned sessions are announced in the payload', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', confidence: 0.95, isVerified: true });
    const next = JSON.parse(server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'new problem' }).content[0].text);
    expect(next.autoSpawnedSession).toBe('default-2');
    expect(next.sessionId).toBe('default-2');
  });
});

describe('session lifecycle', () => {
  it('archiveIfTerminated archives after a set pushes past the threshold', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', confidence: 0.85, isVerified: true });
    expect(server.getTerminationStatus().shouldTerminate).toBe(false);
    server.updateAtom('C1', { confidence: 0.92 });
    const result = server.archiveIfTerminated();
    expect(result.shouldTerminate).toBe(true);
    expect(result.archived).toBe(true);
    expect(server.listSessions().find(s => s.id === 'default')?.status).toBe('completed');
  });

  it('setSessionStatus archives and reopens manually', () => {
    const server = new AtomOfThoughtsServer(5);
    expect(server.setSessionStatus('completed').status).toBe('completed');
    expect(server.setSessionStatus('active').status).toBe('active');
  });

  it('termination detail explains what is missing', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', confidence: 0.85, isVerified: true });
    const status = server.getTerminationStatus();
    expect(status.reason).toContain('0.85');
    expect(status.detail).toMatchObject({
      maxDepth: 5,
      verifiedConclusionCount: 1,
      bestVerifiedConclusionConfidence: 0.85,
      conclusionConfidenceThreshold: 0.9,
    });
  });
});

describe('evidence and export round-trip', () => {
  it('evidence refs persist through create, update, export, and re-import', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'h', confidence: 0.8, evidence: ['probe.json'] });
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'v', dependencies: ['H1'], confidence: 0.9, isVerified: true, polarity: 'refutes', evidence: ['https://ci.example/run/1'] });
    server.updateAtom('H1', { evidence: ['probe.json', 'bench.txt'] });

    const graph = exportGraph(server.getAtoms(), server.getAtomOrder(), 'round trip');
    const { atoms, atomOrder } = graphDataToAtoms(graph);
    expect(atomOrder).toEqual(['H1', 'V1']);
    expect(atoms['H1'].evidence).toEqual(['probe.json', 'bench.txt']);
    expect(atoms['H1'].isRefuted).toBe(true);
    expect(atoms['V1'].polarity).toBe('refutes');
    // Dependency edges rebuild from links: V1 depends on H1.
    expect(atoms['V1'].dependencies).toEqual(['H1']);
    expect(atoms['H1'].dependencies).toEqual([]);
  });
});
