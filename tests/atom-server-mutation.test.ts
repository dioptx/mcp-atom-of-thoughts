import { describe, expect, it } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';

function makeChain(): AtomOfThoughtsServer {
  const server = new AtomOfThoughtsServer(5);
  server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'premise', confidence: 0.9 });
  server.processAtom({ atomId: 'R1', atomType: 'reasoning', content: 'reasoning', dependencies: ['P1'], confidence: 0.8 });
  server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'hypothesis', dependencies: ['R1'], confidence: 0.7 });
  return server;
}

describe('atom mutation and integrity guards', () => {
  it('rejects atom overwrites that would create a dependency cycle', () => {
    const server = makeChain();
    const result = server.processAtom({ atomId: 'P1', atomType: 'premise', content: 'now cyclic', dependencies: ['H1'] });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/cycle/i);
    // Original atom untouched
    expect(server.getAtoms()['P1'].dependencies).toEqual([]);
  });

  it('updateAtom patches confidence, content, and verification', () => {
    const server = makeChain();
    const updated = server.updateAtom('H1', { confidence: 0.95, content: 'refined hypothesis', isVerified: true });
    expect(updated.confidence).toBe(0.95);
    expect(updated.content).toBe('refined hypothesis');
    expect(server.getAtoms()['H1'].isVerified).toBe(true);
  });

  it('updateAtom validates dependency existence and cycles', () => {
    const server = makeChain();
    expect(() => server.updateAtom('H1', { dependencies: ['MISSING'] })).toThrow(/not yet created/);
    expect(() => server.updateAtom('P1', { dependencies: ['H1'] })).toThrow(/cycle/i);
    expect(() => server.updateAtom('H1', { confidence: 2 })).toThrow(/between 0 and 1/);
    expect(() => server.updateAtom('GHOST', { confidence: 0.5 })).toThrow(/not found/);
  });

  it('updateAtom verification of a conclusion maintains verifiedConclusions', () => {
    const server = makeChain();
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', dependencies: ['H1'], confidence: 0.85 });
    server.updateAtom('C1', { isVerified: true });
    expect(server.getBestConclusion()?.atomId).toBe('C1');
    server.updateAtom('C1', { isVerified: false });
    expect(server.getBestConclusion()).toBeNull();
  });

  it('removeAtom refuses while dependents exist, force detaches', () => {
    const server = makeChain();
    expect(() => server.removeAtom('P1')).toThrow(/dependents/);
    const result = server.removeAtom('P1', undefined, true);
    expect(result).toEqual({ removed: 'P1', detachedFrom: ['R1'] });
    expect(server.getAtoms()['P1']).toBeUndefined();
    expect(server.getAtoms()['R1'].dependencies).toEqual([]);
    expect(server.getAtomOrder()).not.toContain('P1');
  });

  it('removeAtom of a leaf works without force and cleans verifiedConclusions', () => {
    const server = makeChain();
    server.processAtom({ atomId: 'C1', atomType: 'conclusion', content: 'done', dependencies: ['H1'], confidence: 0.85 });
    server.updateAtom('C1', { isVerified: true });
    server.removeAtom('C1');
    expect(server.getBestConclusion()).toBeNull();
  });

  it('auto-suggested conclusion IDs never collide with user atoms starting with C', () => {
    const server = new AtomOfThoughtsServer(5);
    server.processAtom({ atomId: 'CACHE1', atomType: 'premise', content: 'cache premise', confidence: 0.9 });
    server.processAtom({ atomId: 'H1', atomType: 'hypothesis', content: 'hyp', dependencies: ['CACHE1'], confidence: 0.85 });
    // Verification atom triggers verify -> contraction path is decomposition-only,
    // so drive suggestConclusion via decomposition-free verification propagation:
    server.processAtom({ atomId: 'V1', atomType: 'verification', content: 'check', dependencies: ['H1'], confidence: 0.9, isVerified: true });
    const atoms = server.getAtoms();
    const autoConclusions = Object.keys(atoms).filter(id => /^C\d+$/.test(id));
    // CACHE1 must not have been overwritten regardless of whether a conclusion spawned.
    expect(atoms['CACHE1'].atomType).toBe('premise');
    for (const id of autoConclusions) {
      expect(atoms[id].atomType).toBe('conclusion');
    }
  });
});
