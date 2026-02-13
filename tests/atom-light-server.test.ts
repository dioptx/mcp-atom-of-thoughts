import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsLightServer } from '../src/atom-light-server.js';

describe('AtomOfThoughtsLightServer', () => {
  let server: AtomOfThoughtsLightServer;

  beforeEach(() => {
    server = new AtomOfThoughtsLightServer();
  });

  it('has maxDepth of 3', () => {
    expect(server.maxDepth).toBe(3);
  });

  it('accepts custom maxDepth', () => {
    const custom = new AtomOfThoughtsLightServer(7);
    expect(custom.maxDepth).toBe(7);
  });

  it('processes a premise', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'Test', atomType: 'premise',
      dependencies: [], confidence: 0.9
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.atomId).toBe('P1');
    expect(data.atomsCount).toBe(1);
  });

  it('auto-suggests conclusion for hypothesis >= 0.8 confidence', () => {
    server.processAtom({
      atomId: 'P1', content: 'Premise', atomType: 'premise',
      dependencies: [], confidence: 0.9
    });
    server.processAtom({
      atomId: 'H1', content: 'Hypothesis', atomType: 'hypothesis',
      dependencies: [], confidence: 0.85
    });
    const atoms = server.getAtoms();
    const conclusionKeys = Object.keys(atoms).filter(k => k.startsWith('C'));
    expect(conclusionKeys.length).toBe(1);
  });

  it('does not suggest conclusion for hypothesis < 0.8', () => {
    server.processAtom({
      atomId: 'H1', content: 'Weak hypothesis', atomType: 'hypothesis',
      dependencies: [], confidence: 0.6
    });
    const atoms = server.getAtoms();
    const conclusionKeys = Object.keys(atoms).filter(k => k.startsWith('C'));
    expect(conclusionKeys.length).toBe(0);
  });

  it('returns simplified response without dependentAtoms', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'Test', atomType: 'premise',
      dependencies: [], confidence: 0.9
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('dependentAtoms');
    expect(data).not.toHaveProperty('conflictingAtoms');
  });

  it('returns error for invalid input', () => {
    const result = server.processAtom({});
    expect(result.isError).toBe(true);
  });
});
