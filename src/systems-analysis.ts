import type {
  CausalGain,
  CausalGraphInput,
  CausalLink,
  ControlLoopAnalysis,
  ControlRole,
  LoopAnalysis,
  LoopEdgeRef,
  LoopKind,
} from './types.js';
import { effectiveConfidences } from './graph-analysis.js';

export const MAX_LOOP_LENGTH = 12;
export const MAX_LOOP_COUNT = 500;
export const GAIN_NUMERIC: Record<CausalGain, number> = { low: 0.5, med: 1.0, high: 2.0 };

/**
 * Drop refuted atoms and any causal link touching a refuted or missing atom.
 * NOTE: effective confidences must be computed on the ORIGINAL atom record
 * BEFORE this filter — `effectiveConfidences` silently skips missing deps, so
 * filtering first would restore full confidence to atoms resting on refuted
 * support (inverting AoT semantics). `enumerateLoops` does this correctly.
 */
export function activeCausalGraph(input: CausalGraphInput): CausalGraphInput {
  const atoms: CausalGraphInput['atoms'] = {};
  for (const [id, atom] of Object.entries(input.atoms)) {
    if (!atom.isRefuted) atoms[id] = atom;
  }
  const causalLinks = input.causalLinks.filter(link => atoms[link.from] !== undefined && atoms[link.to] !== undefined);
  return { atoms, causalLinks };
}

/** Dedupe by (from,to), keeping the entry with the earliest `created` (ties: first seen). */
export function dedupeCausalLinks(causalLinks: CausalLink[]): CausalLink[] {
  const byPair = new Map<string, CausalLink>();
  for (const link of causalLinks) {
    const key = `${link.from}>${link.to}`;
    const existing = byPair.get(key);
    if (!existing || link.created < existing.created) byPair.set(key, link);
  }
  // Preserve input order of the kept entries.
  const kept = new Set([...byPair.values()]);
  return causalLinks.filter(link => kept.has(link));
}

/** Adjacency over the given links, neighbors sorted by `to` asc (determinism). */
export function buildAdjacency(causalLinks: CausalLink[]): Map<string, Array<{ to: string; link: CausalLink }>> {
  const adjacency = new Map<string, Array<{ to: string; link: CausalLink }>>();
  for (const link of causalLinks) {
    const list = adjacency.get(link.from) ?? [];
    list.push({ to: link.to, link });
    adjacency.set(link.from, list);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.link.id < b.link.id ? -1 : 1));
  }
  return adjacency;
}

/** kind = negativeSignCount % 2 === 0 ? 'reinforcing' : 'balancing'. */
export function classifyLoopKind(edges: LoopEdgeRef[]): LoopKind {
  const negatives = edges.filter(edge => edge.sign === '-').length;
  return negatives % 2 === 0 ? 'reinforcing' : 'balancing';
}

/** Product of GAIN_NUMERIC over edges. */
export function computeLoopGain(edges: LoopEdgeRef[]): number {
  return edges.reduce((product, edge) => product * GAIN_NUMERIC[edge.gain], 1);
}

function buildLoop(cycleAtoms: string[], edgeByPair: Map<string, CausalLink>, eff: Map<string, number>): LoopAnalysis {
  const edges: LoopEdgeRef[] = cycleAtoms.map((from, index) => {
    const to = cycleAtoms[(index + 1) % cycleAtoms.length];
    const link = edgeByPair.get(`${from}>${to}`)!;
    return { from, to, sign: link.sign, gain: link.gain ?? 'med', linkId: link.id };
  });
  const negativeSignCount = edges.filter(edge => edge.sign === '-').length;
  return {
    id: `loop:${cycleAtoms.join('>')}`,
    kind: classifyLoopKind(edges),
    atoms: [...cycleAtoms],
    edges,
    negativeSignCount,
    positiveSignCount: edges.length - negativeSignCount,
    loopGain: computeLoopGain(edges),
    confidenceWeight: Math.min(...cycleAtoms.map(id => eff.get(id) ?? 0)),
  };
}

/**
 * Bounded simple-cycle enumeration over active causal links (smallest-root
 * DFS variant of Johnson 1975: each cycle is discovered exactly once, rooted
 * at its lexicographically smallest atom — which IS the canonical rotation).
 * Self-loops (1-cycles) are enumerated; lint flags them separately.
 * Cycles longer than MAX_LOOP_LENGTH are pruned; enumeration stops at
 * MAX_LOOP_COUNT (`truncated: true`). Duplicate (from,to) links are deduped
 * (earliest `created` wins). Output sorted by id asc.
 * confidenceWeight uses effectiveConfidences over the FULL input atom set,
 * computed before refuted atoms are filtered (see activeCausalGraph note).
 */
export function enumerateLoops(input: CausalGraphInput): { loops: LoopAnalysis[]; truncated: boolean } {
  const eff = effectiveConfidences(input.atoms);
  const active = activeCausalGraph(input);
  const links = dedupeCausalLinks(active.causalLinks);
  const adjacency = buildAdjacency(links);
  const edgeByPair = new Map(links.map(link => [`${link.from}>${link.to}`, link]));

  const loops: LoopAnalysis[] = [];
  let truncated = false;
  const roots = [...adjacency.keys()].sort();

  for (const root of roots) {
    if (truncated) break;
    // DFS restricted to atoms >= root; cycles found here are rooted at their
    // smallest atom, so each simple cycle is emitted exactly once.
    const path: string[] = [root];
    const onPath = new Set<string>([root]);

    const visit = (current: string): void => {
      if (truncated) return;
      for (const { to } of adjacency.get(current) ?? []) {
        if (truncated) return;
        if (to === root) {
          if (loops.length >= MAX_LOOP_COUNT) { truncated = true; return; }
          loops.push(buildLoop(path, edgeByPair, eff));
          continue;
        }
        if (to < root || onPath.has(to)) continue;
        if (path.length >= MAX_LOOP_LENGTH) continue;
        path.push(to);
        onPath.add(to);
        visit(to);
        path.pop();
        onPath.delete(to);
      }
    };

    visit(root);
  }

  loops.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { loops, truncated };
}

/**
 * Control-theoretic role mapping per loop atom:
 *   verification -> sensor; hypothesis|reasoning -> actuator;
 *   conclusion -> goal; else (premise) -> connector.
 * External disturbances are atoms NOT in the loop that have an active causal
 * link INTO a loop atom (every in-loop atom necessarily has in-loop in-degree
 * 1, so a "no incoming edge" rule inside the loop can never fire).
 * isClosedControlLoop = balancing && hasSensor && hasGoal;
 * isOpenLoopRisk = balancing && !hasSensor.
 */
export function analyzeControlLoops(input: CausalGraphInput, loops: LoopAnalysis[]): ControlLoopAnalysis[] {
  const active = activeCausalGraph(input);
  const links = dedupeCausalLinks(active.causalLinks);

  return loops.map(loop => {
    const inLoop = new Set(loop.atoms);
    const roles: Record<string, ControlRole[]> = {};
    for (const atomId of loop.atoms) {
      const atom = active.atoms[atomId];
      const role: ControlRole = atom?.atomType === 'verification' ? 'sensor'
        : atom?.atomType === 'hypothesis' || atom?.atomType === 'reasoning' ? 'actuator'
        : atom?.atomType === 'conclusion' ? 'goal'
        : 'connector';
      roles[atomId] = [role];
    }
    const externalDisturbances = [...new Set(
      links.filter(link => !inLoop.has(link.from) && inLoop.has(link.to)).map(link => link.from)
    )].sort();
    for (const atomId of externalDisturbances) {
      roles[atomId] = [...(roles[atomId] ?? []), 'disturbance'];
    }
    const loopRoles = loop.atoms.map(atomId => roles[atomId][0]);
    const hasSensor = loopRoles.includes('sensor');
    const hasGoal = loopRoles.includes('goal');
    const hasActuator = loopRoles.includes('actuator');
    return {
      loopId: loop.id,
      loopKind: loop.kind,
      roles,
      externalDisturbances,
      hasSensor,
      hasGoal,
      hasActuator,
      isClosedControlLoop: loop.kind === 'balancing' && hasSensor && hasGoal,
      isOpenLoopRisk: loop.kind === 'balancing' && !hasSensor,
    };
  });
}

/** Round-1 aggregate for `sys loops`. */
export function analyzeLoops(input: CausalGraphInput): {
  loops: LoopAnalysis[];
  controlLoops: ControlLoopAnalysis[];
  truncated: boolean;
} {
  const { loops, truncated } = enumerateLoops(input);
  return { loops, controlLoops: analyzeControlLoops(input, loops), truncated };
}
