import type {
  CausalGain,
  CausalGraphInput,
  CausalLink,
  ControlLoopAnalysis,
  ControlRole,
  LeveragePoint,
  LeverageRationaleCode,
  LoopAnalysis,
  LoopEdgeRef,
  LoopKind,
  SimDirection,
  SimulationEffect,
  SimulationResult,
  SystemsAnalysis,
  SystemsIssue,
} from './types.js';
import { effectiveConfidences } from './graph-analysis.js';

export const MAX_LOOP_LENGTH = 12;
export const MAX_LOOP_COUNT = 500;
export const GAIN_NUMERIC: Record<CausalGain, number> = { low: 0.5, med: 1.0, high: 2.0 };
export const SIM_DAMPING = 0.85;
export const MIN_STRENGTH = 0.1;
export const MAX_LINK_TRAVERSALS = 2;

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

// ---------------------------------------------------------------------------
// Round 2: leverage ranking, perturbation simulation, systems lint.
// ---------------------------------------------------------------------------

const K_REINFORCING = 1.2;
const K_BALANCING = 1.0;

/** Min-max normalizer; degenerate max === min maps everything to 0 (never NaN). */
function makeNorm(values: number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? () => 0 : (value: number) => (value - min) / (max - min);
}

/**
 * Rank atoms by systemic leverage:
 *   raw = 0.40·norm(loopParticipationCount) + 0.25·norm(causalOutDegree)
 *       + 0.35·norm(loopDominance)·effConf
 *   loopDominance(a) = Σ over loops containing a of
 *       (loopGain/|atoms|) × K(kind) × confidenceWeight, K = 1.2/1.0.
 * score = raw / max(raw) (all-zero raw → all scores 0, rank by atomId asc).
 * Population = active atoms in ≥1 active causal link or ≥1 loop. effConf comes
 * from the FULL atom set (same discipline as enumerateLoops).
 */
export function computeLeverage(input: CausalGraphInput, loops: LoopAnalysis[]): LeveragePoint[] {
  const eff = effectiveConfidences(input.atoms);
  const active = activeCausalGraph(input);
  const links = dedupeCausalLinks(active.causalLinks);

  const population = new Set<string>();
  for (const link of links) { population.add(link.from); population.add(link.to); }
  for (const loop of loops) for (const id of loop.atoms) population.add(id);
  if (population.size === 0) return [];

  const outDegree = new Map<string, number>();
  for (const link of links) outDegree.set(link.from, (outDegree.get(link.from) ?? 0) + 1);

  const loopCounts = new Map<string, number>();
  // Per-kind dominance sums are kept WITHOUT the K factor so the
  // REINFORCING_DRIVER/BALANCING_DRIVER comparison is unbiased; K applies
  // only inside the composite loopDominance term.
  const domReinforcing = new Map<string, number>();
  const domBalancing = new Map<string, number>();
  for (const loop of loops) {
    const contribution = (loop.loopGain / loop.atoms.length) * loop.confidenceWeight;
    for (const id of loop.atoms) {
      loopCounts.set(id, (loopCounts.get(id) ?? 0) + 1);
      const bucket = loop.kind === 'reinforcing' ? domReinforcing : domBalancing;
      bucket.set(id, (bucket.get(id) ?? 0) + contribution);
    }
  }
  const dominance = (id: string): number =>
    (domReinforcing.get(id) ?? 0) * K_REINFORCING + (domBalancing.get(id) ?? 0) * K_BALANCING;

  const atomIds = [...population].sort();
  const normLoops = makeNorm(atomIds.map(id => loopCounts.get(id) ?? 0));
  const normOut = makeNorm(atomIds.map(id => outDegree.get(id) ?? 0));
  const normDom = makeNorm(atomIds.map(id => dominance(id)));

  // p90 nearest-rank over sorted NONZERO out-degrees; no nonzero degrees →
  // HIGH_CAUSAL_OUT_DEGREE never fires; a single nonzero degree fires for
  // that atom (accepted noise).
  const nonzeroDegrees = atomIds.map(id => outDegree.get(id) ?? 0).filter(d => d > 0).sort((a, b) => a - b);
  const p90 = nonzeroDegrees.length === 0
    ? Number.POSITIVE_INFINITY
    : nonzeroDegrees[Math.ceil(0.9 * nonzeroDegrees.length) - 1];

  // In-loop control roles only: an atom whose sole appearance in a roles map
  // is as an external disturbance never earns ACTUATOR_ROLE/SENSOR_ROLE.
  const controlByLoop = new Map(analyzeControlLoops(input, loops).map(control => [control.loopId, control]));
  const inLoopRoles = new Map<string, Set<ControlRole>>();
  for (const loop of loops) {
    const control = controlByLoop.get(loop.id);
    if (!control) continue;
    for (const id of loop.atoms) {
      const set = inLoopRoles.get(id) ?? new Set<ControlRole>();
      for (const role of control.roles[id] ?? []) if (role !== 'disturbance') set.add(role);
      inLoopRoles.set(id, set);
    }
  }

  const raws = new Map<string, number>();
  for (const id of atomIds) {
    const effConf = eff.get(id) ?? 0;
    raws.set(id,
      0.40 * normLoops(loopCounts.get(id) ?? 0)
      + 0.25 * normOut(outDegree.get(id) ?? 0)
      + 0.35 * normDom(dominance(id)) * effConf);
  }
  const maxRaw = Math.max(...raws.values());

  const points = atomIds.map(id => {
    const loopCount = loopCounts.get(id) ?? 0;
    const causalOutDegree = outDegree.get(id) ?? 0;
    const effConf = eff.get(id) ?? 0;
    const roles = inLoopRoles.get(id) ?? new Set<ControlRole>();
    const codes: LeverageRationaleCode[] = [];
    if (loopCount >= 2) codes.push('LOOP_HUB');
    if (causalOutDegree > 0 && causalOutDegree >= p90) codes.push('HIGH_CAUSAL_OUT_DEGREE');
    if (loopCount >= 1) {
      codes.push((domReinforcing.get(id) ?? 0) >= (domBalancing.get(id) ?? 0) ? 'REINFORCING_DRIVER' : 'BALANCING_DRIVER');
    }
    if (effConf >= 0.8) codes.push('HIGH_EFFECTIVE_CONFIDENCE');
    else if (effConf < 0.5) codes.push('LOW_EFFECTIVE_CONFIDENCE');
    if (roles.has('actuator')) codes.push('ACTUATOR_ROLE');
    if (roles.has('sensor')) codes.push('SENSOR_ROLE');
    return {
      atomId: id,
      rank: 0,
      score: maxRaw === 0 ? 0 : (raws.get(id) ?? 0) / maxRaw,
      effectiveConfidence: effConf,
      loopCount,
      causalOutDegree,
      rationaleCodes: codes,
    };
  });
  points.sort((a, b) => b.score - a.score || (a.atomId < b.atomId ? -1 : 1));
  points.forEach((point, index) => { point.rank = index + 1; });
  return points;
}

interface PropagationArrival { strength: number; witness: string[] }
interface Propagation {
  /** atomId -> direction -> max strength + first-recorded witness path. */
  byDirection: Map<string, Map<'up' | 'down', PropagationArrival>>;
  /** atomId -> pathLinkIds of the very first arrival (any direction). */
  firstWitness: Map<string, string[]>;
  traversedLinkIds: Set<string>;
}

/**
 * Deterministic FIFO propagation. A link is traversed iff its global
 * traversal count < MAX_LINK_TRAVERSALS AND the damped strength stays
 * >= MIN_STRENGTH; every traversal enqueues (the per-linkId cap is the sole
 * limiter, guaranteeing <= 2·|links| total traversals). On repeat arrival in
 * the same direction: keep max strength, keep first witness.
 */
function propagate(
  adjacency: Map<string, Array<{ to: string; link: CausalLink }>>,
  sourceId: string,
  direction: 'up' | 'down',
  skipLinkIds: Set<string> | null,
): Propagation {
  const byDirection = new Map<string, Map<'up' | 'down', PropagationArrival>>();
  const firstWitness = new Map<string, string[]>();
  const traversedLinkIds = new Set<string>();
  const traversalCount = new Map<string, number>();
  const queue: Array<{ atom: string; dir: 'up' | 'down'; strength: number; path: string[] }> =
    [{ atom: sourceId, dir: direction, strength: 1, path: [] }];

  while (queue.length > 0) {
    const { atom, dir, strength, path } = queue.shift()!;
    for (const { to, link } of adjacency.get(atom) ?? []) {
      if (skipLinkIds?.has(link.id)) continue;
      if ((traversalCount.get(link.id) ?? 0) >= MAX_LINK_TRAVERSALS) continue;
      const nextStrength = Math.min(1, strength * SIM_DAMPING * GAIN_NUMERIC[link.gain ?? 'med']);
      if (nextStrength < MIN_STRENGTH) continue;
      traversalCount.set(link.id, (traversalCount.get(link.id) ?? 0) + 1);
      traversedLinkIds.add(link.id);
      const nextDir: 'up' | 'down' = link.sign === '+' ? dir : dir === 'up' ? 'down' : 'up';
      const nextPath = [...path, link.id];
      let dirs = byDirection.get(to);
      if (!dirs) { dirs = new Map(); byDirection.set(to, dirs); }
      const existing = dirs.get(nextDir);
      if (!existing) dirs.set(nextDir, { strength: nextStrength, witness: nextPath });
      else if (nextStrength > existing.strength) existing.strength = nextStrength;
      if (!firstWitness.has(to)) firstWitness.set(to, nextPath);
      queue.push({ atom: to, dir: nextDir, strength: nextStrength, path: nextPath });
    }
  }
  return { byDirection, firstWitness, traversedLinkIds };
}

/**
 * Propagate a hypothetical up/down perturbation at one atom through the
 * active deduped causal graph ('+' preserves direction, '-' flips it),
 * damped by SIM_DAMPING × gain per hop, dropped below MIN_STRENGTH, with a
 * global per-linkId traversal cap of MAX_LINK_TRAVERSALS.
 *
 * Direction is 'ambiguous' when an atom is reached in BOTH directions.
 * Provenance vs the acyclic-only run (identical rules, feedback edges from
 * enumerateLoops removed): not acyclic-reachable → 'emergent'; reachable but
 * with a different direction set in the full graph → 'loop-mediated'; else
 * 'first-order'. Witness pathLinkIds come from the acyclic run for
 * acyclic-reachable atoms (never a canonical-ordering artifact), from the
 * full run for emergent atoms. NOTE: when loop enumeration is truncated the
 * feedback-edge set is incomplete, so provenance classification is
 * best-effort (conditional on truncated === false).
 */
export function simulate(input: CausalGraphInput, atomId: string, direction: 'up' | 'down'): SimulationResult {
  // Source validation on the RAW atom set, before refuted filtering.
  const source = input.atoms[atomId];
  if (!source) throw new Error(`Atom with ID ${atomId} not found`);
  if (source.isRefuted) throw new Error(`Cannot simulate from refuted atom ${atomId}: causal analysis excludes refuted atoms`);

  const links = dedupeCausalLinks(activeCausalGraph(input).causalLinks);
  const adjacency = buildAdjacency(links);
  const { loops } = enumerateLoops(input);
  const feedbackEdgeIds = new Set(loops.flatMap(loop => loop.edges.map(edge => edge.linkId)));

  const full = propagate(adjacency, atomId, direction, null);
  const acyclic = propagate(adjacency, atomId, direction, feedbackEdgeIds);

  const effects: SimulationEffect[] = [];
  for (const id of [...full.byDirection.keys()].sort()) {
    if (id === atomId) continue; // the source atom itself is not an effect
    const dirs = full.byDirection.get(id)!;
    const effectDirection: SimDirection = dirs.size === 2 ? 'ambiguous' : [...dirs.keys()][0];
    const strength = Math.max(...[...dirs.values()].map(arrival => arrival.strength));
    const acyclicDirs = acyclic.byDirection.get(id);
    let provenance: SimulationEffect['provenance'];
    let pathLinkIds: string[];
    if (!acyclicDirs) {
      provenance = 'emergent';
      pathLinkIds = full.firstWitness.get(id) ?? [];
    } else {
      const sameDirections = acyclicDirs.size === dirs.size && [...dirs.keys()].every(d => acyclicDirs.has(d));
      provenance = sameDirections ? 'first-order' : 'loop-mediated';
      pathLinkIds = acyclic.firstWitness.get(id) ?? [];
    }
    effects.push({ atomId: id, direction: effectDirection, provenance, pathLinkIds, strength });
  }

  return {
    sourceAtomId: atomId,
    inputDirection: direction,
    effects,
    loopsTraversed: loops
      .filter(loop => loop.edges.every(edge => full.traversedLinkIds.has(edge.linkId)))
      .map(loop => loop.id)
      .sort(),
    ambiguousAtomIds: effects.filter(effect => effect.direction === 'ambiguous').map(effect => effect.atomId),
    emergentAtomIds: effects.filter(effect => effect.provenance === 'emergent').map(effect => effect.atomId),
  };
}

/**
 * Systems lint over the raw causal graph input. Issue codes:
 *   REINFORCING_COMPOUNDING_RISK  reinforcing loop, confidenceWeight >= floor, loopGain >= 4
 *   LOOP_CONTRADICTS_CONCLUSION   an in-loop actuator's simulate (either input
 *                                 direction) assigns exactly 'down' to an
 *                                 isVerified conclusion or exactly 'up' to an
 *                                 isRefuted conclusion (deduped per loop+conclusion)
 *   BALANCING_LOOP_NO_SENSOR      balancing, no sensor AND no actuator
 *   OPEN_LOOP_BALANCING_RISK      balancing, no sensor, has actuator (specific over general)
 *   ORPHAN_CAUSAL_LINK            raw link endpoint missing from raw atoms
 *   SELF_LOOP                     from === to
 *   DUPLICATE_CAUSAL_LINK         duplicate (from,to) pair in raw input
 *   LOOP_ENUMERATION_TRUNCATED    enumeration hit MAX_LOOP_COUNT
 * Issues sorted code asc, then loopIds asc, then atomIds asc.
 */
export function analyzeSystems(
  input: CausalGraphInput,
  options: { compoundingConfidenceFloor?: number } = {},
): SystemsAnalysis {
  const floor = options.compoundingConfidenceFloor ?? 0.7;
  const { loops, truncated } = enumerateLoops(input);
  const controlLoops = analyzeControlLoops(input, loops);
  const leveragePoints = computeLeverage(input, loops);
  const issues: SystemsIssue[] = [];

  // Raw-input structural hygiene, checked before any filtering.
  const byPair = new Map<string, CausalLink[]>();
  const selfLoopPairs = new Set<string>();
  for (const link of input.causalLinks) {
    const missing = [...new Set([link.from, link.to].filter(id => input.atoms[id] === undefined))].sort();
    if (missing.length > 0) {
      issues.push({ code: 'ORPHAN_CAUSAL_LINK', atomIds: missing, message: `Causal link ${link.id} references missing atom(s): ${missing.join(', ')}` });
    }
    if (link.from === link.to && !selfLoopPairs.has(link.id)) {
      selfLoopPairs.add(link.id);
      issues.push({ code: 'SELF_LOOP', atomIds: [link.from], message: `Causal link ${link.id} is a self-loop: ${link.from} directly influences itself` });
    }
    const pairKey = `${link.from}>${link.to}`;
    byPair.set(pairKey, [...(byPair.get(pairKey) ?? []), link]);
  }
  for (const pairLinks of byPair.values()) {
    if (pairLinks.length < 2) continue;
    const { from, to } = pairLinks[0];
    issues.push({ code: 'DUPLICATE_CAUSAL_LINK', atomIds: [from, to], message: `${pairLinks.length} causal links share the pair ${from} -> ${to}; only the earliest created is analyzed` });
  }

  const controlByLoop = new Map(controlLoops.map(control => [control.loopId, control]));
  for (const loop of loops) {
    const control = controlByLoop.get(loop.id)!;
    if (loop.kind === 'reinforcing' && loop.confidenceWeight >= floor && loop.loopGain >= 4) {
      issues.push({ code: 'REINFORCING_COMPOUNDING_RISK', atomIds: [...loop.atoms].sort(), loopIds: [loop.id], message: `Reinforcing causal loop ${loop.id} compounds with gain ${loop.loopGain} at confidence ${loop.confidenceWeight}` });
    }
    if (loop.kind === 'balancing' && !control.hasSensor) {
      issues.push(control.hasActuator
        ? { code: 'OPEN_LOOP_BALANCING_RISK', atomIds: [...loop.atoms].sort(), loopIds: [loop.id], message: `Balancing causal loop ${loop.id} has an actuator but no sensor (verification atom): it corrects blind` }
        : { code: 'BALANCING_LOOP_NO_SENSOR', atomIds: [...loop.atoms].sort(), loopIds: [loop.id], message: `Balancing causal loop ${loop.id} has neither sensor nor actuator: no way to observe or steer it` });
    }
  }

  // LOOP_CONTRADICTS_CONCLUSION: both input directions per in-loop actuator;
  // effect direction must be exactly 'down'/'up' (ambiguous never fires).
  const simCache = new Map<string, SimulationResult>();
  const fired = new Set<string>();
  for (const loop of loops) {
    const control = controlByLoop.get(loop.id)!;
    const actuators = loop.atoms.filter(id => (control.roles[id] ?? []).includes('actuator'));
    for (const actuator of actuators) {
      for (const dir of ['up', 'down'] as const) {
        const cacheKey = `${actuator}|${dir}`;
        let sim = simCache.get(cacheKey);
        if (!sim) { sim = simulate(input, actuator, dir); simCache.set(cacheKey, sim); }
        for (const effect of sim.effects) {
          const target = input.atoms[effect.atomId];
          if (!target || target.atomType !== 'conclusion') continue;
          const contradicts = (effect.direction === 'down' && target.isVerified)
            || (effect.direction === 'up' && target.isRefuted === true);
          if (!contradicts) continue;
          const key = `${loop.id}|${effect.atomId}`;
          if (fired.has(key)) continue;
          fired.add(key);
          issues.push({ code: 'LOOP_CONTRADICTS_CONCLUSION', atomIds: [effect.atomId], loopIds: [loop.id], message: `Causal loop ${loop.id}: perturbing actuator ${actuator} drives ${effect.direction === 'down' ? 'verified' : 'refuted'} conclusion ${effect.atomId} ${effect.direction}` });
        }
      }
    }
  }

  if (truncated) {
    issues.push({ code: 'LOOP_ENUMERATION_TRUNCATED', atomIds: [], message: `Causal loop enumeration stopped at ${MAX_LOOP_COUNT} loops; systems analysis may be incomplete` });
  }

  issues.sort((a, b) =>
    a.code.localeCompare(b.code)
    || (a.loopIds ?? []).join(',').localeCompare((b.loopIds ?? []).join(','))
    || a.atomIds.join(',').localeCompare(b.atomIds.join(',')));

  return { loops, controlLoops, leveragePoints, issues, truncated };
}
