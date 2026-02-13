import { AtomOfThoughtsServer } from './atom-server.js';

export class AtomOfThoughtsLightServer extends AtomOfThoughtsServer {
  constructor(maxDepth?: number) {
    super(maxDepth ?? 3);
  }

  public processAtom(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const validatedInput = this.validateAtomData(input);

      this.atoms[validatedInput.atomId] = validatedInput;

      if (!this.atomOrder.includes(validatedInput.atomId)) {
        this.atomOrder.push(validatedInput.atomId);
      }

      const formattedAtom = this.formatAtom(validatedInput);
      console.error(formattedAtom);

      if (validatedInput.atomType === 'verification' && validatedInput.isVerified) {
        validatedInput.dependencies.forEach(depId => {
          if (this.atoms[depId]) {
            this.verifyAtom(depId, true);
          }
        });
      }

      if (validatedInput.atomType === 'hypothesis' && validatedInput.confidence >= 0.8) {
        this.suggestConclusion(validatedInput);
      }

      const shouldTerminate = this.shouldTerminate();
      const bestConclusion = shouldTerminate ? this.getBestConclusion() : null;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            atomId: validatedInput.atomId,
            atomType: validatedInput.atomType,
            isVerified: validatedInput.isVerified,
            confidence: validatedInput.confidence,
            atomsCount: Object.keys(this.atoms).length,
            bestConclusion: bestConclusion ? {
              atomId: bestConclusion.atomId,
              content: bestConclusion.content,
              confidence: bestConclusion.confidence
            } : null
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}
