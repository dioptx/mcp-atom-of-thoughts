import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';

function parse(res: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(res.content[0].text);
}

describe('contraction and conclusion bookkeeping', () => {
  let server: AtomOfThoughtsServer;

  beforeEach(() => {
    server = new AtomOfThoughtsServer();
  });

  it('registers a conclusion that was verified by contraction', () => {
    parse(server.processAtom({
      atomId: 'C1', content: 'The fix is X', atomType: 'conclusion',
      dependencies: [], confidence: 0.95,
    }));

    const decompId = server.startDecomposition('C1');

    // Sub-atoms are auto-attached to the open decomposition by processAtom.
    parse(server.processAtom({
      atomId: 'H1', content: 'Hypothesis one', atomType: 'hypothesis',
      dependencies: ['C1'], confidence: 0.9,
    }));
    parse(server.processAtom({
      atomId: 'V1', content: 'Checks H1', atomType: 'verification',
      dependencies: ['H1'], confidence: 0.9,
    }));

    server.completeDecomposition(decompId);

    // Verifying V1 drives the contraction of the decomposition it belongs to.
    parse(server.processAtom({
      atomId: 'V2', content: 'Checks V1', atomType: 'verification',
      dependencies: ['V1'], confidence: 0.95, isVerified: true,
    }));

    expect(server.getAtoms()['C1'].isVerified).toBe(true);
    expect(server.getBestConclusion()?.atomId).toBe('C1');
  });

  it('terminates once contraction produces a strong verified conclusion', () => {
    parse(server.processAtom({
      atomId: 'C1', content: 'The fix is X', atomType: 'conclusion',
      dependencies: [], confidence: 0.5,
    }));

    const decompId = server.startDecomposition('C1');
    parse(server.processAtom({
      atomId: 'H1', content: 'Hypothesis one', atomType: 'hypothesis',
      dependencies: ['C1'], confidence: 0.95,
    }));
    parse(server.processAtom({
      atomId: 'V1', content: 'Checks H1', atomType: 'verification',
      dependencies: ['H1'], confidence: 0.95,
    }));
    server.completeDecomposition(decompId);

    parse(server.processAtom({
      atomId: 'V2', content: 'Checks V1', atomType: 'verification',
      dependencies: ['V1'], confidence: 0.95, isVerified: true,
    }));

    // Contraction lifted C1's confidence to the sub-atom average (0.95).
    expect(server.getAtoms()['C1'].confidence).toBeCloseTo(0.95, 5);
    expect(server.getTerminationStatus()).toEqual({
      shouldTerminate: true,
      reason: 'Strong conclusion found',
    });
  });

  it('does not list a conclusion twice when two verifications vouch for it', () => {
    parse(server.processAtom({
      atomId: 'C1', content: 'Conclusion', atomType: 'conclusion',
      dependencies: [], confidence: 0.95,
    }));
    parse(server.processAtom({
      atomId: 'V1', content: 'check one', atomType: 'verification',
      dependencies: ['C1'], confidence: 0.9, isVerified: true,
    }));
    parse(server.processAtom({
      atomId: 'V2', content: 'check two', atomType: 'verification',
      dependencies: ['C1'], confidence: 0.9, isVerified: true,
    }));

    const res = parse(server.processAtom({
      atomId: 'R9', content: 'noop', atomType: 'reasoning',
      dependencies: ['C1'], confidence: 0.5,
    }));

    expect(res.verifiedConclusions).toEqual(['C1']);
  });

  it('un-verifying a conclusion still removes it from the list', () => {
    parse(server.processAtom({
      atomId: 'C1', content: 'Conclusion', atomType: 'conclusion',
      dependencies: [], confidence: 0.95,
    }));
    parse(server.processAtom({
      atomId: 'V1', content: 'check', atomType: 'verification',
      dependencies: ['C1'], confidence: 0.9, isVerified: true,
    }));
    expect(server.getBestConclusion()?.atomId).toBe('C1');

    // @ts-expect-error -- exercising the protected transition directly
    server.verifyAtom(server['sessions']['default'], 'C1', false);

    expect(server.getAtoms()['C1'].isVerified).toBe(false);
    expect(server.getBestConclusion()).toBeNull();
  });

  it('suggests a conclusion id that does not overwrite an existing atom', () => {
    // Session holds C2 but no C1, so "count of C* + 1" would resolve to C2.
    parse(server.processAtom({
      atomId: 'C2', content: 'Pre-existing conclusion', atomType: 'conclusion',
      dependencies: [], confidence: 0.4,
    }));
    parse(server.processAtom({
      atomId: 'H0', content: 'Parent hypothesis', atomType: 'hypothesis',
      dependencies: [], confidence: 0.5,
    }));

    const decompId = server.startDecomposition('H0');
    parse(server.processAtom({
      atomId: 'H1', content: 'Sub hypothesis', atomType: 'hypothesis',
      dependencies: ['H0'], confidence: 0.9,
    }));
    parse(server.processAtom({
      atomId: 'V1', content: 'Checks H1', atomType: 'verification',
      dependencies: ['H1'], confidence: 0.9,
    }));
    server.completeDecomposition(decompId);

    parse(server.processAtom({
      atomId: 'V2', content: 'Checks V1', atomType: 'verification',
      dependencies: ['V1'], confidence: 0.95, isVerified: true,
    }));

    // H0 contracted to >= 0.8, so a conclusion was suggested for it.
    const atoms = server.getAtoms();
    expect(atoms['C2'].content).toBe('Pre-existing conclusion');
    expect(atoms['C1']).toBeDefined();
    expect(atoms['C1'].content).toContain('Parent hypothesis');
  });
});
