/**
 * Unit tests for src/sgt-epistemics.ts: the shared read-only epistemic
 * predicates behind `aot sgt expand|advise|judge` (round 2), plus the
 * provenance-ref helpers they consume from the bridge. Pure functions — no
 * CLI build, no subprocess, no state file.
 */

import { describe, expect, it } from 'vitest';
import {
  SUPERSEDED_PREFIX,
  packEvidenceRefs,
  packHeadingKey,
  sgtIds,
} from '../src/sgt-bridge.js';
import {
  EXPAND_ADVISE_MIN_CONFIDENCE,
  EXPAND_SCAFFOLD_CONFIDENCE,
  activeSgtHypotheses,
  adviseCandidates,
  advisePendingIssues,
  expandRefusal,
  hasExpandScaffold,
  isExpandable,
  isSettled,
  isSgtHypothesis,
  isSuperseded,
  parseSgtAtomId,
  refutedSlugs,
  resolveSgtHypothesis,
} from '../src/sgt-epistemics.js';
import type { AtomData, SkillRef } from '../src/types.js';

const NS = 'sgt:q12345678:';
const NS2 = 'sgt:qabcdef01:';

function atom(partial: Partial<AtomData> & { atomId: string }): AtomData {
  return {
    content: 'content',
    atomType: 'hypothesis',
    dependencies: [],
    confidence: 0.7,
    created: 1,
    isVerified: false,
    ...partial,
  };
}

function hypothesis(namespace: string, slug: string, partial: Partial<AtomData> = {}, skillRef: Partial<SkillRef> = {}): AtomData {
  return atom({
    atomId: `${namespace}h:${slug}`,
    atomType: 'hypothesis',
    content: `skill ${slug} is relevant to: q`,
    skillRef: { slug, source: 'sgt', ...skillRef },
    ...partial,
  });
}

function toRecord(...atoms: AtomData[]): Record<string, AtomData> {
  return Object.fromEntries(atoms.map(a => [a.atomId, a]));
}

describe('pinned constants', () => {
  it('EXPAND_ADVISE_MIN_CONFIDENCE is 0.65 and EXPAND_SCAFFOLD_CONFIDENCE is 0.70', () => {
    expect(EXPAND_ADVISE_MIN_CONFIDENCE).toBe(0.65);
    expect(EXPAND_SCAFFOLD_CONFIDENCE).toBe(0.70);
  });
});

describe('predicate truth table', () => {
  it('isSuperseded holds iff content starts with the SUPERSEDED_PREFIX imported from sgt-bridge', () => {
    expect(isSuperseded(atom({ atomId: 'x', content: `${SUPERSEDED_PREFIX}old` }))).toBe(true);
    expect(isSuperseded(atom({ atomId: 'x', content: 'old' }))).toBe(false);
    // Prefix must appear at position 0, not merely anywhere.
    expect(isSuperseded(atom({ atomId: 'x', content: `note ${SUPERSEDED_PREFIX}old` }))).toBe(false);
  });

  it('isSettled = isVerified || isRefuted', () => {
    expect(isSettled(atom({ atomId: 'x' }))).toBe(false);
    expect(isSettled(atom({ atomId: 'x', isVerified: true }))).toBe(true);
    expect(isSettled(atom({ atomId: 'x', isRefuted: true }))).toBe(true);
  });

  it('isSgtHypothesis needs type hypothesis + skillRef + sgt id shape', () => {
    expect(isSgtHypothesis(hypothesis(NS, 'a-skill'))).toBe(true);
    expect(isSgtHypothesis(atom({ atomId: `${NS}h:a-skill` }))).toBe(false); // no skillRef
    expect(isSgtHypothesis(atom({ atomId: 'H1', skillRef: { slug: 'a-skill', source: 'sgt' } }))).toBe(false); // plain id
    expect(isSgtHypothesis(hypothesis(NS, 'a-skill', { atomType: 'premise' }))).toBe(false);
  });

  it('expandRefusal precedence: refuted > verified > superseded, else undefined', () => {
    expect(expandRefusal(hypothesis(NS, 's'))).toBeUndefined();
    expect(expandRefusal(hypothesis(NS, 's', { isRefuted: true }))).toBe('refuted');
    expect(expandRefusal(hypothesis(NS, 's', { isVerified: true }))).toBe('verified');
    expect(expandRefusal(hypothesis(NS, 's', { content: `${SUPERSEDED_PREFIX}x` }))).toBe('superseded');
    // Precedence when several apply at once.
    expect(expandRefusal(hypothesis(NS, 's', { isRefuted: true, isVerified: true, content: `${SUPERSEDED_PREFIX}x` }))).toBe('refuted');
    expect(expandRefusal(hypothesis(NS, 's', { isVerified: true, content: `${SUPERSEDED_PREFIX}x` }))).toBe('verified');
    expect(isExpandable(hypothesis(NS, 's'))).toBe(true);
    expect(isExpandable(hypothesis(NS, 's', { isRefuted: true }))).toBe(false);
  });

  it('hasExpandScaffold finds the e:{slug} atom regardless of its state', () => {
    const scaffold = atom({ atomId: sgtIds.expand(NS, 's'), atomType: 'verification' });
    const atoms = toRecord(hypothesis(NS, 's'), scaffold);
    expect(hasExpandScaffold(atoms, NS, 's')).toBe(scaffold);
    expect(hasExpandScaffold(atoms, NS, 'other')).toBeUndefined();
  });
});

describe('parseSgtAtomId round-trips', () => {
  it('parses all five kinds, including long slugs with --', () => {
    expect(parseSgtAtomId(`${NS}p`)).toEqual({ namespace: NS, kind: 'p' });
    expect(parseSgtAtomId(`${NS}r:domain`)).toEqual({ namespace: NS, kind: 'r', slug: 'domain' });
    expect(parseSgtAtomId(`${NS}h:kubernetes-deployment-creator--claude-specific--5eda8a52`))
      .toEqual({ namespace: NS, kind: 'h', slug: 'kubernetes-deployment-creator--claude-specific--5eda8a52' });
    expect(parseSgtAtomId('sgt:q12345678:e:a--b--c')).toEqual({ namespace: NS, kind: 'e', slug: 'a--b--c' });
    expect(parseSgtAtomId(`${NS}j:a--b--c:refutes`)).toEqual({ namespace: NS, kind: 'j', slug: 'a--b--c', polarity: 'refutes' });
    expect(parseSgtAtomId(`${NS}j:x:supports`)).toEqual({ namespace: NS, kind: 'j', slug: 'x', polarity: 'supports' });
  });

  it('round-trips ids built by sgtIds', () => {
    expect(parseSgtAtomId(sgtIds.premise(NS))!.kind).toBe('p');
    expect(parseSgtAtomId(sgtIds.reasoning(NS, 'capability'))).toMatchObject({ kind: 'r', slug: 'capability' });
    expect(parseSgtAtomId(sgtIds.hypothesis(NS, 's'))).toMatchObject({ kind: 'h', slug: 's' });
    expect(parseSgtAtomId(sgtIds.expand(NS, 's'))).toMatchObject({ kind: 'e', slug: 's' });
    expect(parseSgtAtomId(sgtIds.judge(NS, 's', 'supports'))).toMatchObject({ kind: 'j', slug: 's', polarity: 'supports' });
  });

  it('rejects non-sgt ids, short hashes, and bad polarities', () => {
    expect(parseSgtAtomId('P1')).toBeUndefined();
    expect(parseSgtAtomId('sgt:q1234:h:x')).toBeUndefined();
    expect(parseSgtAtomId(`${NS}x:oops`)).toBeUndefined();
    expect(parseSgtAtomId(`${NS}j:slug:maybe`)).toBeUndefined();
    expect(parseSgtAtomId(`${NS}j:supports`)).toBeUndefined(); // no slug segment
  });
});

describe('packHeadingKey / packEvidenceRefs provenance grammar', () => {
  it("normalizes 'Trigger & When' -> 'trigger-when' (NFC lowercase, [^a-z0-9]+ -> '-', trimmed)", () => {
    expect(packHeadingKey('Trigger & When')).toBe('trigger-when');
    expect(packHeadingKey('  Usage  ')).toBe('usage');
    expect(packHeadingKey('Example 1: Deploying a Web Application')).toBe('example-1-deploying-a-web-application');
  });

  it('caps the key at 48 chars with no trailing dash', () => {
    const key = packHeadingKey('a'.repeat(40) + ' and then some very long tail heading');
    expect(key.length).toBeLessThanOrEqual(48);
    expect(key.endsWith('-')).toBe(false);
  });

  it('symbol-only headings fall back to x + 8 hex sha256 chars', () => {
    const key = packHeadingKey('###');
    expect(key).toMatch(/^x[0-9a-f]{8}$/);
    expect(packHeadingKey('###')).toBe(key); // deterministic
    expect(packHeadingKey('%%%')).not.toBe(key); // hash of the heading itself
  });

  it('emits excerpt refs (array index) then reference refs (kind + basename), in pack order', () => {
    const refs = packEvidenceRefs('k8s-manifest-generator', {
      skill: { slug: 'k8s-manifest-generator' },
      excerpts: [
        { heading: 'Trigger & When', score: 12, excerpt: 'x' },
        { heading: 'Usage', excerpt: 'y' },
      ],
      references: [
        { kind: 'references', path: 'store/k8s-manifest-generator/references/SKILL.md', bytes: 4321 },
        { kind: 'scripts', path: 'store/k8s-manifest-generator/scripts/render.sh' },
      ],
    });
    expect(refs).toEqual([
      'sgt:packet:k8s-manifest-generator:trigger-when:0',
      'sgt:packet:k8s-manifest-generator:usage:1',
      'sgt:ref:k8s-manifest-generator:references:SKILL.md',
      'sgt:ref:k8s-manifest-generator:scripts:render.sh',
    ]);
  });
});

describe('refutedSlugs derives from LIVE hypothesis state (I3)', () => {
  it('includes slugs of currently-refuted hypotheses from any namespace', () => {
    const atoms = toRecord(
      hypothesis(NS, 'noise-skill', { isRefuted: true }),
      hypothesis(NS2, 'other-skill'),
    );
    expect(refutedSlugs(atoms)).toEqual(new Set(['noise-skill']));
  });

  it('ignores j:*:refutes atom presence when the hypothesis itself is no longer refuted', () => {
    // A later `judge --supports` cleared isRefuted (verifyAtom escape hatch);
    // the preserved refutes sibling must NOT keep the slug excluded.
    const atoms = toRecord(
      hypothesis(NS, 'recovered-skill', { isVerified: true }),
      atom({ atomId: sgtIds.judge(NS, 'recovered-skill', 'refutes'), atomType: 'verification', polarity: 'refutes', isVerified: true }),
    );
    expect(refutedSlugs(atoms).has('recovered-skill')).toBe(false);
  });
});

describe('activeSgtHypotheses', () => {
  it('excludes superseded, settled, and refuted-slug hypotheses; sorts by atomId asc', () => {
    const atoms = toRecord(
      hypothesis(NS, 'zulu-skill'),
      hypothesis(NS, 'alpha-skill'),
      hypothesis(NS, 'settled-skill', { isVerified: true }),
      hypothesis(NS, 'gone-skill', { content: `${SUPERSEDED_PREFIX}skill gone-skill` }),
      hypothesis(NS, 'noise-skill', { isRefuted: true }),
      // Same slug refuted in NS -> excluded here too, even though this one is active.
      hypothesis(NS2, 'noise-skill'),
    );
    expect(activeSgtHypotheses(atoms).map(a => a.atomId)).toEqual([
      `${NS}h:alpha-skill`,
      `${NS}h:zulu-skill`,
    ]);
  });
});

describe('resolveSgtHypothesis (single resolver shared by judge and expand)', () => {
  const atoms = toRecord(
    atom({ atomId: `${NS}p`, atomType: 'premise', content: 'q' }),
    hypothesis(NS, 'shared-skill'),
    hypothesis(NS2, 'shared-skill'),
    hypothesis(NS, 'unique-skill'),
  );

  function codeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code ?? 'NO_CODE';
    }
    return 'NO_THROW';
  }

  it('resolves a full atom id directly', () => {
    expect(resolveSgtHypothesis(atoms, `${NS2}h:shared-skill`, 'default').atomId).toBe(`${NS2}h:shared-skill`);
  });

  it('resolves an unambiguous bare slug', () => {
    expect(resolveSgtHypothesis(atoms, 'unique-skill', 'default').atomId).toBe(`${NS}h:unique-skill`);
  });

  it('SGT_AMBIGUOUS_SLUG lists every candidate full id', () => {
    expect(codeOf(() => resolveSgtHypothesis(atoms, 'shared-skill', 'default'))).toBe('SGT_AMBIGUOUS_SLUG');
    expect(() => resolveSgtHypothesis(atoms, 'shared-skill', 'default'))
      .toThrowError(new RegExp(`${NS}h:shared-skill.*${NS2}h:shared-skill`));
  });

  it('SGT_NOT_HYPOTHESIS for non-hypothesis targets, SGT_HYPOTHESIS_NOT_FOUND for unknowns', () => {
    expect(codeOf(() => resolveSgtHypothesis(atoms, `${NS}p`, 'default'))).toBe('SGT_NOT_HYPOTHESIS');
    expect(codeOf(() => resolveSgtHypothesis(atoms, 'no-such-skill', 'default'))).toBe('SGT_HYPOTHESIS_NOT_FOUND');
  });
});

describe('adviseCandidates tier assignment and total order', () => {
  const premise = atom({ atomId: `${NS}p`, atomType: 'premise', content: 'deploy kubernetes service' });

  it('assigns tiers 1-4 with one action per hypothesis, lowest tier wins', () => {
    const atoms = toRecord(
      premise,
      // Qualifies for tier 1 AND tier 4 (missing tokens, no coverage): tier 1 wins.
      hypothesis(NS, 'alpha-skill', { confidence: 0.70 }, { missingTokens: ['helm', 'chart'] }),
      // Tier 2: live scaffold, unsettled.
      hypothesis(NS, 'beta-skill', { confidence: 0.66 }),
      atom({ atomId: sgtIds.expand(NS, 'beta-skill'), atomType: 'verification', content: 'sgt expand: beta-skill (2 excerpts, budget 1200)', confidence: 0.70 }),
      // Tier 3: verified.
      hypothesis(NS, 'gamma-skill', { confidence: 0.80, isVerified: true }),
      // Tier 4 only: below the expand gate, missing tokens, no coverage.
      hypothesis(NS, 'delta-skill', { confidence: 0.60 }, { missingTokens: ['helm', 'chart'] }),
      // Nowhere: below gate, no missing tokens.
      hypothesis(NS, 'epsilon-skill', { confidence: 0.60 }),
      // Excluded everywhere: refuted / superseded.
      hypothesis(NS, 'noise-skill', { isRefuted: true }),
      hypothesis(NS, 'gone-skill', { content: `${SUPERSEDED_PREFIX}skill gone-skill` }),
    );
    const candidates = adviseCandidates(atoms);
    expect(candidates.map(c => [c.tier, c.action, c.slug])).toEqual([
      [1, 'expand', 'alpha-skill'],
      [2, 'judge', 'beta-skill'],
      [3, 'related', 'gamma-skill'],
      [4, 'refine', 'delta-skill'],
    ]);
    const [expand, judge, related, refine] = candidates;
    expect(expand.command).toBe(`aot sgt expand ${NS}h:alpha-skill --budget 1200`);
    expect(expand.score).toBe(0.70);
    // Machine-actionable judge command: no '--supports|--refutes' alternation
    // in the command itself; polarity choices ride in argChoices.
    expect(judge.command).toBe(`aot sgt judge ${NS}h:beta-skill`);
    expect(judge.command).not.toContain('|');
    expect(judge.argChoices).toEqual(['--supports', '--refutes']);
    expect(judge.score).toBe(0.66);
    expect(related.command).toBe('sgt graph related gamma-skill');
    expect(related.score).toBe(0.68); // round4(0.80 * 0.85)
    expect(refine.command).toBe('aot sgt route "deploy kubernetes service helm chart"');
    expect(refine.score).toBe(0.66); // round4(0.50 + 0.08 * min(2, 6))
  });

  it('confidence gate: 0.60 unexpanded hypothesis is never suggested for expand', () => {
    const atoms = toRecord(premise, hypothesis(NS, 'weak-skill', { confidence: 0.60 }));
    expect(adviseCandidates(atoms)).toEqual([]);
    const atGate = toRecord(premise, hypothesis(NS, 'edge-skill', { confidence: 0.65 }));
    expect(adviseCandidates(atGate).map(c => c.action)).toEqual(['expand']);
  });

  it('tier 4 requires coverage undefined or < 0.30', () => {
    const low = toRecord(premise, hypothesis(NS, 's1-skill', { confidence: 0.60 }, { coverage: 0.29, missingTokens: ['a'] }));
    expect(adviseCandidates(low).map(c => c.action)).toEqual(['refine']);
    expect(adviseCandidates(low)[0].score).toBe(0.58); // round4(0.50 + 0.08 * 1)
    const high = toRecord(premise, hypothesis(NS, 's2-skill', { confidence: 0.60 }, { coverage: 0.30, missingTokens: ['a'] }));
    expect(adviseCandidates(high)).toEqual([]);
  });

  it('tier 4 score caps the token count at 6', () => {
    const tokens = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const atoms = toRecord(premise, hypothesis(NS, 'many-skill', { confidence: 0.60 }, { missingTokens: tokens }));
    expect(adviseCandidates(atoms)[0].score).toBe(0.98); // round4(0.50 + 0.08 * 6)
  });

  it('a superseded scaffold is inactive: the hypothesis falls back to tier 1', () => {
    const atoms = toRecord(
      premise,
      hypothesis(NS, 'redo-skill', { confidence: 0.70 }),
      atom({ atomId: sgtIds.expand(NS, 'redo-skill'), atomType: 'verification', content: `${SUPERSEDED_PREFIX}sgt expand: redo-skill (2 excerpts, budget 1200)` }),
    );
    expect(adviseCandidates(atoms).map(c => c.action)).toEqual(['expand']);
  });

  it('total order: tier asc, score desc, atomId asc', () => {
    const atoms = toRecord(
      premise,
      hypothesis(NS, 'mid-skill', { confidence: 0.66 }),
      hypothesis(NS, 'zzz-skill', { confidence: 0.70 }),
      hypothesis(NS, 'aaa-skill', { confidence: 0.70 }),
      hypothesis(NS, 'related-skill', { confidence: 0.90, isVerified: true }),
    );
    expect(adviseCandidates(atoms).map(c => c.slug)).toEqual([
      'aaa-skill', // tier 1, 0.70, atomId asc beats zzz
      'zzz-skill', // tier 1, 0.70
      'mid-skill', // tier 1, 0.66
      'related-skill', // tier 3 last despite highest raw confidence
    ]);
  });

  it('is deterministic regardless of atom insertion order', () => {
    const a = toRecord(premise, hypothesis(NS, 'a-skill', { confidence: 0.7 }), hypothesis(NS, 'b-skill', { confidence: 0.7 }));
    const b = toRecord(hypothesis(NS, 'b-skill', { confidence: 0.7 }), hypothesis(NS, 'a-skill', { confidence: 0.7 }), premise);
    expect(JSON.stringify(adviseCandidates(a))).toBe(JSON.stringify(adviseCandidates(b)));
  });
});

describe('advisePendingIssues (round 3 informational analyze lint)', () => {
  const premise = atom({ atomId: `${NS}p`, atomType: 'premise', content: 'deploy kubernetes service' });

  it('emits exactly {code, atomIds, message} — no severity, no notes (analyze issues contract unchanged)', () => {
    const atoms = toRecord(premise, hypothesis(NS, 'alpha-skill', { confidence: 0.70 }));
    const issues = advisePendingIssues(atoms);
    expect(issues).toEqual([{
      code: 'advise_pending',
      atomIds: [`${NS}h:alpha-skill`],
      message: `Skill hypothesis ${NS}h:alpha-skill (alpha-skill) awaits expand`,
    }]);
    expect(Object.keys(issues[0])).toEqual(['code', 'atomIds', 'message']);
  });

  it('mirrors adviseCandidates tiers 1-2 only: tier-2 says "awaits judge"; tier-3/4 candidates produce no issue', () => {
    const atoms = toRecord(
      premise,
      hypothesis(NS, 'expand-me-skill', { confidence: 0.70 }), // tier 1
      hypothesis(NS, 'judge-me-skill', { confidence: 0.66 }), // tier 2 via live scaffold
      atom({ atomId: sgtIds.expand(NS, 'judge-me-skill'), atomType: 'verification', content: 'sgt expand: judge-me-skill (2 excerpts, budget 1200)', dependencies: [`${NS}h:judge-me-skill`] }),
      hypothesis(NS, 'related-skill', { confidence: 0.90, isVerified: true }), // tier 3
      hypothesis(NS, 'refine-skill', { confidence: 0.60 }, { missingTokens: ['helm'] }), // tier 4
    );
    const issues = advisePendingIssues(atoms);
    expect(issues.map(issue => issue.atomIds[0])).toEqual([
      `${NS}h:expand-me-skill`,
      `${NS}h:judge-me-skill`,
    ]);
    expect(issues[0].message).toContain('awaits expand');
    expect(issues[1].message).toContain('awaits judge');
  });

  it('sorted atomId asc regardless of candidate ranking (which is tier/score ordered)', () => {
    const atoms = toRecord(
      premise,
      hypothesis(NS, 'zzz-skill', { confidence: 0.90 }), // higher score, later atomId
      hypothesis(NS, 'aaa-skill', { confidence: 0.66 }),
    );
    expect(advisePendingIssues(atoms).map(issue => issue.atomIds[0])).toEqual([
      `${NS}h:aaa-skill`,
      `${NS}h:zzz-skill`,
    ]);
  });

  it('no issue for sub-gate, settled, superseded, or refuted-slug hypotheses; empty session yields []', () => {
    expect(advisePendingIssues({})).toEqual([]);
    const atoms = toRecord(
      premise,
      hypothesis(NS, 'weak-skill', { confidence: 0.60 }), // below EXPAND_ADVISE_MIN_CONFIDENCE, no tokens
      hypothesis(NS, 'settled-skill', { confidence: 0.80, isVerified: true }),
      hypothesis(NS, 'refuted-skill', { confidence: 0.80, isRefuted: true }),
      hypothesis(NS, 'dropped-skill', { confidence: 0.80, content: `${SUPERSEDED_PREFIX}skill dropped-skill is relevant to: q` }),
    );
    expect(advisePendingIssues(atoms)).toEqual([]);
  });
});
