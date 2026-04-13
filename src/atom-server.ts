import {
  AtomData,
  AtomType,
  DecompositionState,
  Session,
  SessionSummary,
  VALID_ATOM_TYPES,
} from './types.js';

const DEFAULT_SESSION_ID = 'default';

export class AtomOfThoughtsServer {
  protected sessions: Record<string, Session> = {};
  protected activeSessionId: string = DEFAULT_SESSION_ID;
  public maxDepth: number = 5;

  constructor(maxDepth?: number) {
    if (maxDepth !== undefined && maxDepth > 0) {
      this.maxDepth = maxDepth;
    }
    this.sessions[DEFAULT_SESSION_ID] = this.createSession(DEFAULT_SESSION_ID);
  }

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  protected createSession(id: string): Session {
    return {
      id,
      status: 'active',
      createdAt: Date.now(),
      atoms: {},
      atomOrder: [],
      verifiedConclusions: [],
      decompositionStates: {},
      currentDecompositionId: null,
    };
  }

  protected getSession(id?: string): Session {
    const target = id ?? this.activeSessionId;
    const session = this.sessions[target];
    if (!session) throw new Error(`Session not found: ${target}`);
    return session;
  }

  public getActiveSessionId(): string {
    return this.activeSessionId;
  }

  public newSession(id?: string): string {
    const sessionId = id && id.length > 0 ? id : this.nextDefaultSessionId();
    if (this.sessions[sessionId]) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    this.sessions[sessionId] = this.createSession(sessionId);
    this.activeSessionId = sessionId;
    return sessionId;
  }

  public switchSession(id: string): boolean {
    if (!this.sessions[id]) throw new Error(`Session not found: ${id}`);
    this.activeSessionId = id;
    return true;
  }

  public listSessions(): SessionSummary[] {
    return Object.values(this.sessions).map(s => ({
      id: s.id,
      status: s.status,
      atomCount: Object.keys(s.atoms).length,
      createdAt: s.createdAt,
    }));
  }

  public resetSession(id?: string): boolean {
    const session = this.getSession(id);
    session.atoms = {};
    session.atomOrder = [];
    session.verifiedConclusions = [];
    session.decompositionStates = {};
    session.currentDecompositionId = null;
    session.status = 'active';
    return true;
  }

  protected nextDefaultSessionId(): string {
    let n = 2;
    while (this.sessions[`${DEFAULT_SESSION_ID}-${n}`]) n++;
    return `${DEFAULT_SESSION_ID}-${n}`;
  }

  /**
   * Auto-spawn a fresh session if the active session is completed and the
   * caller is starting a new reasoning chain (no dependencies, no explicit
   * sessionId). Keeps the single-process server usable across multiple
   * problems without forcing the caller to manage sessions explicitly.
   */
  protected ensureActiveSessionForInput(input: { sessionId?: string; dependencies?: unknown[] }): void {
    if (input.sessionId) return;
    const active = this.sessions[this.activeSessionId];
    if (!active || active.status !== 'completed') return;
    const hasDeps = Array.isArray(input.dependencies) && input.dependencies.length > 0;
    if (hasDeps) return;
    // Auto-spawn
    const id = this.nextDefaultSessionId();
    this.sessions[id] = this.createSession(id);
    this.activeSessionId = id;
  }

  // -------------------------------------------------------------------------
  // Read-through accessors (default to active session, or accept sessionId)
  // -------------------------------------------------------------------------

  public getAtoms(sessionId?: string): Record<string, AtomData> {
    return this.getSession(sessionId).atoms;
  }

  public getAtomOrder(sessionId?: string): string[] {
    return this.getSession(sessionId).atomOrder;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  public validateAtomData(input: unknown): AtomData {
    const data = input as Record<string, unknown>;

    if (!data.atomId || typeof data.atomId !== 'string') {
      throw new Error('Invalid atomId: must be a string');
    }
    if (!data.content || typeof data.content !== 'string') {
      throw new Error('Invalid content: must be a string');
    }
    if (!data.atomType || typeof data.atomType !== 'string' ||
        !VALID_ATOM_TYPES.includes(data.atomType as AtomType)) {
      throw new Error('Invalid atomType: must be one of premise, reasoning, hypothesis, verification, conclusion');
    }
    const dependencies = Array.isArray(data.dependencies) ? data.dependencies as string[] : [];
    const confidence = (typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1)
      ? data.confidence as number
      : 0.7;

    return {
      atomId: data.atomId as string,
      content: data.content as string,
      atomType: data.atomType as AtomType,
      dependencies,
      confidence,
      created: data.created as number || Date.now(),
      isVerified: data.isVerified as boolean || false,
      depth: data.depth as number | undefined,
    };
  }

  protected formatAtom(atomData: AtomData): string {
    const { atomId, content, atomType, dependencies, confidence, isVerified, depth } = atomData;

    const typeSymbols: Record<AtomType, string> = {
      premise: 'P',
      reasoning: 'R',
      hypothesis: 'H',
      verification: 'V',
      conclusion: 'C',
    };

    const depthInfo = depth !== undefined ? ` [Depth: ${depth}/${this.maxDepth}]` : '';
    const header = `${typeSymbols[atomType]} ${atomType.toUpperCase()}: ${atomId}${depthInfo} ${isVerified ? '(Verified)' : ''}`;
    const confidenceBar = `Confidence: ${(confidence * 100).toFixed(0)}%`;
    const dependenciesText = dependencies.length > 0 ? `Dependencies: ${dependencies.join(', ')}` : 'No dependencies';

    return `[${header}] ${content} | ${confidenceBar} | ${dependenciesText}`;
  }

  private validateDependencies(session: Session, dependencies: string[]): boolean {
    return dependencies.every(depId => session.atoms[depId] !== undefined);
  }

  // -------------------------------------------------------------------------
  // Verification, decomposition, termination — all session-scoped
  // -------------------------------------------------------------------------

  protected verifyAtom(session: Session, atomId: string, isVerified: boolean) {
    if (session.atoms[atomId]) {
      session.atoms[atomId].isVerified = isVerified;

      if (isVerified && session.atoms[atomId].atomType === 'conclusion') {
        session.verifiedConclusions.push(atomId);
      } else if (!isVerified && session.atoms[atomId].atomType === 'conclusion') {
        session.verifiedConclusions = session.verifiedConclusions.filter(id => id !== atomId);
      }

      if (isVerified && session.atoms[atomId].atomType === 'verification') {
        const verifiedHypothesisIds = session.atoms[atomId].dependencies.filter(
          depId => session.atoms[depId] && session.atoms[depId].atomType === 'hypothesis'
        );

        if (verifiedHypothesisIds.length > 0) {
          verifiedHypothesisIds.forEach(hypId => {
            session.atoms[hypId].isVerified = true;
          });
          this.checkForContraction(session, verifiedHypothesisIds);
        }
      }
    }
  }

  public startDecomposition(atomId: string, sessionId?: string): string {
    const session = this.getSession(sessionId);
    if (!session.atoms[atomId]) {
      throw new Error(`Atom with ID ${atomId} not found`);
    }

    const decompositionId = `decomp_${Date.now()}`;

    session.decompositionStates[decompositionId] = {
      originalAtomId: atomId,
      subAtoms: [],
      isCompleted: false,
    };

    session.currentDecompositionId = decompositionId;

    return decompositionId;
  }

  public addToDecomposition(decompositionId: string, atomId: string, sessionId?: string): boolean {
    const session = this.getSession(sessionId);
    if (!session.decompositionStates[decompositionId]) {
      throw new Error(`Decomposition with ID ${decompositionId} not found`);
    }

    if (session.decompositionStates[decompositionId].isCompleted) {
      throw new Error(`Decomposition ${decompositionId} is already completed`);
    }

    if (!session.atoms[atomId]) {
      throw new Error(`Atom with ID ${atomId} not found`);
    }

    const parentDepth = session.atoms[session.decompositionStates[decompositionId].originalAtomId].depth || 0;
    session.atoms[atomId].depth = parentDepth + 1;

    session.decompositionStates[decompositionId].subAtoms.push(atomId);

    return true;
  }

  public completeDecomposition(decompositionId: string, sessionId?: string): boolean {
    const session = this.getSession(sessionId);
    if (!session.decompositionStates[decompositionId]) {
      throw new Error(`Decomposition with ID ${decompositionId} not found`);
    }

    session.decompositionStates[decompositionId].isCompleted = true;

    if (session.currentDecompositionId === decompositionId) {
      session.currentDecompositionId = null;
    }

    return true;
  }

  private checkForContraction(session: Session, verifiedAtomIds: string[]): void {
    for (const [decompId, state] of Object.entries(session.decompositionStates)) {
      if (state.isCompleted &&
          verifiedAtomIds.some(id => state.subAtoms.includes(id)) &&
          this.areAllSubAtomsVerified(session, state.subAtoms)) {
        this.performContraction(session, decompId);
      }
    }
  }

  private areAllSubAtomsVerified(session: Session, atomIds: string[]): boolean {
    return atomIds.every(id => session.atoms[id] && session.atoms[id].isVerified);
  }

  private performContraction(session: Session, decompositionId: string): void {
    const state = session.decompositionStates[decompositionId];
    if (!state) return;

    const originalAtom = session.atoms[state.originalAtomId];
    if (!originalAtom) return;

    const subAtomConfidences = state.subAtoms.map(id => session.atoms[id]?.confidence || 0);
    const averageConfidence = subAtomConfidences.reduce((sum, conf) => sum + conf, 0) / subAtomConfidences.length;

    originalAtom.confidence = averageConfidence;
    originalAtom.isVerified = true;

    if (originalAtom.atomType === 'hypothesis' && originalAtom.confidence >= 0.8) {
      this.suggestConclusion(session, originalAtom);
    }
  }

  protected suggestConclusion(session: Session, verifiedHypothesis: AtomData): string {
    const conclusionId = `C${Object.keys(session.atoms).filter(id => id.startsWith('C')).length + 1}`;

    const conclusionAtom: AtomData = {
      atomId: conclusionId,
      content: `Based on verified hypothesis: ${verifiedHypothesis.content}`,
      atomType: 'conclusion',
      dependencies: [verifiedHypothesis.atomId],
      confidence: verifiedHypothesis.confidence * 0.9,
      created: Date.now(),
      isVerified: false,
      depth: verifiedHypothesis.depth,
    };

    session.atoms[conclusionId] = conclusionAtom;
    session.atomOrder.push(conclusionId);

    return conclusionId;
  }

  protected shouldTerminate(session: Session): boolean {
    const atMaxDepth = Object.values(session.atoms).some(atom => atom.depth !== undefined && atom.depth >= this.maxDepth);
    const hasStrongConclusion = session.verifiedConclusions.some(id => session.atoms[id] && session.atoms[id].confidence >= 0.9);
    return atMaxDepth || hasStrongConclusion;
  }

  public getTerminationStatus(sessionId?: string): { shouldTerminate: boolean; reason: string } {
    const session = this.getSession(sessionId);
    const atMaxDepth = Object.values(session.atoms).some(atom => atom.depth !== undefined && atom.depth >= this.maxDepth);
    const hasStrongConclusion = session.verifiedConclusions.some(id => session.atoms[id] && session.atoms[id].confidence >= 0.9);

    if (atMaxDepth && hasStrongConclusion) {
      return { shouldTerminate: true, reason: 'Maximum depth reached and strong conclusion found' };
    } else if (atMaxDepth) {
      return { shouldTerminate: true, reason: 'Maximum depth reached' };
    } else if (hasStrongConclusion) {
      return { shouldTerminate: true, reason: 'Strong conclusion found' };
    } else {
      return { shouldTerminate: false, reason: 'Continue reasoning' };
    }
  }

  public getBestConclusion(sessionId?: string): AtomData | null {
    const session = this.getSession(sessionId);
    if (session.verifiedConclusions.length === 0) return null;

    const sortedConclusions = [...session.verifiedConclusions]
      .map(id => session.atoms[id])
      .filter(atom => atom !== undefined)
      .sort((a, b) => b.confidence - a.confidence);

    return sortedConclusions[0] || null;
  }

  private getDependentAtoms(session: Session, atomId: string): string[] {
    return Object.keys(session.atoms).filter(id =>
      session.atoms[id].dependencies.includes(atomId)
    );
  }

  private findConflictingAtoms(session: Session, atom: AtomData): string[] {
    if (atom.atomType !== 'conclusion' && atom.atomType !== 'hypothesis') {
      return [];
    }

    return Object.keys(session.atoms).filter(id => {
      const otherAtom = session.atoms[id];
      return id !== atom.atomId &&
             (otherAtom.atomType === 'conclusion' || otherAtom.atomType === 'hypothesis') &&
             otherAtom.content !== atom.content &&
             atom.dependencies.some(dep => otherAtom.dependencies.includes(dep));
    });
  }

  public processAtom(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const inputObj = (input || {}) as Record<string, unknown>;
      const sessionIdRaw = inputObj.sessionId;
      const sessionIdInput = typeof sessionIdRaw === 'string' && sessionIdRaw.length > 0 ? sessionIdRaw : undefined;

      // Auto-spawn a fresh session if the active one is completed and this
      // looks like a new reasoning chain.
      this.ensureActiveSessionForInput({
        sessionId: sessionIdInput,
        dependencies: Array.isArray(inputObj.dependencies) ? inputObj.dependencies : undefined,
      });

      // Resolve target session: explicit sessionId auto-creates if unknown.
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

      if (validatedInput.dependencies.length > 0 && !this.validateDependencies(session, validatedInput.dependencies)) {
        const missing = validatedInput.dependencies.filter(depId => session.atoms[depId] === undefined);
        throw new Error(`Dependencies not yet created: [${missing.join(', ')}]. Create those atoms first.`);
      }

      if (validatedInput.depth === undefined) {
        const depthsOfDependencies = validatedInput.dependencies
          .map(depId => (session.atoms[depId]?.depth !== undefined ? session.atoms[depId].depth! : 0))
          .filter(depth => depth !== undefined);

        validatedInput.depth = depthsOfDependencies.length > 0
          ? Math.max(...depthsOfDependencies) + 1
          : 0;
      }

      session.atoms[validatedInput.atomId] = validatedInput;

      if (!session.atomOrder.includes(validatedInput.atomId)) {
        session.atomOrder.push(validatedInput.atomId);
      }

      if (session.currentDecompositionId) {
        try {
          this.addToDecomposition(session.currentDecompositionId, validatedInput.atomId, session.id);
        } catch (_e: unknown) {
          // Silently ignore if cannot add to current decomposition
        }
      }

      const formattedAtom = this.formatAtom(validatedInput);
      console.error(formattedAtom);

      if (validatedInput.atomType === 'verification' && validatedInput.isVerified) {
        validatedInput.dependencies.forEach(depId => {
          if (session.atoms[depId]) {
            this.verifyAtom(session, depId, true);
          }
        });
      }

      const terminationStatus = this.getTerminationStatus(session.id);
      let bestConclusion = null;

      if (terminationStatus.shouldTerminate) {
        bestConclusion = this.getBestConclusion(session.id);
        // Auto-archive the session so the next zero-dep atom spawns fresh.
        session.status = 'completed';
      }

      const dependentAtoms = this.getDependentAtoms(session, validatedInput.atomId);
      const conflictingAtoms = this.findConflictingAtoms(session, validatedInput);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            atomId: validatedInput.atomId,
            atomType: validatedInput.atomType,
            isVerified: validatedInput.isVerified,
            confidence: validatedInput.confidence,
            depth: validatedInput.depth,
            sessionId: session.id,
            atomsCount: Object.keys(session.atoms).length,
            dependentAtoms,
            conflictingAtoms,
            verifiedConclusions: session.verifiedConclusions,
            terminationStatus,
            bestConclusion: bestConclusion ? {
              atomId: bestConclusion.atomId,
              content: bestConclusion.content,
              confidence: bestConclusion.confidence
            } : null,
            currentDecomposition: session.currentDecompositionId
          }, null, 2)
        }]
      };
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
