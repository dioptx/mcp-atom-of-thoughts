import { describe, expect, it } from 'vitest';
import {
  GAIN_NUMERIC,
  MAX_LOOP_COUNT,
  MAX_LOOP_LENGTH,
  activeCausalGraph,
  analyzeControlLoops,
  analyzeLoops,
  buildAdjacency,
  classifyLoopKind,
  computeLoopGain,
  dedupeCausalLinks,
  enumerateLoops,
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
