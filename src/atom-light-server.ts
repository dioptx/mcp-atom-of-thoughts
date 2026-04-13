import { AtomOfThoughtsServer } from './atom-server.js';
import { Session } from './types.js';

export class AtomOfThoughtsLightServer extends AtomOfThoughtsServer {
  constructor(maxDepth?: number) {
    super(maxDepth ?? 3);
  }

  public processAtom(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const inputObj = (input || {}) as Record<string, unknown>;
      const sessionIdRaw = inputObj.sessionId;
      const sessionIdInput = typeof sessionIdRaw === 'string' && sessionIdRaw.length > 0 ? sessionIdRaw : undefined;

      this.ensureActiveSessionForInput({
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

      session.atoms[validatedInput.atomId] = validatedInput;

      if (!session.atomOrder.includes(validatedInput.atomId)) {
        session.atomOrder.push(validatedInput.atomId);
      }

      const formattedAtom = this.formatAtom(validatedInput);
      console.error(formattedAtom);

      if (validatedInput.atomType === 'verification' && validatedInput.isVerified) {
        validatedInput.dependencies.forEach(depId => {
          if (session.atoms[depId]) {
            // verifyAtom is protected on the parent and accepts a session
            (this as unknown as { verifyAtom: (s: Session, id: string, v: boolean) => void })
              .verifyAtom(session, depId, true);
          }
        });
      }

      if (validatedInput.atomType === 'hypothesis' && validatedInput.confidence >= 0.8) {
        (this as unknown as { suggestConclusion: (s: Session, atom: typeof validatedInput) => string })
          .suggestConclusion(session, validatedInput);
      }

      const shouldTerminate = (this as unknown as { shouldTerminate: (s: Session) => boolean })
        .shouldTerminate(session);
      const bestConclusion = shouldTerminate ? this.getBestConclusion(session.id) : null;

      if (shouldTerminate) {
        session.status = 'completed';
      }

      const payload: Record<string, unknown> = {
        atomId: validatedInput.atomId,
        atomType: validatedInput.atomType,
        isVerified: validatedInput.isVerified,
        confidence: validatedInput.confidence,
        sessionId: session.id,
        atomsCount: Object.keys(session.atoms).length,
      };
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
