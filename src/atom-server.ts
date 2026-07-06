import {
  AtomData,
  AtomType,
  CausalGain,
  CausalLink,
  CausalSign,
  DecompositionState,
  Session,
  SessionSummary,
  VALID_ATOM_TYPES,
} from './types.js';
import { dedupeCausalLinks } from './systems-analysis.js';
import { EventLog } from './events.js';

const DEFAULT_SESSION_ID = 'default';

export interface AtomServerSnapshot {
  activeSessionId: string;
  maxDepth: number;
  sessions: Record<string, Session>;
}

export class AtomOfThoughtsServer {
  protected sessions: Record<string, Session> = {};
  protected activeSessionId: string = DEFAULT_SESSION_ID;
  public maxDepth: number = 5;
  // Live-TUI event log. Pure side-effect — never affects reasoning logic.
  protected events: EventLog | null = null;

  constructor(maxDepth?: number, events?: EventLog) {
    if (maxDepth !== undefined && maxDepth > 0) {
      this.maxDepth = maxDepth;
    }
    this.events = events ?? null;
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
      causalLinks: [],
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

  public exportState(): AtomServerSnapshot {
    return {
      activeSessionId: this.activeSessionId,
      maxDepth: this.maxDepth,
      sessions: this.sessions,
    };
  }

  public importState(state: Partial<AtomServerSnapshot>): void {
    if (state.sessions && typeof state.sessions === 'object') {
      this.sessions = state.sessions;
      // Old (pre-systems-layer) sessions have no causalLinks — leave them
      // absent; getters normalize `?? []`. Hand-edited/imported state may
      // carry duplicate (from,to) pairs: normalize, earliest `created` wins.
      for (const session of Object.values(this.sessions)) {
        if (Array.isArray(session.causalLinks) && session.causalLinks.length > 1) {
          session.causalLinks = dedupeCausalLinks(session.causalLinks);
        }
      }
    }
    if (state.activeSessionId && this.sessions[state.activeSessionId]) {
      this.activeSessionId = state.activeSessionId;
    }
    if (Number.isFinite(Number(state.maxDepth)) && Number(state.maxDepth) > 0) {
      this.maxDepth = Number(state.maxDepth);
    }
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
    session.causalLinks = [];
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
  protected ensureActiveSessionForInput(input: { sessionId?: string; dependencies?: unknown[] }): string | null {
    if (input.sessionId) return null;
    const active = this.sessions[this.activeSessionId];
    if (!active || active.status !== 'completed') return null;
    const hasDeps = Array.isArray(input.dependencies) && input.dependencies.length > 0;
    if (hasDeps) return null;
    // Auto-spawn
    const id = this.nextDefaultSessionId();
    this.sessions[id] = this.createSession(id);
    this.activeSessionId = id;
    return id;
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
  // Causal links (systems-thinking layer)
  // -------------------------------------------------------------------------

  public getCausalLinks(sessionId?: string): CausalLink[] {
    return this.getSession(sessionId).causalLinks ?? [];
  }

  public addCausalLink(link: { from: string; to: string; sign: CausalSign; gain?: CausalGain; label?: string }, sessionId?: string): CausalLink {
    const session = this.getSession(sessionId);
    for (const endpoint of [link.from, link.to]) {
      const atom = session.atoms[endpoint];
      if (!atom) throw new Error(`Atom with ID ${endpoint} not found`);
      if (atom.isRefuted) throw new Error(`Cannot causally link refuted atom ${endpoint}: causal analysis excludes refuted atoms`);
    }
    // Materialize on pre-upgrade sessions: read-getters normalizing `?? []`
    // is not enough for mutation paths.
    session.causalLinks ??= [];
    if (session.causalLinks.some(existing => existing.from === link.from && existing.to === link.to)) {
      throw new Error(`Causal link ${link.from} -> ${link.to} already exists`);
    }
    const created: CausalLink = {
      id: `cl:${link.from}>${link.to}`,
      from: link.from,
      to: link.to,
      sign: link.sign,
      gain: link.gain ?? 'med',
      ...(link.label ? { label: link.label } : {}),
      created: Date.now(),
    };
    session.causalLinks.push(created);
    return created;
  }

  /** Removes ALL entries matching (from,to) — duplicates can only enter via hand-edited state. */
  public removeCausalLink(from: string, to: string, sessionId?: string): CausalLink {
    const session = this.getSession(sessionId);
    const links = session.causalLinks ?? [];
    const removed = links.find(link => link.from === from && link.to === to);
    if (!removed) throw new Error(`Causal link ${from} -> ${to} not found`);
    session.causalLinks = links.filter(link => !(link.from === from && link.to === to));
    return removed;
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

    const atom: AtomData = {
      atomId: data.atomId as string,
      content: data.content as string,
      atomType: data.atomType as AtomType,
      dependencies,
      confidence,
      created: data.created as number || Date.now(),
      isVerified: data.isVerified as boolean || false,
      depth: data.depth as number | undefined,
    };
    if (data.polarity === 'refutes' || data.polarity === 'supports') {
      if (atom.atomType !== 'verification') {
        throw new Error('polarity is only valid on verification atoms');
      }
      atom.polarity = data.polarity;
    }
    if (Array.isArray(data.evidence)) {
      const evidence = (data.evidence as unknown[]).filter((e): e is string => typeof e === 'string' && e.length > 0);
      if (evidence.length > 0) atom.evidence = evidence;
    }
    return atom;
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

  /**
   * Shared pre-insert pipeline for full AND light servers: dependency
   * existence, cycle guard, depth derivation. Keeps fast/full semantics
   * identical (fast used to skip all three).
   */
  protected prepareAtomForInsert(session: Session, atom: AtomData): void {
    if (atom.dependencies.length > 0 && !this.validateDependencies(session, atom.dependencies)) {
      const missing = atom.dependencies.filter(depId => session.atoms[depId] === undefined);
      throw new Error(`Dependencies not yet created: [${missing.join(', ')}]. Create those atoms first.`);
    }
    this.assertNoCycle(session, atom.atomId, atom.dependencies);
    if (atom.depth === undefined) {
      const depthsOfDependencies = atom.dependencies
        .map(depId => (session.atoms[depId]?.depth !== undefined ? session.atoms[depId].depth! : 0));
      atom.depth = depthsOfDependencies.length > 0 ? Math.max(...depthsOfDependencies) + 1 : 0;
    }
  }

  /**
   * Reject dependency sets that would create a cycle. Cycles are only
   * constructible by overwriting an existing atom with dependencies that
   * transitively reach it.
   */
  protected assertNoCycle(session: Session, atomId: string, dependencies: string[]): void {
    const visited = new Set<string>();
    const stack = [...dependencies];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === atomId) {
        throw new Error(`Dependency cycle detected: ${atomId} would transitively depend on itself`);
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const atom = session.atoms[current];
      if (atom) stack.push(...atom.dependencies);
    }
  }

  // -------------------------------------------------------------------------
  // Direct mutation (CLI-facing)
  // -------------------------------------------------------------------------

  public updateAtom(atomId: string, patch: { content?: string; confidence?: number; isVerified?: boolean; dependencies?: string[]; polarity?: 'supports' | 'refutes'; evidence?: string[] }, sessionId?: string): AtomData {
    const session = this.getSession(sessionId);
    const atom = session.atoms[atomId];
    if (!atom) throw new Error(`Atom with ID ${atomId} not found`);

    if (patch.dependencies !== undefined) {
      if (!this.validateDependencies(session, patch.dependencies)) {
        const missing = patch.dependencies.filter(depId => session.atoms[depId] === undefined);
        throw new Error(`Dependencies not yet created: [${missing.join(', ')}]. Create those atoms first.`);
      }
      this.assertNoCycle(session, atomId, patch.dependencies);
      atom.dependencies = patch.dependencies;
    }
    if (patch.content !== undefined) atom.content = patch.content;
    if (patch.confidence !== undefined) {
      if (patch.confidence < 0 || patch.confidence > 1) throw new Error('Confidence must be between 0 and 1');
      atom.confidence = patch.confidence;
    }
    if (patch.polarity !== undefined) {
      if (atom.atomType !== 'verification') throw new Error('polarity is only valid on verification atoms');
      atom.polarity = patch.polarity;
    }
    if (patch.evidence !== undefined) {
      atom.evidence = patch.evidence.length > 0 ? patch.evidence : undefined;
    }
    if (patch.isVerified !== undefined) {
      this.verifyAtom(session, atomId, patch.isVerified);
    }
    return atom;
  }

  /**
   * Archive the session if its termination condition now holds (e.g. after a
   * `set` bumped a verified conclusion past the threshold). Returns the
   * termination status so callers can surface it.
   */
  public archiveIfTerminated(sessionId?: string): { shouldTerminate: boolean; reason: string; archived: boolean } {
    const session = this.getSession(sessionId);
    const status = this.getTerminationStatus(session.id);
    let archived = false;
    if (status.shouldTerminate && session.status !== 'completed') {
      session.status = 'completed';
      archived = true;
      this.events?.emit({ kind: 'termination', t: Date.now(), reason: status.reason, sessionId: session.id });
    }
    return { shouldTerminate: status.shouldTerminate, reason: status.reason, archived };
  }

  /** Manually archive (or reopen) a session. */
  public setSessionStatus(status: 'active' | 'completed', sessionId?: string): Session {
    const session = this.getSession(sessionId);
    session.status = status;
    return session;
  }

  public removeAtom(atomId: string, sessionId?: string, force = false): { removed: string; detachedFrom: string[]; removedCausalLinks?: string[] } {
    const session = this.getSession(sessionId);
    if (!session.atoms[atomId]) throw new Error(`Atom with ID ${atomId} not found`);

    const dependents = this.getDependentAtoms(session, atomId);
    if (dependents.length > 0 && !force) {
      throw new Error(`Atom ${atomId} has dependents: [${dependents.join(', ')}]. Pass --force to detach and remove.`);
    }
    for (const dependent of dependents) {
      session.atoms[dependent].dependencies = session.atoms[dependent].dependencies.filter(dep => dep !== atomId);
    }
    delete session.atoms[atomId];
    session.atomOrder = session.atomOrder.filter(id => id !== atomId);
    session.verifiedConclusions = session.verifiedConclusions.filter(id => id !== atomId);
    for (const state of Object.values(session.decompositionStates)) {
      state.subAtoms = state.subAtoms.filter(id => id !== atomId);
    }
    // Same sweep as dependency detachment: causal links touching the removed
    // atom go with it (with and without --force).
    const removedCausalLinks = (session.causalLinks ?? [])
      .filter(link => link.from === atomId || link.to === atomId)
      .map(link => link.id);
    if (removedCausalLinks.length > 0) {
      session.causalLinks = session.causalLinks!.filter(link => link.from !== atomId && link.to !== atomId);
    }
    return { removed: atomId, detachedFrom: dependents, ...(removedCausalLinks.length > 0 ? { removedCausalLinks } : {}) };
  }

  // -------------------------------------------------------------------------
  // Verification, decomposition, termination — all session-scoped
  // -------------------------------------------------------------------------

  protected verifyAtom(session: Session, atomId: string, isVerified: boolean) {
    const atom = session.atoms[atomId];
    if (!atom) return;

    atom.isVerified = isVerified;
    if (isVerified) {
      atom.isRefuted = undefined;
      this.events?.emit({ kind: 'atom_verified', t: Date.now(), atomId, confidence: atom.confidence, sessionId: session.id });
    }

    if (atom.atomType === 'conclusion') {
      if (isVerified && !session.verifiedConclusions.includes(atomId)) {
        session.verifiedConclusions.push(atomId);
      } else if (!isVerified) {
        session.verifiedConclusions = session.verifiedConclusions.filter(id => id !== atomId);
      }
    }

    // Verified verification atoms propagate according to their polarity.
    // Refuting evidence marks targets refuted — it must never verify them.
    // Supporting evidence verifies hypothesis/verification/conclusion deps;
    // premises and reasoning are never silently flipped to verified.
    if (isVerified && atom.atomType === 'verification') {
      if (atom.polarity === 'refutes') {
        for (const targetId of atom.dependencies) {
          const target = session.atoms[targetId];
          if (!target) continue;
          target.isRefuted = true;
          target.isVerified = false;
          if (target.atomType === 'conclusion') {
            session.verifiedConclusions = session.verifiedConclusions.filter(id => id !== targetId);
          }
        }
      } else {
        const hypothesisIds: string[] = [];
        for (const targetId of atom.dependencies) {
          const target = session.atoms[targetId];
          if (!target) continue;
          if (target.atomType === 'hypothesis') {
            target.isVerified = true;
            target.isRefuted = undefined;
            hypothesisIds.push(targetId);
            this.maybeSuggestConclusion(session, target);
          } else if (target.atomType === 'conclusion' || target.atomType === 'verification') {
            // Recurse so verifiedConclusions bookkeeping and nested
            // verification chains stay consistent.
            this.verifyAtom(session, targetId, true);
          }
        }
        if (hypothesisIds.length > 0) this.checkForContraction(session, hypothesisIds);
      }
    }
  }

  /**
   * Suggest a conclusion for a verified hypothesis with confidence >= 0.8,
   * unless one already depends on it (prevents duplicate injections on
   * overwrite/re-verification).
   */
  protected maybeSuggestConclusion(session: Session, hypothesis: AtomData): string | null {
    if (hypothesis.atomType !== 'hypothesis' || !hypothesis.isVerified || hypothesis.confidence < 0.8) return null;
    const alreadyConcluded = Object.values(session.atoms).some(
      atom => atom.atomType === 'conclusion' && atom.dependencies.includes(hypothesis.atomId)
    );
    if (alreadyConcluded) return null;
    return this.suggestConclusion(session, hypothesis);
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
    this.events?.emit({ kind: 'decomposition_started', t: Date.now(), decompositionId, atomId, sessionId: session.id });

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

    this.events?.emit({ kind: 'decomposition_completed', t: Date.now(), decompositionId, sessionId: session.id });
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
    let n = Object.keys(session.atoms).filter(id => /^C\d+$/.test(id)).length + 1;
    while (session.atoms[`C${n}`]) n++;
    const conclusionId = `C${n}`;

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
    this.events?.emit({ kind: 'atom_added', t: Date.now(), atom: conclusionAtom, sessionId: session.id });
    this.events?.emit({ kind: 'conclusion_suggested', t: Date.now(), atomId: conclusionId, fromHypothesis: verifiedHypothesis.atomId, confidence: conclusionAtom.confidence, sessionId: session.id });

    return conclusionId;
  }

  protected shouldTerminate(session: Session): boolean {
    const atMaxDepth = Object.values(session.atoms).some(atom => atom.depth !== undefined && atom.depth >= this.maxDepth);
    const hasStrongConclusion = session.verifiedConclusions.some(id => session.atoms[id] && session.atoms[id].confidence >= 0.9);
    return atMaxDepth || hasStrongConclusion;
  }

  public getTerminationStatus(sessionId?: string): { shouldTerminate: boolean; reason: string; detail: Record<string, unknown> } {
    const session = this.getSession(sessionId);
    const depths = Object.values(session.atoms).map(atom => atom.depth).filter((d): d is number => d !== undefined);
    const maxAtomDepth = depths.length > 0 ? Math.max(...depths) : 0;
    const atMaxDepth = maxAtomDepth >= this.maxDepth;
    const verifiedConfidences = session.verifiedConclusions
      .map(id => session.atoms[id]?.confidence)
      .filter((c): c is number => c !== undefined);
    const bestVerifiedConfidence = verifiedConfidences.length > 0 ? Math.max(...verifiedConfidences) : null;
    const hasStrongConclusion = bestVerifiedConfidence !== null && bestVerifiedConfidence >= 0.9;

    // Actionable detail: WHY the session does or does not terminate, so a
    // "Continue reasoning" status is never a guessing game.
    const detail = {
      maxAtomDepth,
      maxDepth: this.maxDepth,
      verifiedConclusionCount: session.verifiedConclusions.length,
      bestVerifiedConclusionConfidence: bestVerifiedConfidence,
      conclusionConfidenceThreshold: 0.9,
    };

    if (atMaxDepth && hasStrongConclusion) {
      return { shouldTerminate: true, reason: 'Maximum depth reached and strong conclusion found', detail };
    } else if (atMaxDepth) {
      return { shouldTerminate: true, reason: 'Maximum depth reached', detail };
    } else if (hasStrongConclusion) {
      return { shouldTerminate: true, reason: 'Strong conclusion found', detail };
    }
    const gaps: string[] = [];
    gaps.push(`depth ${maxAtomDepth}/${this.maxDepth}`);
    if (session.verifiedConclusions.length === 0) {
      gaps.push('no verified conclusion yet');
    } else {
      gaps.push(`best verified conclusion at ${bestVerifiedConfidence} (needs >= 0.9)`);
    }
    return { shouldTerminate: false, reason: `Continue reasoning: ${gaps.join('; ')}`, detail };
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
      const autoSpawnedSession = this.ensureActiveSessionForInput({
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
      this.prepareAtomForInsert(session, validatedInput);

      const overwritten = session.atoms[validatedInput.atomId] !== undefined;
      session.atoms[validatedInput.atomId] = validatedInput;

      if (!session.atomOrder.includes(validatedInput.atomId)) {
        session.atomOrder.push(validatedInput.atomId);
      }
      this.events?.emit({ kind: 'atom_added', t: Date.now(), atom: validatedInput, sessionId: session.id });

      if (session.currentDecompositionId) {
        try {
          this.addToDecomposition(session.currentDecompositionId, validatedInput.atomId, session.id);
        } catch (_e: unknown) {
          // Silently ignore if cannot add to current decomposition
        }
      }

      const formattedAtom = this.formatAtom(validatedInput);
      console.error(formattedAtom);

      // Creation-time verification routes through the SAME verifyAtom path as
      // `set --verified`, so propagation semantics (hypothesis/conclusion
      // targets only, polarity-aware) and verifiedConclusions bookkeeping are
      // identical for both entry points.
      if (validatedInput.isVerified) {
        this.verifyAtom(session, validatedInput.atomId, true);
      }

      const terminationStatus = this.getTerminationStatus(session.id);
      let bestConclusion = null;

      if (terminationStatus.shouldTerminate) {
        bestConclusion = this.getBestConclusion(session.id);
        // Auto-archive the session so the next zero-dep atom spawns fresh.
        session.status = 'completed';
        this.events?.emit({ kind: 'termination', t: Date.now(), reason: terminationStatus.reason, sessionId: session.id });
      }

      const dependentAtoms = this.getDependentAtoms(session, validatedInput.atomId);
      const conflictingAtoms = this.findConflictingAtoms(session, validatedInput);

      const payload: Record<string, unknown> = {
        atomId: validatedInput.atomId,
        atomType: validatedInput.atomType,
        isVerified: validatedInput.isVerified,
        confidence: validatedInput.confidence,
        depth: validatedInput.depth,
        sessionId: session.id,
        atomsCount: Object.keys(session.atoms).length,
      };
      // Loud, not silent: surface overwrites and auto-spawned sessions.
      if (overwritten) payload.overwritten = true;
      if (autoSpawnedSession) payload.autoSpawnedSession = autoSpawnedSession;
      // Only include collection fields when non-empty.
      if (dependentAtoms.length > 0) payload.dependentAtoms = dependentAtoms;
      if (conflictingAtoms.length > 0) payload.conflictingAtoms = conflictingAtoms;
      if (session.verifiedConclusions.length > 0) payload.verifiedConclusions = session.verifiedConclusions;
      if (session.currentDecompositionId) payload.currentDecomposition = session.currentDecompositionId;
      // Termination only when meaningful (i.e. shouldTerminate=true). The default
      // "Continue reasoning" reason adds noise to every call.
      if (terminationStatus.shouldTerminate) {
        payload.terminationStatus = terminationStatus;
      }
      if (bestConclusion) {
        payload.bestConclusion = {
          atomId: bestConclusion.atomId,
          content: bestConclusion.content,
          confidence: bestConclusion.confidence,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
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
