import { AtomData, AtomType, DecompositionState, VALID_ATOM_TYPES } from './types.js';

export class AtomOfThoughtsServer {
  protected atoms: Record<string, AtomData> = {};
  protected atomOrder: string[] = [];
  private verifiedConclusions: string[] = [];
  private decompositionStates: Record<string, DecompositionState> = {};
  public maxDepth: number = 5;
  private currentDecompositionId: string | null = null;

  constructor(maxDepth?: number) {
    if (maxDepth !== undefined && maxDepth > 0) {
      this.maxDepth = maxDepth;
    }
  }

  public getAtoms(): Record<string, AtomData> {
    return this.atoms;
  }

  public getAtomOrder(): string[] {
    return this.atomOrder;
  }

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
    if (!Array.isArray(data.dependencies)) {
      throw new Error('Invalid dependencies: must be an array of atom IDs');
    }
    if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
      throw new Error('Invalid confidence: must be a number between 0 and 1');
    }

    return {
      atomId: data.atomId as string,
      content: data.content as string,
      atomType: data.atomType as AtomType,
      dependencies: data.dependencies as string[],
      confidence: data.confidence as number,
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

  private validateDependencies(dependencies: string[]): boolean {
    return dependencies.every(depId => this.atoms[depId] !== undefined);
  }

  protected verifyAtom(atomId: string, isVerified: boolean) {
    if (this.atoms[atomId]) {
      this.atoms[atomId].isVerified = isVerified;

      if (isVerified && this.atoms[atomId].atomType === 'conclusion') {
        this.verifiedConclusions.push(atomId);
      } else if (!isVerified && this.atoms[atomId].atomType === 'conclusion') {
        this.verifiedConclusions = this.verifiedConclusions.filter(id => id !== atomId);
      }

      if (isVerified && this.atoms[atomId].atomType === 'verification') {
        const verifiedHypothesisIds = this.atoms[atomId].dependencies.filter(
          depId => this.atoms[depId] && this.atoms[depId].atomType === 'hypothesis'
        );

        if (verifiedHypothesisIds.length > 0) {
          verifiedHypothesisIds.forEach(hypId => {
            this.atoms[hypId].isVerified = true;
          });
          this.checkForContraction(verifiedHypothesisIds);
        }
      }
    }
  }

  public startDecomposition(atomId: string): string {
    if (!this.atoms[atomId]) {
      throw new Error(`Atom with ID ${atomId} not found`);
    }

    const decompositionId = `decomp_${Date.now()}`;

    this.decompositionStates[decompositionId] = {
      originalAtomId: atomId,
      subAtoms: [],
      isCompleted: false
    };

    this.currentDecompositionId = decompositionId;

    return decompositionId;
  }

  public addToDecomposition(decompositionId: string, atomId: string): boolean {
    if (!this.decompositionStates[decompositionId]) {
      throw new Error(`Decomposition with ID ${decompositionId} not found`);
    }

    if (this.decompositionStates[decompositionId].isCompleted) {
      throw new Error(`Decomposition ${decompositionId} is already completed`);
    }

    if (!this.atoms[atomId]) {
      throw new Error(`Atom with ID ${atomId} not found`);
    }

    const parentDepth = this.atoms[this.decompositionStates[decompositionId].originalAtomId].depth || 0;
    this.atoms[atomId].depth = parentDepth + 1;

    this.decompositionStates[decompositionId].subAtoms.push(atomId);

    return true;
  }

  public completeDecomposition(decompositionId: string): boolean {
    if (!this.decompositionStates[decompositionId]) {
      throw new Error(`Decomposition with ID ${decompositionId} not found`);
    }

    this.decompositionStates[decompositionId].isCompleted = true;

    if (this.currentDecompositionId === decompositionId) {
      this.currentDecompositionId = null;
    }

    return true;
  }

  private checkForContraction(verifiedAtomIds: string[]): void {
    for (const [decompId, state] of Object.entries(this.decompositionStates)) {
      if (state.isCompleted &&
          verifiedAtomIds.some(id => state.subAtoms.includes(id)) &&
          this.areAllSubAtomsVerified(state.subAtoms)) {
        this.performContraction(decompId);
      }
    }
  }

  private areAllSubAtomsVerified(atomIds: string[]): boolean {
    return atomIds.every(id => this.atoms[id] && this.atoms[id].isVerified);
  }

  private performContraction(decompositionId: string): void {
    const state = this.decompositionStates[decompositionId];
    if (!state) return;

    const originalAtom = this.atoms[state.originalAtomId];
    if (!originalAtom) return;

    const subAtomConfidences = state.subAtoms.map(id => this.atoms[id]?.confidence || 0);
    const averageConfidence = subAtomConfidences.reduce((sum, conf) => sum + conf, 0) / subAtomConfidences.length;

    originalAtom.confidence = averageConfidence;
    originalAtom.isVerified = true;

    if (originalAtom.atomType === 'hypothesis' && originalAtom.confidence >= 0.8) {
      this.suggestConclusion(originalAtom);
    }
  }

  protected suggestConclusion(verifiedHypothesis: AtomData): string {
    const conclusionId = `C${Object.keys(this.atoms).filter(id => id.startsWith('C')).length + 1}`;

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

    this.atoms[conclusionId] = conclusionAtom;
    this.atomOrder.push(conclusionId);

    return conclusionId;
  }

  protected shouldTerminate(): boolean {
    const atMaxDepth = Object.values(this.atoms).some(atom => atom.depth !== undefined && atom.depth >= this.maxDepth);
    const hasStrongConclusion = this.verifiedConclusions.some(id => this.atoms[id] && this.atoms[id].confidence >= 0.9);
    return atMaxDepth || hasStrongConclusion;
  }

  public getTerminationStatus(): { shouldTerminate: boolean; reason: string } {
    const atMaxDepth = Object.values(this.atoms).some(atom => atom.depth !== undefined && atom.depth >= this.maxDepth);
    const hasStrongConclusion = this.verifiedConclusions.some(id => this.atoms[id] && this.atoms[id].confidence >= 0.9);

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

  public getBestConclusion(): AtomData | null {
    if (this.verifiedConclusions.length === 0) return null;

    const sortedConclusions = [...this.verifiedConclusions]
      .map(id => this.atoms[id])
      .filter(atom => atom !== undefined)
      .sort((a, b) => b.confidence - a.confidence);

    return sortedConclusions[0] || null;
  }

  private getDependentAtoms(atomId: string): string[] {
    return Object.keys(this.atoms).filter(id =>
      this.atoms[id].dependencies.includes(atomId)
    );
  }

  private findConflictingAtoms(atom: AtomData): string[] {
    if (atom.atomType !== 'conclusion' && atom.atomType !== 'hypothesis') {
      return [];
    }

    return Object.keys(this.atoms).filter(id => {
      const otherAtom = this.atoms[id];
      return id !== atom.atomId &&
             (otherAtom.atomType === 'conclusion' || otherAtom.atomType === 'hypothesis') &&
             otherAtom.content !== atom.content &&
             atom.dependencies.some(dep => otherAtom.dependencies.includes(dep));
    });
  }

  public processAtom(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const validatedInput = this.validateAtomData(input);

      if (validatedInput.dependencies.length > 0 && !this.validateDependencies(validatedInput.dependencies)) {
        throw new Error('Invalid dependencies: one or more dependency atoms do not exist');
      }

      if (validatedInput.depth === undefined) {
        const depthsOfDependencies = validatedInput.dependencies
          .map(depId => (this.atoms[depId]?.depth !== undefined ? this.atoms[depId].depth! : 0))
          .filter(depth => depth !== undefined);

        validatedInput.depth = depthsOfDependencies.length > 0
          ? Math.max(...depthsOfDependencies) + 1
          : 0;
      }

      this.atoms[validatedInput.atomId] = validatedInput;

      if (!this.atomOrder.includes(validatedInput.atomId)) {
        this.atomOrder.push(validatedInput.atomId);
      }

      if (this.currentDecompositionId) {
        try {
          this.addToDecomposition(this.currentDecompositionId, validatedInput.atomId);
        } catch (_e: unknown) {
          // Silently ignore if cannot add to current decomposition
        }
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

      const terminationStatus = this.getTerminationStatus();
      let bestConclusion = null;

      if (terminationStatus.shouldTerminate) {
        bestConclusion = this.getBestConclusion();
      }

      const dependentAtoms = this.getDependentAtoms(validatedInput.atomId);
      const conflictingAtoms = this.findConflictingAtoms(validatedInput);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            atomId: validatedInput.atomId,
            atomType: validatedInput.atomType,
            isVerified: validatedInput.isVerified,
            confidence: validatedInput.confidence,
            depth: validatedInput.depth,
            atomsCount: Object.keys(this.atoms).length,
            dependentAtoms,
            conflictingAtoms,
            verifiedConclusions: this.verifiedConclusions,
            terminationStatus,
            bestConclusion: bestConclusion ? {
              atomId: bestConclusion.atomId,
              content: bestConclusion.content,
              confidence: bestConclusion.confidence
            } : null,
            currentDecomposition: this.currentDecompositionId
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
