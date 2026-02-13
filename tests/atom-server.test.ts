import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';

function makePremise(id = 'P1', content = 'Test premise', confidence = 0.9) {
  return { atomId: id, content, atomType: 'premise', dependencies: [], confidence };
}

function makeReasoning(id = 'R1', content = 'Test reasoning', deps = ['P1'], confidence = 0.85) {
  return { atomId: id, content, atomType: 'reasoning', dependencies: deps, confidence };
}

describe('AtomOfThoughtsServer', () => {
  let server: AtomOfThoughtsServer;

  beforeEach(() => {
    server = new AtomOfThoughtsServer();
  });

  describe('constructor', () => {
    it('defaults maxDepth to 5', () => {
      expect(server.maxDepth).toBe(5);
    });

    it('accepts custom maxDepth', () => {
      const s = new AtomOfThoughtsServer(10);
      expect(s.maxDepth).toBe(10);
    });

    it('ignores non-positive maxDepth', () => {
      const s = new AtomOfThoughtsServer(0);
      expect(s.maxDepth).toBe(5);
    });
  });

  describe('validateAtomData', () => {
    it('returns valid AtomData for valid input', () => {
      const result = server.validateAtomData(makePremise());
      expect(result.atomId).toBe('P1');
      expect(result.atomType).toBe('premise');
      expect(result.confidence).toBe(0.9);
    });

    it('throws for missing atomId', () => {
      expect(() => server.validateAtomData({ content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5 }))
        .toThrow('Invalid atomId');
    });

    it('throws for missing content', () => {
      expect(() => server.validateAtomData({ atomId: 'P1', atomType: 'premise', dependencies: [], confidence: 0.5 }))
        .toThrow('Invalid content');
    });

    it('throws for invalid atomType', () => {
      expect(() => server.validateAtomData({ atomId: 'P1', content: 'x', atomType: 'invalid', dependencies: [], confidence: 0.5 }))
        .toThrow('Invalid atomType');
    });

    it('throws for non-array dependencies', () => {
      expect(() => server.validateAtomData({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: 'bad', confidence: 0.5 }))
        .toThrow('Invalid dependencies');
    });

    it('throws for out-of-range confidence', () => {
      expect(() => server.validateAtomData({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 1.5 }))
        .toThrow('Invalid confidence');
    });

    it('defaults isVerified to false', () => {
      const result = server.validateAtomData(makePremise());
      expect(result.isVerified).toBe(false);
    });

    it('defaults created to Date.now()', () => {
      const before = Date.now();
      const result = server.validateAtomData(makePremise());
      expect(result.created).toBeGreaterThanOrEqual(before);
    });
  });

  describe('processAtom', () => {
    it('stores a premise and returns success', () => {
      const result = server.processAtom(makePremise());
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.atomId).toBe('P1');
      expect(data.atomsCount).toBe(1);
    });

    it('rejects invalid dependencies', () => {
      const result = server.processAtom(makeReasoning('R1', 'test', ['NONEXISTENT']));
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('dependency atoms do not exist');
    });

    it('accepts valid dependencies', () => {
      server.processAtom(makePremise());
      const result = server.processAtom(makeReasoning());
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.atomId).toBe('R1');
    });

    it('auto-calculates depth from dependencies', () => {
      server.processAtom(makePremise());
      const result = server.processAtom(makeReasoning());
      const data = JSON.parse(result.content[0].text);
      expect(data.depth).toBe(1);
    });

    it('stores atoms in order', () => {
      server.processAtom(makePremise('P1'));
      server.processAtom(makePremise('P2', 'Second premise'));
      expect(server.getAtomOrder()).toEqual(['P1', 'P2']);
    });

    it('returns error for invalid input', () => {
      const result = server.processAtom({});
      expect(result.isError).toBe(true);
    });
  });

  describe('decomposition lifecycle', () => {
    it('startDecomposition returns an ID', () => {
      server.processAtom(makePremise());
      const decompId = server.startDecomposition('P1');
      expect(decompId).toMatch(/^decomp_/);
    });

    it('startDecomposition throws for missing atom', () => {
      expect(() => server.startDecomposition('NOPE')).toThrow('not found');
    });

    it('addToDecomposition works for valid atoms', () => {
      server.processAtom(makePremise());
      const decompId = server.startDecomposition('P1');
      server.processAtom(makePremise('P2', 'Sub-premise'));
      expect(server.addToDecomposition(decompId, 'P2')).toBe(true);
    });

    it('addToDecomposition throws for unknown decomposition', () => {
      server.processAtom(makePremise());
      expect(() => server.addToDecomposition('fake', 'P1')).toThrow('not found');
    });

    it('completeDecomposition marks as done', () => {
      server.processAtom(makePremise());
      const decompId = server.startDecomposition('P1');
      expect(server.completeDecomposition(decompId)).toBe(true);
    });

    it('addToDecomposition throws after completion', () => {
      server.processAtom(makePremise());
      server.processAtom(makePremise('P2', 'sub'));
      const decompId = server.startDecomposition('P1');
      server.completeDecomposition(decompId);
      expect(() => server.addToDecomposition(decompId, 'P2')).toThrow('already completed');
    });
  });

  describe('termination', () => {
    it('should not terminate initially', () => {
      const status = server.getTerminationStatus();
      expect(status.shouldTerminate).toBe(false);
      expect(status.reason).toBe('Continue reasoning');
    });

    it('terminates when max depth reached', () => {
      server.processAtom({ ...makePremise(), depth: 5 });
      const status = server.getTerminationStatus();
      expect(status.shouldTerminate).toBe(true);
      expect(status.reason).toContain('Maximum depth');
    });

    it('getBestConclusion returns null when none exist', () => {
      expect(server.getBestConclusion()).toBeNull();
    });

    it('terminates on strong verified conclusion', () => {
      server.processAtom(makePremise());
      server.processAtom({
        atomId: 'H1', content: 'Hypothesis', atomType: 'hypothesis',
        dependencies: ['P1'], confidence: 0.95
      });
      server.processAtom({
        atomId: 'C1', content: 'Conclusion', atomType: 'conclusion',
        dependencies: ['H1'], confidence: 0.95
      });
      // Verify the conclusion via a verification atom
      server.processAtom({
        atomId: 'V1', content: 'Verified', atomType: 'verification',
        dependencies: ['C1'], confidence: 0.95, isVerified: true
      });
      const status = server.getTerminationStatus();
      expect(status.shouldTerminate).toBe(true);
      expect(status.reason).toContain('Strong conclusion');
    });
  });

  describe('verification chain', () => {
    it('verification atom marks hypothesis dependencies as verified', () => {
      server.processAtom(makePremise());
      server.processAtom({
        atomId: 'H1', content: 'Hypothesis', atomType: 'hypothesis',
        dependencies: ['P1'], confidence: 0.85
      });
      // V1 verifies H1
      server.processAtom({
        atomId: 'V1', content: 'Check H1', atomType: 'verification',
        dependencies: ['H1'], confidence: 0.9, isVerified: true
      });

      const atoms = server.getAtoms();
      expect(atoms['H1'].isVerified).toBe(true);
    });

    it('nested verification propagates through verification chain', () => {
      server.processAtom(makePremise());
      server.processAtom({
        atomId: 'H1', content: 'Parent', atomType: 'hypothesis',
        dependencies: ['P1'], confidence: 0.85
      });
      // V1 depends on H1
      server.processAtom({
        atomId: 'V1', content: 'Sub-verification', atomType: 'verification',
        dependencies: ['H1'], confidence: 0.9
      });
      // V2 verifies V1 → triggers verifyAtom(V1) → V1 is verification →
      // finds hypothesis dep H1 → marks H1 verified
      server.processAtom({
        atomId: 'V2', content: 'Meta-verify', atomType: 'verification',
        dependencies: ['V1'], confidence: 0.95, isVerified: true
      });

      const atoms = server.getAtoms();
      expect(atoms['V1'].isVerified).toBe(true);
      expect(atoms['H1'].isVerified).toBe(true);
    });
  });
});
