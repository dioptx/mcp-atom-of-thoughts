import { AtomData, AtomType, VALID_ATOM_TYPES } from './types.js';

export interface GraphIssue {
  code: 'cycle' | 'dangling_dependency' | 'unverified_conclusion' | 'unsupported_conclusion' | 'untested_hypothesis' | 'weak_support';
  atomIds: string[];
  message: string;
}

export interface AtomAnalysis {
  atomId: string;
  atomType: AtomType;
  confidence: number;
  effectiveConfidence: number;
  isVerified: boolean;
  dependents: string[];
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
  contradictions: Array<{ a: string; b: string; sharedDependencies: string[] }>;
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
 * dependencies. Captures that a confident atom resting on a shaky support
 * chain is itself shaky. Cycle-safe: an in-progress dependency contributes
 * nothing (cycles are reported separately).
 */
export function effectiveConfidences(atoms: Record<string, AtomData>): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const eff = (id: string): number => {
    const atom = atoms[id];
    if (!atom) return 1;
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return atom.confidence;
    visiting.add(id);
    const depEffs = atom.dependencies.filter(dep => atoms[dep]).map(eff);
    visiting.delete(id);
    const support = depEffs.length > 0 ? Math.min(...depEffs) : 1;
    const value = atom.confidence * support;
    memo.set(id, value);
    return value;
  };

  for (const id of Object.keys(atoms)) eff(id);
  return memo;
}

export function findContradictions(atoms: Record<string, AtomData>): Array<{ a: string; b: string; sharedDependencies: string[] }> {
  const candidates = Object.values(atoms).filter(atom => atom.atomType === 'hypothesis' || atom.atomType === 'conclusion');
  const contradictions: Array<{ a: string; b: string; sharedDependencies: string[] }> = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.content === b.content) continue;
      const shared = a.dependencies.filter(dep => b.dependencies.includes(dep));
      if (shared.length > 0) contradictions.push({ a: a.atomId, b: b.atomId, sharedDependencies: shared });
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
    dependents: dependents.get(id) ?? [],
  }));

  const weakestLinks = atomAnalyses
    .filter(a => a.dependents.length > 0)
    .sort((a, b) => a.effectiveConfidence - b.effectiveConfidence)
    .slice(0, 5);

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
    if (!conclusion.isVerified) {
      issues.push({ code: 'unverified_conclusion', atomIds: [conclusion.atomId], message: `Conclusion ${conclusion.atomId} is not verified` });
    }
    if (conclusion.dependencies.length === 0) {
      issues.push({ code: 'unsupported_conclusion', atomIds: [conclusion.atomId], message: `Conclusion ${conclusion.atomId} has no supporting dependencies` });
    }
  }
  for (const atom of Object.values(atoms)) {
    if (atom.atomType === 'hypothesis' && !atom.isVerified) {
      const tested = (dependents.get(atom.atomId) ?? []).some(id => atoms[id]?.atomType === 'verification');
      if (!tested) {
        issues.push({ code: 'untested_hypothesis', atomIds: [atom.atomId], message: `Hypothesis ${atom.atomId} has no verification atom` });
      }
    }
  }
  for (const analysis of atomAnalyses) {
    if (analysis.effectiveConfidence < weakThreshold && analysis.dependents.length > 0) {
      issues.push({ code: 'weak_support', atomIds: [analysis.atomId], message: `${analysis.atomId} supports ${analysis.dependents.length} atom(s) with effective confidence ${analysis.effectiveConfidence}` });
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
    contradictions,
    criticalPath: bestConclusion ? criticalPathTo(atoms, effective, bestConclusion.atomId) : null,
    issues,
  };
}
