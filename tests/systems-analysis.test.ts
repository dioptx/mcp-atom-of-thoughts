import { describe, expect, it } from 'vitest';
import {
  GAIN_NUMERIC,
  MAX_LOOP_COUNT,
  MAX_LOOP_LENGTH,
  activeCausalGraph,
  analyzeControlLoops,
  analyzeLoops,
  analyzeSystems,
  buildAdjacency,
  classifyLoopKind,
  computeLeverage,
  computeLoopGain,
  dedupeCausalLinks,
  enumerateLoops,
  simulate,
} from '../src/systems-analysis.js';
import { effectiveConfidences } from '../src/graph-analysis.js';
import type { AtomData, CausalGain, CausalLink, CausalSign } from '../src/types.js';

function atom(partial: Partial<AtomData> & { atomId: string }): AtomData {
  return {
    content: partial.atomId,
    atomType: 'reasoning',
    dependencies: [],
    confidence: 0.8,
    created: 1,
    isVerified: false,
    ...partial,
  } as AtomData;
}

function byId(atoms: AtomData[]): Record<string, AtomData> {
  return Object.fromEntries(atoms.map(a => [a.atomId, a]));
}

function link(from: string, to: string, sign: CausalSign = '+', gain?: CausalGain, created = 1): CausalLink {
  return { id: `cl:${from}>${to}`, from, to, sign, ...(gain ? { gain } : {}), created };
}

describe('systems-analysis', () => {
  it('classifies a 2-node all-positive loop as reinforcing', () => {
    const input = { atoms: byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]), causalLinks: [link('A', 'B', '+'), link('B', 'A', '+')] };
    const { loops, truncated } = enumerateLoops(input);
    expect(truncated).toBe(false);
    expect(loops).toHaveLength(1);
    expect(loops[0].kind).toBe('reinforcing');
    expect(loops[0].id).toBe('loop:A>B');
    expect(loops[0].positiveSignCount).toBe(2);
  });

  it('classifies an even count of negative edges as reinforcing (two minuses)', () => {
    const input = { atoms: byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]), causalLinks: [link('A', 'B', '-'), link('B', 'A', '-')] };
    const { loops } = enumerateLoops(input);
    expect(loops[0].kind).toBe('reinforcing');
    expect(loops[0].negativeSignCount).toBe(2);
  });

  it('classifies a 2-node loop with one negative edge as balancing', () => {
    const input = { atoms: byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]), causalLinks: [link('A', 'B', '+'), link('B', 'A', '-')] };
    const { loops } = enumerateLoops(input);
    expect(loops).toHaveLength(1);
    expect(loops[0].kind).toBe('balancing');
  });

  it('enumerates 3-node loops of both kinds with canonical edge-walk order', () => {
    const atoms = byId(['A', 'B', 'C', 'X', 'Y', 'Z'].map(id => atom({ atomId: id })));
    const input = {
      atoms,
      causalLinks: [
        link('A', 'B', '+'), link('B', 'C', '+'), link('C', 'A', '+'), // reinforcing
        link('X', 'Y', '+'), link('Y', 'Z', '-'), link('Z', 'X', '+'), // balancing
      ],
    };
    const { loops } = enumerateLoops(input);
    expect(loops.map(l => l.id)).toEqual(['loop:A>B>C', 'loop:X>Y>Z']);
    expect(loops[0].kind).toBe('reinforcing');
    expect(loops[1].kind).toBe('balancing');
    expect(loops[0].atoms).toEqual(['A', 'B', 'C']);
  });

  it('finds nested/shared loops through a hub atom', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const input = {
      atoms,
      causalLinks: [link('A', 'B'), link('B', 'A'), link('A', 'C'), link('C', 'A'), link('B', 'C'), link('C', 'B')],
    };
    const { loops } = enumerateLoops(input);
    // 2-cycles: AB, AC, BC; 3-cycles: A>B>C and A>C>B.
    expect(loops.map(l => l.id).sort()).toEqual(['loop:A>B', 'loop:A>B>C', 'loop:A>C', 'loop:A>C>B', 'loop:B>C']);
  });

  it('produces identical ids and order regardless of input link ordering', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const links = [link('C', 'A'), link('B', 'C'), link('A', 'B'), link('B', 'A'), link('A', 'C', '-')];
    const forward = enumerateLoops({ atoms, causalLinks: links });
    const reversed = enumerateLoops({ atoms, causalLinks: [...links].reverse() });
    expect(forward.loops).toEqual(reversed.loops);
    // Canonical rotation: cycle discovered from any rotation starts at the lex-smallest atom.
    expect(forward.loops.every(loop => [...loop.atoms].sort()[0] === loop.atoms[0])).toBe(true);
  });

  it('excludes refuted atoms: the loop disappears and links touching them drop', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B', isRefuted: true })]);
    const input = { atoms, causalLinks: [link('A', 'B'), link('B', 'A')] };
    const active = activeCausalGraph(input);
    expect(Object.keys(active.atoms)).toEqual(['A']);
    expect(active.causalLinks).toEqual([]);
    expect(enumerateLoops(input).loops).toEqual([]);
  });

  it('computes loopGain as the product of numeric gains', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const input = { atoms, causalLinks: [link('A', 'B', '+', 'high'), link('B', 'C', '+', 'low'), link('C', 'A', '+')] };
    const { loops } = enumerateLoops(input);
    expect(loops[0].loopGain).toBeCloseTo(GAIN_NUMERIC.high * GAIN_NUMERIC.low * GAIN_NUMERIC.med);
    expect(computeLoopGain(loops[0].edges)).toBe(loops[0].loopGain);
  });

  it('confidenceWeight is min effective confidence over loop atoms', () => {
    const atoms = byId([
      atom({ atomId: 'A', confidence: 0.9 }),
      atom({ atomId: 'B', confidence: 0.5 }),
    ]);
    const input = { atoms, causalLinks: [link('A', 'B'), link('B', 'A')] };
    const eff = effectiveConfidences(atoms);
    const { loops } = enumerateLoops(input);
    expect(loops[0].confidenceWeight).toBeCloseTo(Math.min(eff.get('A')!, eff.get('B')!));
    expect(loops[0].confidenceWeight).toBeCloseTo(0.5);
  });

  it('computes confidenceWeight on the FULL atom set: refuted support outside the loop keeps atoms zeroed', () => {
    // R is refuted; A epistemically depends on R, so eff(A) = 0. If effective
    // confidences were computed AFTER dropping R, A would silently regain
    // confidence 0.8 — inverting AoT semantics.
    const atoms = byId([
      atom({ atomId: 'R', isRefuted: true }),
      atom({ atomId: 'A', dependencies: ['R'], confidence: 0.8 }),
      atom({ atomId: 'B', confidence: 0.9 }),
    ]);
    const input = { atoms, causalLinks: [link('A', 'B'), link('B', 'A')] };
    const { loops } = enumerateLoops(input);
    expect(loops).toHaveLength(1);
    expect(loops[0].confidenceWeight).toBe(0);
  });

  it('prunes loops longer than MAX_LOOP_LENGTH', () => {
    const n = MAX_LOOP_LENGTH + 1; // 13-atom ring: not enumerable
    const ids = Array.from({ length: n }, (_, i) => `N${String(i).padStart(2, '0')}`);
    const atoms = byId(ids.map(id => atom({ atomId: id })));
    const ring = ids.map((id, i) => link(id, ids[(i + 1) % n]));
    expect(enumerateLoops({ atoms, causalLinks: ring }).loops).toEqual([]);
    // A 12-atom ring IS enumerable.
    const okIds = ids.slice(0, MAX_LOOP_LENGTH);
    const okRing = okIds.map((id, i) => link(id, okIds[(i + 1) % okIds.length]));
    const okAtoms = byId(okIds.map(id => atom({ atomId: id })));
    expect(enumerateLoops({ atoms: okAtoms, causalLinks: okRing }).loops).toHaveLength(1);
  });

  it('stops at MAX_LOOP_COUNT and reports truncated', () => {
    // Complete digraph on 7 nodes has 2365 simple cycles (length >= 2).
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const atoms = byId(ids.map(id => atom({ atomId: id })));
    const links: CausalLink[] = [];
    for (const from of ids) for (const to of ids) if (from !== to) links.push(link(from, to));
    const { loops, truncated } = enumerateLoops({ atoms, causalLinks: links });
    expect(truncated).toBe(true);
    expect(loops).toHaveLength(MAX_LOOP_COUNT);
  });

  it('enumerates self-loops as 1-cycles with correct classification', () => {
    const atoms = byId([atom({ atomId: 'A' })]);
    const negative = enumerateLoops({ atoms, causalLinks: [link('A', 'A', '-')] });
    expect(negative.loops).toHaveLength(1);
    expect(negative.loops[0].id).toBe('loop:A');
    expect(negative.loops[0].kind).toBe('balancing');
    const positive = enumerateLoops({ atoms, causalLinks: [link('A', 'A', '+')] });
    expect(positive.loops[0].kind).toBe('reinforcing');
  });

  it('dedupes duplicate (from,to) links keeping the earliest created', () => {
    const early = link('A', 'B', '+', 'med', 100);
    const late = { ...link('A', 'B', '-', 'high', 200), id: 'cl:A>B' };
    expect(dedupeCausalLinks([late, early])).toEqual([early]);
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const { loops } = enumerateLoops({ atoms, causalLinks: [late, early, link('B', 'A')] });
    expect(loops).toHaveLength(1);
    expect(loops[0].edges[0].sign).toBe('+'); // earliest wins
  });

  it('maps control roles: sensor/actuator/goal/connector, closed loop and open-loop risk', () => {
    const atoms = byId([
      atom({ atomId: 'P1', atomType: 'premise' }),
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'V1', atomType: 'verification' }),
      atom({ atomId: 'C1', atomType: 'conclusion' }),
    ]);
    const balancingClosed = analyzeLoops({
      atoms,
      causalLinks: [link('C1', 'H1', '-'), link('H1', 'V1', '+'), link('V1', 'C1', '+')],
    });
    const control = balancingClosed.controlLoops[0];
    expect(control.loopKind).toBe('balancing');
    expect(control.roles.V1).toEqual(['sensor']);
    expect(control.roles.H1).toEqual(['actuator']);
    expect(control.roles.C1).toEqual(['goal']);
    expect(control.isClosedControlLoop).toBe(true);
    expect(control.isOpenLoopRisk).toBe(false);

    const balancingNoSensor = analyzeLoops({
      atoms,
      causalLinks: [link('P1', 'H1', '-'), link('H1', 'P1', '+')],
    });
    const risky = balancingNoSensor.controlLoops[0];
    expect(risky.roles.P1).toEqual(['connector']);
    expect(risky.hasSensor).toBe(false);
    expect(risky.isOpenLoopRisk).toBe(true);
    expect(risky.isClosedControlLoop).toBe(false);
  });

  it('reports external disturbances: non-loop atoms with an active link into the loop', () => {
    const atoms = byId([
      atom({ atomId: 'A' }),
      atom({ atomId: 'B' }),
      atom({ atomId: 'D', atomType: 'premise' }),
      atom({ atomId: 'DR', atomType: 'premise', isRefuted: true }),
    ]);
    const input = {
      atoms,
      causalLinks: [link('A', 'B'), link('B', 'A'), link('D', 'A', '-'), link('DR', 'B')],
    };
    const { loops, controlLoops } = analyzeLoops(input);
    expect(loops).toHaveLength(1);
    const control = controlLoops[0];
    // DR is refuted: its link is inactive, so it is NOT a disturbance.
    expect(control.externalDisturbances).toEqual(['D']);
    expect(control.roles.D).toEqual(['disturbance']);
    expect(control.roles.DR).toBeUndefined();
    // In-loop atoms never get the disturbance role (in-loop in-degree >= 1 always).
    expect(control.roles.A).not.toContain('disturbance');
  });

  it('buildAdjacency sorts neighbors by target id for determinism', () => {
    const adjacency = buildAdjacency([link('A', 'C'), link('A', 'B')]);
    expect(adjacency.get('A')!.map(entry => entry.to)).toEqual(['B', 'C']);
  });

  it('classifyLoopKind matches parity of negative edges', () => {
    const edge = (sign: CausalSign) => ({ from: 'A', to: 'B', sign, gain: 'med' as const, linkId: 'cl:A>B' });
    expect(classifyLoopKind([edge('+'), edge('+')])).toBe('reinforcing');
    expect(classifyLoopKind([edge('-'), edge('+')])).toBe('balancing');
    expect(classifyLoopKind([edge('-'), edge('-'), edge('-')])).toBe('balancing');
  });
});

function leverageFor(input: { atoms: Record<string, AtomData>; causalLinks: CausalLink[] }) {
  return computeLeverage(input, enumerateLoops(input).loops);
}

describe('computeLeverage', () => {
  it('returns empty for a graph with no causal links', () => {
    expect(leverageFor({ atoms: byId([atom({ atomId: 'A' })]), causalLinks: [] })).toEqual([]);
  });

  it('all-zero raw scores yield score 0 (never NaN) and rank purely by atomId asc', () => {
    // Symmetric 2-loop: every population metric is identical -> every min-max
    // norm degenerates (max === min -> 0) -> raw all 0 (fixes #6/#7).
    const input = { atoms: byId([atom({ atomId: 'B' }), atom({ atomId: 'A' })]), causalLinks: [link('A', 'B'), link('B', 'A')] };
    const points = leverageFor(input);
    expect(points.map(p => p.atomId)).toEqual(['A', 'B']);
    expect(points.map(p => p.rank)).toEqual([1, 2]);
    expect(points.every(p => p.score === 0 && Number.isFinite(p.score))).toBe(true);
  });

  it('a dominant reinforcing hub ranks first with LOOP_HUB and HIGH_CAUSAL_OUT_DEGREE', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const input = {
      atoms,
      causalLinks: [
        link('A', 'B', '+', 'high'), link('B', 'A', '+', 'high'), // gain-4 reinforcing loop
        link('A', 'C', '+'), link('C', 'A', '+'), // gain-1 reinforcing loop
      ],
    };
    const points = leverageFor(input);
    expect(points[0].atomId).toBe('A');
    expect(points[0].score).toBe(1);
    expect(points[0].loopCount).toBe(2);
    expect(points[0].causalOutDegree).toBe(2);
    expect(points[0].rationaleCodes).toContain('LOOP_HUB');
    // p90 nearest-rank of nonzero out-degrees [1,1,2] is 2: only the hub fires.
    expect(points[0].rationaleCodes).toContain('HIGH_CAUSAL_OUT_DEGREE');
    for (const other of points.slice(1)) {
      expect(other.rationaleCodes).not.toContain('LOOP_HUB');
      expect(other.rationaleCodes).not.toContain('HIGH_CAUSAL_OUT_DEGREE');
    }
  });

  it('single nonzero out-degree population: p90 fires for that atom (documented noise)', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const points = leverageFor({ atoms, causalLinks: [link('A', 'B')] });
    expect(points.find(p => p.atomId === 'A')!.rationaleCodes).toContain('HIGH_CAUSAL_OUT_DEGREE');
    expect(points.find(p => p.atomId === 'B')!.rationaleCodes).not.toContain('HIGH_CAUSAL_OUT_DEGREE');
  });

  it('driver codes compare per-kind dominance without the K bias; tie goes reinforcing', () => {
    const atoms = byId(['A', 'B', 'X', 'Y'].map(id => atom({ atomId: id })));
    const input = {
      atoms,
      causalLinks: [
        link('A', 'B', '+'), link('B', 'A', '+'), // reinforcing loop
        link('X', 'Y', '+'), link('Y', 'X', '-'), // balancing loop
      ],
    };
    const points = leverageFor(input);
    expect(points.find(p => p.atomId === 'A')!.rationaleCodes).toContain('REINFORCING_DRIVER');
    expect(points.find(p => p.atomId === 'X')!.rationaleCodes).toContain('BALANCING_DRIVER');
    expect(points.find(p => p.atomId === 'X')!.rationaleCodes).not.toContain('REINFORCING_DRIVER');
    // Exact tie (identical loops of both kinds through the same atom would be
    // needed); the reachable tie is dominance 0 on both sides — loop atoms
    // with zero confidence weight. Tie -> reinforcing.
    const zeroConf = {
      atoms: byId([atom({ atomId: 'R', isRefuted: true }), atom({ atomId: 'P', dependencies: ['R'] }), atom({ atomId: 'Q', dependencies: ['R'] })]),
      causalLinks: [link('P', 'Q', '+'), link('Q', 'P', '-')],
    };
    const tied = leverageFor(zeroConf);
    expect(tied.find(p => p.atomId === 'P')!.rationaleCodes).toContain('REINFORCING_DRIVER');
  });

  it('confidence codes: >=0.8 HIGH, <0.5 LOW, neither in between', () => {
    const atoms = byId([
      atom({ atomId: 'A', confidence: 0.95 }),
      atom({ atomId: 'B', confidence: 0.3 }),
      atom({ atomId: 'C', confidence: 0.6 }),
    ]);
    const points = leverageFor({ atoms, causalLinks: [link('A', 'B'), link('B', 'C'), link('C', 'A')] });
    expect(points.find(p => p.atomId === 'A')!.rationaleCodes).toContain('HIGH_EFFECTIVE_CONFIDENCE');
    expect(points.find(p => p.atomId === 'B')!.rationaleCodes).toContain('LOW_EFFECTIVE_CONFIDENCE');
    const mid = points.find(p => p.atomId === 'C')!.rationaleCodes;
    expect(mid).not.toContain('HIGH_EFFECTIVE_CONFIDENCE');
    expect(mid).not.toContain('LOW_EFFECTIVE_CONFIDENCE');
  });

  it('ACTUATOR_ROLE/SENSOR_ROLE only for in-loop roles, never for external disturbances', () => {
    const atoms = byId([
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'V1', atomType: 'verification' }),
      atom({ atomId: 'D1', atomType: 'hypothesis' }), // external: would be actuator IF in a loop
    ]);
    const input = { atoms, causalLinks: [link('H1', 'V1'), link('V1', 'H1', '-'), link('D1', 'H1')] };
    const points = leverageFor(input);
    expect(points.find(p => p.atomId === 'H1')!.rationaleCodes).toContain('ACTUATOR_ROLE');
    expect(points.find(p => p.atomId === 'V1')!.rationaleCodes).toContain('SENSOR_ROLE');
    const disturbance = points.find(p => p.atomId === 'D1')!.rationaleCodes;
    expect(disturbance).not.toContain('ACTUATOR_ROLE');
    expect(disturbance).not.toContain('SENSOR_ROLE');
  });
});

describe('simulate', () => {
  it('a "-" edge flips direction; "+" preserves it', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' }), atom({ atomId: 'C' })]);
    const input = { atoms, causalLinks: [link('A', 'B', '-'), link('A', 'C', '+')] };
    const result = simulate(input, 'A', 'up');
    expect(result.effects).toEqual([
      { atomId: 'B', direction: 'down', provenance: 'first-order', pathLinkIds: ['cl:A>B'], strength: expect.closeTo(0.85, 5) },
      { atomId: 'C', direction: 'up', provenance: 'first-order', pathLinkIds: ['cl:A>C'], strength: expect.closeTo(0.85, 5) },
    ]);
    const down = simulate(input, 'A', 'down');
    expect(down.effects.find(e => e.atomId === 'B')!.direction).toBe('up');
  });

  it('damps strength by 0.85 × gain per hop and clamps at 1', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const high = simulate({ atoms, causalLinks: [link('A', 'B', '+', 'high')] }, 'A', 'up');
    expect(high.effects[0].strength).toBe(1); // min(1, 0.85 × 2)
    const chain = simulate({ atoms, causalLinks: [link('A', 'B'), link('B', 'C')] }, 'A', 'up');
    expect(chain.effects.find(e => e.atomId === 'C')!.strength).toBeCloseTo(0.85 * 0.85, 5);
  });

  it('drops propagation below MIN_STRENGTH 0.1', () => {
    const atoms = byId(['A', 'B', 'C', 'D'].map(id => atom({ atomId: id })));
    const links = [link('A', 'B', '+', 'low'), link('B', 'C', '+', 'low'), link('C', 'D', '+', 'low')];
    const result = simulate({ atoms, causalLinks: links }, 'A', 'up');
    // 0.425 -> 0.180625 -> 0.0768 (< 0.1, dropped)
    expect(result.effects.map(e => e.atomId)).toEqual(['B', 'C']);
  });

  it('per-linkId traversal cap <2 terminates a tight high-gain loop', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const input = { atoms, causalLinks: [link('A', 'B', '+', 'high'), link('B', 'A', '+', 'high')] };
    const result = simulate(input, 'A', 'up');
    // Source atom is never an effect, even when the loop returns to it.
    expect(result.effects.map(e => e.atomId)).toEqual(['B']);
    expect(result.effects[0].strength).toBe(1);
    expect(result.loopsTraversed).toEqual(['loop:A>B']);
    // Loop-only reach: removing feedback edges disconnects B -> emergent.
    expect(result.emergentAtomIds).toEqual(['B']);
  });

  it('ambiguity comes from per-direction reachability, not traversal racing', () => {
    const atoms = byId(['A', 'B', 'C'].map(id => atom({ atomId: id })));
    const input = { atoms, causalLinks: [link('A', 'B', '+'), link('A', 'C', '+'), link('C', 'B', '-')] };
    const result = simulate(input, 'A', 'up');
    const b = result.effects.find(e => e.atomId === 'B')!;
    expect(b.direction).toBe('ambiguous');
    expect(b.strength).toBeCloseTo(0.85, 5); // max over both directions
    expect(result.ambiguousAtomIds).toEqual(['B']);
    expect(result.effects.find(e => e.atomId === 'C')!.direction).toBe('up');
    expect(result.emergentAtomIds).toEqual([]); // no loops at all
  });

  it('acyclic witness preferred: never a canonical-ordering artifact (C2-4)', () => {
    // Loop A<->B plus chain A->C->D and shortcut B->D, all '+'. In FIFO
    // canonical order the FULL-run first witness for D rides the feedback
    // edge A->B (path A>B, B>D); the pinned semantics keep D first-order
    // with the acyclic witness A>C, C>D.
    const atoms = byId(['A', 'B', 'C', 'D'].map(id => atom({ atomId: id })));
    const input = { atoms, causalLinks: [link('A', 'B'), link('B', 'A'), link('A', 'C'), link('C', 'D'), link('B', 'D')] };
    const result = simulate(input, 'A', 'up');
    const d = result.effects.find(e => e.atomId === 'D')!;
    expect(d.direction).toBe('up');
    expect(d.provenance).toBe('first-order');
    expect(d.pathLinkIds).toEqual(['cl:A>C', 'cl:C>D']);
    // B itself is only reachable through a feedback edge -> emergent.
    expect(result.effects.find(e => e.atomId === 'B')!.provenance).toBe('emergent');
  });

  it('classifies first-order vs loop-mediated vs emergent on a loop+chain fixture', () => {
    // A -> C -> B chain; balancing loop C<->D. The loop injects a 'down'
    // direction into C and B (direction sets differ from acyclic-only ->
    // loop-mediated); D is reachable only through a feedback edge -> emergent.
    const atoms = byId(['A', 'B', 'C', 'D'].map(id => atom({ atomId: id })));
    const input = { atoms, causalLinks: [link('A', 'C'), link('C', 'B'), link('C', 'D'), link('D', 'C', '-')] };
    const result = simulate(input, 'A', 'up');
    const byAtom = Object.fromEntries(result.effects.map(e => [e.atomId, e]));
    expect(byAtom.C.direction).toBe('ambiguous');
    expect(byAtom.C.provenance).toBe('loop-mediated');
    expect(byAtom.C.pathLinkIds).toEqual(['cl:A>C']); // acyclic witness
    expect(byAtom.B.provenance).toBe('loop-mediated');
    expect(byAtom.B.pathLinkIds).toEqual(['cl:A>C', 'cl:C>B']);
    expect(byAtom.D.provenance).toBe('emergent');
    expect(result.emergentAtomIds).toEqual(['D']);
    expect(result.loopsTraversed).toEqual(['loop:C>D']);
  });

  it('is permutation-invariant over causalLinks input order (deep equal)', () => {
    const atoms = byId(['A', 'B', 'C', 'D'].map(id => atom({ atomId: id })));
    const links = [link('A', 'C'), link('C', 'B'), link('C', 'D'), link('D', 'C', '-'), link('A', 'B', '-')];
    const baseline = simulate({ atoms, causalLinks: links }, 'A', 'up');
    const permutations = [
      [...links].reverse(),
      [links[2], links[4], links[0], links[3], links[1]],
      [links[4], links[3], links[2], links[1], links[0]],
    ];
    for (const permuted of permutations) {
      expect(simulate({ atoms, causalLinks: permuted }, 'A', 'up')).toEqual(baseline);
    }
  });

  it('validates the source on the RAW atom set: missing and refuted atoms error distinctly', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'R', isRefuted: true })]);
    const input = { atoms, causalLinks: [link('A', 'R')] };
    expect(() => simulate(input, 'GHOST', 'up')).toThrow(/Atom with ID GHOST not found/);
    expect(() => simulate(input, 'R', 'up')).toThrow(/refuted atom/i);
  });

  it('duplicate (from,to) links dedupe before propagation: shared link ids never double-consume the cap', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const dup = { ...link('A', 'B', '+', 'med', 200) };
    const result = simulate({ atoms, causalLinks: [dup, link('A', 'B', '+', 'med', 100)] }, 'A', 'up');
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].strength).toBeCloseTo(0.85, 5); // one traversal, not two arrivals
  });
});

describe('analyzeSystems', () => {
  it('flags ORPHAN_CAUSAL_LINK on raw input, and not for intact links', () => {
    const atoms = byId([atom({ atomId: 'A' })]);
    const { issues } = analyzeSystems({ atoms, causalLinks: [link('A', 'GHOST')] });
    expect(issues).toEqual([expect.objectContaining({ code: 'ORPHAN_CAUSAL_LINK', atomIds: ['GHOST'] })]);
    const clean = analyzeSystems({ atoms: byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]), causalLinks: [link('A', 'B')] });
    expect(clean.issues).toEqual([]);
  });

  it('flags SELF_LOOP once per pair and DUPLICATE_CAUSAL_LINK on repeated raw pairs', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const { issues } = analyzeSystems({
      atoms,
      causalLinks: [link('A', 'A', '-'), link('A', 'B', '+', 'med', 100), link('A', 'B', '-', 'high', 200)],
    });
    expect(issues.filter(i => i.code === 'SELF_LOOP')).toEqual([expect.objectContaining({ atomIds: ['A'] })]);
    expect(issues.filter(i => i.code === 'DUPLICATE_CAUSAL_LINK')).toEqual([expect.objectContaining({ atomIds: ['A', 'B'] })]);
  });

  it('REINFORCING_COMPOUNDING_RISK requires reinforcing kind, gain >= 4, and confidence >= floor', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const risky = { atoms, causalLinks: [link('A', 'B', '+', 'high'), link('B', 'A', '+', 'high')] };
    expect(analyzeSystems(risky).issues.map(i => i.code)).toContain('REINFORCING_COMPOUNDING_RISK');
    // Confidence floor is tunable: default 0.7 passes at effConf 0.8, 0.9 does not.
    expect(analyzeSystems(risky, { compoundingConfidenceFloor: 0.9 }).issues.map(i => i.code)).not.toContain('REINFORCING_COMPOUNDING_RISK');
    // Gain 1 loop never compounds.
    const mild = { atoms, causalLinks: [link('A', 'B', '+'), link('B', 'A', '+')] };
    expect(analyzeSystems(mild).issues.map(i => i.code)).not.toContain('REINFORCING_COMPOUNDING_RISK');
  });

  it('BALANCING_LOOP_NO_SENSOR vs OPEN_LOOP_BALANCING_RISK: specific over general, never both', () => {
    const premises = byId([atom({ atomId: 'P1', atomType: 'premise' }), atom({ atomId: 'P2', atomType: 'premise' })]);
    const noSensorNoActuator = analyzeSystems({ atoms: premises, causalLinks: [link('P1', 'P2', '-'), link('P2', 'P1')] });
    expect(noSensorNoActuator.issues.map(i => i.code)).toContain('BALANCING_LOOP_NO_SENSOR');
    expect(noSensorNoActuator.issues.map(i => i.code)).not.toContain('OPEN_LOOP_BALANCING_RISK');

    const withActuator = byId([atom({ atomId: 'P1', atomType: 'premise' }), atom({ atomId: 'H1', atomType: 'hypothesis' })]);
    const openLoop = analyzeSystems({ atoms: withActuator, causalLinks: [link('P1', 'H1', '-'), link('H1', 'P1')] });
    expect(openLoop.issues.map(i => i.code)).toContain('OPEN_LOOP_BALANCING_RISK');
    expect(openLoop.issues.map(i => i.code)).not.toContain('BALANCING_LOOP_NO_SENSOR');

    // Sensor present: neither fires.
    const sensed = byId([atom({ atomId: 'V1', atomType: 'verification' }), atom({ atomId: 'H1', atomType: 'hypothesis' })]);
    const closed = analyzeSystems({ atoms: sensed, causalLinks: [link('V1', 'H1', '-'), link('H1', 'V1')] });
    expect(closed.issues.map(i => i.code)).not.toContain('OPEN_LOOP_BALANCING_RISK');
    expect(closed.issues.map(i => i.code)).not.toContain('BALANCING_LOOP_NO_SENSOR');
  });

  it('LOOP_CONTRADICTS_CONCLUSION: actuator simulation drives a verified conclusion exactly down', () => {
    const atoms = byId([
      atom({ atomId: 'A', atomType: 'premise' }),
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'C1', atomType: 'conclusion', isVerified: true }),
    ]);
    const causalLinks = [link('A', 'H1'), link('H1', 'A'), link('H1', 'C1', '-')];
    const { issues } = analyzeSystems({ atoms, causalLinks });
    const hits = issues.filter(i => i.code === 'LOOP_CONTRADICTS_CONCLUSION');
    expect(hits).toEqual([expect.objectContaining({ atomIds: ['C1'], loopIds: ['loop:A>H1'] })]); // deduped per (loop, conclusion)

    // Unverified conclusion: no contradiction.
    const unverified = byId([
      atom({ atomId: 'A', atomType: 'premise' }),
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'C1', atomType: 'conclusion' }),
    ]);
    expect(analyzeSystems({ atoms: unverified, causalLinks }).issues.map(i => i.code)).not.toContain('LOOP_CONTRADICTS_CONCLUSION');
  });

  it('ambiguous arrival at a verified conclusion never fires the contradiction', () => {
    // Balancing 2-loop containing the conclusion: reentry makes C1 ambiguous.
    const atoms = byId([
      atom({ atomId: 'H1', atomType: 'hypothesis' }),
      atom({ atomId: 'C1', atomType: 'conclusion', isVerified: true }),
    ]);
    const { issues } = analyzeSystems({ atoms, causalLinks: [link('H1', 'C1', '-'), link('C1', 'H1')] });
    expect(issues.map(i => i.code)).not.toContain('LOOP_CONTRADICTS_CONCLUSION');
  });

  it('propagates truncation as LOOP_ENUMERATION_TRUNCATED and in the truncated field', () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const atoms = byId(ids.map(id => atom({ atomId: id, atomType: 'premise' })));
    const links: CausalLink[] = [];
    for (const from of ids) for (const to of ids) if (from !== to) links.push(link(from, to));
    const analysis = analyzeSystems({ atoms, causalLinks: links });
    expect(analysis.truncated).toBe(true);
    expect(analysis.issues.map(i => i.code)).toContain('LOOP_ENUMERATION_TRUNCATED');
  });

  it('sorts issues by code asc, then loopIds, then atomIds', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const { issues } = analyzeSystems({
      atoms,
      causalLinks: [link('A', 'A'), link('A', 'GHOST'), link('B', 'B', '-')],
    });
    const codes = issues.map(i => i.code);
    expect(codes).toEqual([...codes].sort());
    const selfLoops = issues.filter(i => i.code === 'SELF_LOOP');
    expect(selfLoops.map(i => i.atomIds[0])).toEqual(['A', 'B']);
  });

  it('returns loops, controlLoops, and leveragePoints alongside issues', () => {
    const atoms = byId([atom({ atomId: 'A' }), atom({ atomId: 'B' })]);
    const analysis = analyzeSystems({ atoms, causalLinks: [link('A', 'B'), link('B', 'A')] });
    expect(analysis.loops).toHaveLength(1);
    expect(analysis.controlLoops).toHaveLength(1);
    expect(analysis.leveragePoints.map(p => p.atomId)).toEqual(['A', 'B']);
    expect(analysis.truncated).toBe(false);
  });
});
