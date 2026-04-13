import { describe, it, expect, beforeEach } from 'vitest';
import { AtomOfThoughtsServer } from '../src/atom-server.js';
import { AtomOfThoughtsLightServer } from '../src/atom-light-server.js';

describe('Sessions', () => {
  let server: AtomOfThoughtsServer;

  beforeEach(() => {
    server = new AtomOfThoughtsServer();
  });

  describe('default session', () => {
    it('starts with a "default" active session', () => {
      expect(server.getActiveSessionId()).toBe('default');
    });

    it('listSessions includes default at startup', () => {
      const sessions = server.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('default');
      expect(sessions[0].status).toBe('active');
      expect(sessions[0].atomCount).toBe(0);
    });
  });

  describe('newSession', () => {
    it('creates and activates a named session', () => {
      const id = server.newSession('debug-1');
      expect(id).toBe('debug-1');
      expect(server.getActiveSessionId()).toBe('debug-1');
    });

    it('auto-generates an id when omitted', () => {
      const id = server.newSession();
      expect(id).toMatch(/^default-\d+$/);
      expect(server.getActiveSessionId()).toBe(id);
    });

    it('throws if session id already exists', () => {
      server.newSession('dup');
      expect(() => server.newSession('dup')).toThrow('already exists');
    });
  });

  describe('switchSession', () => {
    it('activates an existing session', () => {
      server.newSession('a');
      server.newSession('b');
      server.switchSession('a');
      expect(server.getActiveSessionId()).toBe('a');
    });

    it('throws on unknown session id', () => {
      expect(() => server.switchSession('nope')).toThrow('not found');
    });
  });

  describe('isolation', () => {
    it('atoms do not leak between sessions', () => {
      server.processAtom({ atomId: 'P1', content: 'first', atomType: 'premise', dependencies: [], confidence: 0.5 });
      server.newSession('other');
      server.processAtom({ atomId: 'P1', content: 'second', atomType: 'premise', dependencies: [], confidence: 0.5 });

      expect(server.getAtoms('default')['P1'].content).toBe('first');
      expect(server.getAtoms('other')['P1'].content).toBe('second');
    });

    it('processAtom with explicit sessionId targets that session', () => {
      server.newSession('explicit');
      server.switchSession('default');
      server.processAtom({
        atomId: 'P1', content: 'goes-to-explicit', atomType: 'premise',
        dependencies: [], confidence: 0.5, sessionId: 'explicit',
      } as unknown);
      expect(server.getAtoms('explicit')['P1']).toBeDefined();
      expect(server.getAtoms('default')['P1']).toBeUndefined();
    });

    it('explicit sessionId auto-creates the session if unknown', () => {
      server.processAtom({
        atomId: 'P1', content: 'fresh', atomType: 'premise',
        dependencies: [], confidence: 0.5, sessionId: 'fresh-session',
      } as unknown);
      const sessions = server.listSessions().map(s => s.id);
      expect(sessions).toContain('fresh-session');
    });
  });

  describe('resetSession', () => {
    it('wipes atoms in the active session by default', () => {
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5 });
      expect(Object.keys(server.getAtoms())).toHaveLength(1);
      server.resetSession();
      expect(Object.keys(server.getAtoms())).toHaveLength(0);
    });

    it('wipes atoms in a named session', () => {
      server.newSession('scratch');
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5 });
      server.switchSession('default');
      server.resetSession('scratch');
      expect(Object.keys(server.getAtoms('scratch'))).toHaveLength(0);
    });

    it('flips a completed session back to active', () => {
      // Force termination via max-depth atom on default
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5, depth: 5 });
      const before = server.listSessions().find(s => s.id === 'default')!;
      expect(before.status).toBe('completed');
      server.resetSession('default');
      const after = server.listSessions().find(s => s.id === 'default')!;
      expect(after.status).toBe('active');
    });
  });

  describe('auto-archive on termination', () => {
    it('marks session completed when max depth is reached', () => {
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5, depth: 5 });
      const sessions = server.listSessions();
      expect(sessions.find(s => s.id === 'default')!.status).toBe('completed');
    });
  });

  describe('auto-spawn on next zero-dep atom', () => {
    it('spawns a new default session when prior one terminated', () => {
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5, depth: 5 });
      expect(server.getActiveSessionId()).toBe('default');
      // Next atom with no deps and no sessionId → auto-spawn
      const result = server.processAtom({ atomId: 'P1', content: 'y', atomType: 'premise', dependencies: [], confidence: 0.5 });
      const data = JSON.parse(result.content[0].text);
      expect(data.sessionId).toMatch(/^default-\d+$/);
      expect(server.getActiveSessionId()).toMatch(/^default-\d+$/);
    });

    it('does not auto-spawn when explicit sessionId is given', () => {
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5, depth: 5 });
      server.processAtom({
        atomId: 'P1', content: 'y', atomType: 'premise',
        dependencies: [], confidence: 0.5, sessionId: 'default'
      } as unknown);
      // Active session should still be default (no spawn)
      expect(server.getActiveSessionId()).toBe('default');
    });

    it('does not auto-spawn when atom has dependencies', () => {
      // First, completed session
      server.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5, depth: 5 });
      // Try to add an atom with deps — it should target the still-active session
      // (or fail validation if deps don't exist there). Since P1 exists in default,
      // R1 depending on P1 stays in default and does NOT trigger auto-spawn.
      server.processAtom({ atomId: 'R1', content: 'r', atomType: 'reasoning', dependencies: ['P1'], confidence: 0.5 });
      expect(server.getActiveSessionId()).toBe('default');
    });
  });

  describe('AtomOfThoughtsLightServer sessions', () => {
    it('also auto-spawns and reports sessionId in response', () => {
      const light = new AtomOfThoughtsLightServer();
      const result = light.processAtom({ atomId: 'P1', content: 'x', atomType: 'premise', dependencies: [], confidence: 0.5 });
      const data = JSON.parse(result.content[0].text);
      expect(data.sessionId).toBe('default');
    });
  });
});
