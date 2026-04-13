import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';
import { AtomOfThoughtsLightServer } from '../src/atom-light-server.js';

describe('processAtom payload shape (v3 slim)', () => {
  let server: AtomOfThoughtsServer;

  beforeEach(() => {
    server = new AtomOfThoughtsServer();
  });

  it('omits empty arrays in the default response', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'Standalone premise', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('dependentAtoms');
    expect(data).not.toHaveProperty('conflictingAtoms');
    expect(data).not.toHaveProperty('verifiedConclusions');
  });

  it('omits currentDecomposition when none is in flight', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('currentDecomposition');
  });

  it('omits terminationStatus when shouldTerminate is false', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('terminationStatus');
  });

  it('includes terminationStatus when shouldTerminate is true', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5, depth: 5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('terminationStatus');
    expect(data.terminationStatus.shouldTerminate).toBe(true);
  });

  it('omits bestConclusion when no verified conclusions exist', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('bestConclusion');
  });

  it('includes dependentAtoms when subsequent atoms reference this one', () => {
    server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5 });
    server.processAtom({ atomId: 'R1', content: 'y', atomType: 'reasoning', dependencies: ['P1'], confidence: 0.5 });
    // Re-issue an update for P1 to see who depends on it
    const result = server.processAtom({ atomId: 'P1', content: 'x updated', atomType: 'premise', dependencies: [], confidence: 0.5 });
    const data = JSON.parse(result.content[0].text);
    expect(data.dependentAtoms).toEqual(['R1']);
  });

  it('always includes core fields', () => {
    const result = server.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('atomId');
    expect(data).toHaveProperty('atomType');
    expect(data).toHaveProperty('confidence');
    expect(data).toHaveProperty('depth');
    expect(data).toHaveProperty('sessionId');
    expect(data).toHaveProperty('atomsCount');
  });

  it('AoT-fast also omits null bestConclusion', () => {
    const light = new AtomOfThoughtsLightServer();
    const result = light.processAtom({
      atomId: 'P1', content: 'x', atomType: 'premise',
      dependencies: [], confidence: 0.5,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('bestConclusion');
  });
});
