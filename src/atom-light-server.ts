import { AtomOfThoughtsServer } from './atom-server.js';
import { Session } from './types.js';
import { EventLog } from './events.js';

export class AtomOfThoughtsLightServer extends AtomOfThoughtsServer {
  constructor(maxDepth?: number, shareStateWith?: AtomOfThoughtsServer) {
    super(maxDepth ?? 3);
    if (shareStateWith) {
      // Share the sessions map (object reference) so writes to one instance
      // are visible to the other. activeSessionId is a primitive so we proxy
      // reads/writes via Object.defineProperty pointing at the shared instance.
      const shared = shareStateWith as unknown as {
        sessions: Record<string, Session>;
        activeSessionId: string;
        events: EventLog | null;
      };
      const self = this as unknown as { sessions: Record<string, Session>; events: EventLog | null };
      self.sessions = shared.sessions;
      // Inherit the parent's event log so light-mode atom emissions land in
      // the same JSONL feed the TUI is tailing.
      self.events = shared.events;
      Object.defineProperty(this, 'activeSessionId', {
        configurable: true,
        get(): string { return shared.activeSessionId; },
        set(v: string): void { shared.activeSessionId = v; },
      });
    }
  }

  public processAtom(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const inputObj = (input || {}) as Record<string, unknown>;
      const sessionIdRaw = inputObj.sessionId;
      const sessionIdInput = typeof sessionIdRaw === 'string' && sessionIdRaw.length > 0 ? sessionIdRaw : undefined;

      const autoSpawnedSession = this.ensureActiveSessionForInput({
        sessionId: sessionIdInput,
        dependencies: Array.isArray(inputObj.dependencies) ? inputObj.dependencies : undefined,
      });

      let session: Session;
      if (sessionIdInput) {
        if (!this.sessions[sessionIdInput]) {
          this.sessions[sessionIdInput] = this.createSession(sessionIdInput);
        }
        session = this.sessions[sessionIdInput];
      } else {
        session = this.sessions[this.activeSessionId];
      }

      const validatedInput = this.validateAtomData(input);
      // Same pre-insert pipeline as the full server: dependency existence,
      // cycle guard, depth derivation. Fast mode used to skip all three,
      // silently accepting ghost deps and leaving depth undefined.
      this.prepareAtomForInsert(session, validatedInput);

      const overwritten = session.atoms[validatedInput.atomId] !== undefined;
      session.atoms[validatedInput.atomId] = validatedInput;

      if (!session.atomOrder.includes(validatedInput.atomId)) {
        session.atomOrder.push(validatedInput.atomId);
      }
      this.events?.emit({ kind: 'atom_added', t: Date.now(), atom: validatedInput, sessionId: session.id });

      const formattedAtom = this.formatAtom(validatedInput);
      console.error(formattedAtom);

      // Same unified verification path as the full server (polarity-aware,
      // verifiedConclusions bookkeeping, gated auto-conclusion). Fast mode no
      // longer auto-spawns conclusions for merely-confident UNVERIFIED
      // hypotheses — that polluted graphs with unsupported conclusions.
      if (validatedInput.isVerified) {
        (this as unknown as { verifyAtom: (s: Session, id: string, v: boolean) => void })
          .verifyAtom(session, validatedInput.atomId, true);
      }
      if (validatedInput.atomType === 'hypothesis') {
        (this as unknown as { maybeSuggestConclusion: (s: Session, atom: typeof validatedInput) => string | null })
          .maybeSuggestConclusion(session, validatedInput);
      }

      const shouldTerminate = (this as unknown as { shouldTerminate: (s: Session) => boolean })
        .shouldTerminate(session);
      const bestConclusion = shouldTerminate ? this.getBestConclusion(session.id) : null;

      if (shouldTerminate) {
        session.status = 'completed';
        this.events?.emit({ kind: 'termination', t: Date.now(), reason: 'Strong conclusion or max depth', sessionId: session.id });
      }

      const payload: Record<string, unknown> = {
        atomId: validatedInput.atomId,
        atomType: validatedInput.atomType,
        isVerified: validatedInput.isVerified,
        confidence: validatedInput.confidence,
        depth: validatedInput.depth,
        sessionId: session.id,
        atomsCount: Object.keys(session.atoms).length,
      };
      if (overwritten) payload.overwritten = true;
      if (autoSpawnedSession) payload.autoSpawnedSession = autoSpawnedSession;
      if (bestConclusion) {
        payload.bestConclusion = {
          atomId: bestConclusion.atomId,
          content: bestConclusion.content,
          confidence: bestConclusion.confidence,
        };
      }

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed',
            hint: 'Fix the error and retry the call.'
          }, null, 2)
        }]
      };
    }
  }
}
