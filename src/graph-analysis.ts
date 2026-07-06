import { AtomData, AtomType, VALID_ATOM_TYPES } from './types.js';

export interface GraphIssue {
  code: 'cycle' | 'dangling_dependency' | 'unverified_conclusion' | 'unsupported_conclusion' | 'untested_hypothesis' | 'weak_support' | 'refuted_support' | 'refuted_conclusion' | 'low_effective_conclusion';
  atomIds: string[];
  message: string;
}

export interface AtomAnalysis {
  atomId: string;
  atomType: AtomType;
  confidence: number;
  effectiveConfidence: number;
  isVerified: boolean;
  isRefuted?: boolean;
  dependents: string[];
}

export interface Contradiction {
  atomId: string;
  supportedBy: string[];
  refutedBy: string[];
}

export interface GraphAnalysis {
  atomCount: number;
  countsByType: Record<AtomType, number>;
  roots: string[];
  leaves: string[];
  topologicalOrder: string[] | null;
  cycles: string[][];
  danglingDependencies: Array<{ atomId: string; missing: string[] }>;
  atoms: AtomAnalysis[];
  weakestLinks: AtomAnalysis[];
  weakestLinksCriterion: string;
  contradictions: Contradiction[];
  refuted: string[];
  criticalPath: string[] | null;
  issues: GraphIssue[];
}

function dependentsIndex(atoms: Record<string, AtomData>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const atom of Object.values(atoms)) {
    for (const dep of atom.dependencies) {
      const list = index.get(dep) ?? [];
      list.push(atom.atomId);
      index.set(dep, list);
    }
  }
  return index;
}

export function detectCycles(atoms: Record<string, AtomData>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push(stack.slice(start));
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of atoms[id]?.dependencies ?? []) {
      if (atoms[dep]) visit(dep);
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of Object.keys(atoms)) visit(id);
  return cycles;
}

export function topologicalOrder(atoms: Record<string, AtomData>): string[] | null {
  const inDegree = new Map<string, number>();
  const dependents = dependentsIndex(atoms);
  for (const atom of Object.values(atoms)) {
    inDegree.set(atom.atomId, atom.dependencies.filter(dep => atoms[dep]).length);
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  return order.length === Object.keys(atoms).length ? order : null;
}

/**
 * Effective confidence = own confidence x weakest effective confidence among
 * dependencies, with two overrides grounded in verification semantics:
 * - A VERIFIED atom anchors its chain: empirical verification resets the
 *   support discount, so eff = own confidence (a reproduced result is not
 *   weakened by how shaky the reasoning that led to it was).
 * - A REFUTED atom has eff = 0, and everything resting on it inherits that.
 * Cycle-safe: an in-progress dependency contributes nothing (cycles are
 * reported separately).
 */
export function effectiveConfidences(atoms: Record<string, AtomData>): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const eff = (id: string): number => {
    const atom = atoms[id];
    if (!atom) return 1;
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (atom.isRefuted) { memo.set(id, 0); return 0; }
    if (visiting.has(id)) return atom.confidence;
    visiting.add(id);
    const depEffs = atom.dependencies.filter(dep => atoms[dep]).map(eff);
    visiting.delete(id);
    const support = depEffs.length > 0 ? Math.min(...depEffs) : 1;
    const value = atom.isVerified ? atom.confidence : atom.confidence * support;
    memo.set(id, value);
    return value;
  };

  for (const id of Object.keys(atoms)) eff(id);
  return memo;
}

/**
 * A contradiction is an atom with BOTH verified supporting and verified
 * refuting verification evidence. Sibling hypotheses sharing a dependency are
 * NOT contradictions — rival alternatives branching from one reasoning atom
 * is the normal AoT pattern.
 */
export function findContradictions(atoms: Record<string, AtomData>): Contradiction[] {
  const supportedBy = new Map<string, string[]>();
  const refutedBy = new Map<string, string[]>();
  for (const atom of Object.values(atoms)) {
    if (atom.atomType !== 'verification' || !atom.isVerified) continue;
    const bucket = atom.polarity === 'refutes' ? refutedBy : supportedBy;
    for (const dep of atom.dependencies) {
      if (!atoms[dep]) continue;
      const list = bucket.get(dep) ?? [];
      list.push(atom.atomId);
      bucket.set(dep, list);
    }
  }
  const contradictions: Contradiction[] = [];
  for (const [atomId, refuters] of refutedBy) {
    const supporters = supportedBy.get(atomId) ?? [];
    if (supporters.length > 0) {
      contradictions.push({ atomId, supportedBy: supporters, refutedBy: refuters });
    }
  }
  return contradictions;
}

/** Highest-effective-confidence dependency chain ending at the best conclusion. */
function criticalPathTo(atoms: Record<string, AtomData>, effective: Map<string, number>, targetId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = targetId;
  while (current && !seen.has(current)) {
    path.unshift(current);
    seen.add(current);
    const deps: string[] = (atoms[current]?.dependencies ?? []).filter((dep: string) => atoms[dep]);
    current = deps.sort((a, b) => (effective.get(b) ?? 0) - (effective.get(a) ?? 0))[0];
  }
  return path;
}

export function analyzeGraph(atoms: Record<string, AtomData>, options: { weakThreshold?: number } = {}): GraphAnalysis {
  const weakThreshold = options.weakThreshold ?? 0.5;
  const ids = Object.keys(atoms);
  const dependents = dependentsIndex(atoms);
  const cycles = detectCycles(atoms);
  const effective = effectiveConfidences(atoms);

  const countsByType = Object.fromEntries(VALID_ATOM_TYPES.map(type => [type, 0])) as Record<AtomType, number>;
  const danglingDependencies: GraphAnalysis['danglingDependencies'] = [];
  for (const atom of Object.values(atoms)) {
    countsByType[atom.atomType] += 1;
    const missing = atom.dependencies.filter(dep => !atoms[dep]);
    if (missing.length > 0) danglingDependencies.push({ atomId: atom.atomId, missing });
  }

  const atomAnalyses: AtomAnalysis[] = ids.map(id => ({
    atomId: id,
    atomType: atoms[id].atomType,
    confidence: atoms[id].confidence,
    effectiveConfidence: Number((effective.get(id) ?? atoms[id].confidence).toFixed(4)),
    isVerified: atoms[id].isVerified,
    ...(atoms[id].isRefuted ? { isRefuted: true } : {}),
    dependents: dependents.get(id) ?? [],
  }));

  // Selective, not top-N: every atom whose effective confidence falls below
  // the threshold, weakest first. Leaves included — a weak conclusion is a
  // weak link even with nothing resting on it.
  const weakestLinks = atomAnalyses
    .filter(a => a.effectiveConfidence < weakThreshold)
    .sort((a, b) => a.effectiveConfidence - b.effectiveConfidence);
  const weakestLinksCriterion = `effectiveConfidence < ${weakThreshold} (all matches, ascending)`;

  const contradictions = findContradictions(atoms);

  const conclusions = Object.values(atoms).filter(atom => atom.atomType === 'conclusion');
  const bestConclusion = [...conclusions].sort((a, b) => (effective.get(b.atomId) ?? 0) - (effective.get(a.atomId) ?? 0))[0];

  const issues: GraphIssue[] = [];
  for (const cycle of cycles) {
    issues.push({ code: 'cycle', atomIds: cycle, message: `Dependency cycle: ${cycle.join(' -> ')}` });
  }
  for (const dangling of danglingDependencies) {
    issues.push({ code: 'dangling_dependency', atomIds: [dangling.atomId], message: `${dangling.atomId} depends on missing atoms: ${dangling.missing.join(', ')}` });
  }
  for (const conclusion of conclusions) {
    if (!conclusion.isVerified && !conclusion.isRefuted) {
      issues.push({ code: 'unverified_conclusion', atomIds: [conclusion.atomId], message: `Conclusion ${conclusion.atomId} is not verified` });
    }
    if (conclusion.dependencies.length === 0) {
      issues.push({ code: 'unsupported_conclusion', atomIds: [conclusion.atomId], message: `Conclusion ${conclusion.atomId} has no supporting dependencies` });
    }
  }
  for (const atom of Object.values(atoms)) {
    if (atom.atomType === 'hypothesis' && !atom.isVerified && !atom.isRefuted) {
      const tested = (dependents.get(atom.atomId) ?? []).some(id => atoms[id]?.atomType === 'verification');
      if (!tested) {
        issues.push({ code: 'untested_hypothesis', atomIds: [atom.atomId], message: `Hypothesis ${atom.atomId} has no verification atom` });
      }
    }
  }
  const refuted = Object.values(atoms).filter(atom => atom.isRefuted).map(atom => atom.atomId);
  for (const atom of Object.values(atoms)) {
    const refutedDeps = atom.dependencies.filter(dep => atoms[dep]?.isRefuted);
    if (refutedDeps.length > 0) {
      issues.push({ code: 'refuted_support', atomIds: [atom.atomId, ...refutedDeps], message: `${atom.atomId} rests on refuted atom(s): ${refutedDeps.join(', ')}` });
    }
    if (atom.isRefuted && atom.atomType === 'conclusion') {
      issues.push({ code: 'refuted_conclusion', atomIds: [atom.atomId], message: `Conclusion ${atom.atomId} has been refuted by verified evidence` });
    }
  }
  for (const analysis of atomAnalyses) {
    if (analysis.effectiveConfidence < weakThreshold && analysis.dependents.length > 0) {
      issues.push({ code: 'weak_support', atomIds: [analysis.atomId], message: `Effective confidence of ${analysis.atomId} is ${analysis.effectiveConfidence} (below ${weakThreshold}); ${analysis.dependents.length} dependent atom(s) rest on it: ${analysis.dependents.join(', ')}` });
    }
  }
  // Termination uses RAW confidence; surface when a would-terminate
  // conclusion is actually resting on weak support.
  for (const conclusion of conclusions) {
    const eff = effective.get(conclusion.atomId) ?? 0;
    if (conclusion.isVerified && conclusion.confidence >= 0.9 && eff < weakThreshold) {
      issues.push({ code: 'low_effective_conclusion', atomIds: [conclusion.atomId], message: `Verified conclusion ${conclusion.atomId} terminates the session at raw confidence ${conclusion.confidence}, but its effective (support-propagated) confidence is only ${Number(eff.toFixed(4))}` });
    }
  }

  return {
    atomCount: ids.length,
    countsByType,
    roots: ids.filter(id => atoms[id].dependencies.filter(dep => atoms[dep]).length === 0),
    leaves: ids.filter(id => (dependents.get(id) ?? []).length === 0),
    topologicalOrder: topologicalOrder(atoms),
    cycles,
    danglingDependencies,
    atoms: atomAnalyses,
    weakestLinks,
    weakestLinksCriterion,
    contradictions,
    refuted,
    criticalPath: bestConclusion ? criticalPathTo(atoms, effective, bestConclusion.atomId) : null,
    issues,
  };
}
