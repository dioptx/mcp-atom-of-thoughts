/**
 * sgt epistemics: shared READ-ONLY predicates over the atoms materialized by
 * the sgt bridge (`aot sgt route|expand|judge`). One source of truth for
 * "what is active / settled / refuted / disclosed" so expand, advise, and
 * judge can never fork their epistemic definitions.
 *
 * Pure functions only — no server access, no state mutation, no subprocess.
 */

import { Errors } from 'incur';
import { SGT_HYPOTHESIS_ID_RE, SUPERSEDED_PREFIX, sgtIds } from './sgt-bridge.js';
import type { AtomData } from './types.js';

/**
 * Minimum hypothesis confidence for advise to suggest an expand (tier 1).
 * Below this, disclosure is not worth the context budget; the hypothesis can
 * still surface via tier 4 (refine) when it carries missing tokens.
 */
export const EXPAND_ADVISE_MIN_CONFIDENCE = 0.65;

/** Fixed confidence of the pending e:{slug} disclosure scaffold (spec §2c). */
export const EXPAND_SCAFFOLD_CONFIDENCE = 0.70;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Atom-id parsing
// ---------------------------------------------------------------------------

export type SgtAtomKind = 'p' | 'r' | 'h' | 'e' | 'j';

export interface ParsedSgtAtomId {
  /** `sgt:q{hash}:` including the trailing colon. */
  namespace: string;
  kind: SgtAtomKind;
  /** Slug for h/e/j atoms; the axis name for r atoms. */
  slug?: string;
  /** j atoms only. */
  polarity?: 'supports' | 'refutes';
}

const SGT_ATOM_ID_RE = /^(sgt:q[0-9a-f]{8}:)(p|[rhej]:.+)$/;

export function parseSgtAtomId(atomId: string): ParsedSgtAtomId | undefined {
  const match = SGT_ATOM_ID_RE.exec(atomId);
  if (!match) return undefined;
  const [, namespace, rest] = match;
  if (rest === 'p') return { namespace, kind: 'p' };
  const kind = rest[0] as SgtAtomKind;
  const payload = rest.slice(2);
  if (kind !== 'j') return { namespace, kind, slug: payload };
  // j:{slug}:{polarity} — the polarity is always the LAST segment; slugs may
  // contain '--' but never ':'.
  const separator = payload.lastIndexOf(':');
  if (separator <= 0) return undefined;
  const polarity = payload.slice(separator + 1);
  if (polarity !== 'supports' && polarity !== 'refutes') return undefined;
  return { namespace, kind, slug: payload.slice(0, separator), polarity };
}

// ---------------------------------------------------------------------------
// Epistemic predicates
// ---------------------------------------------------------------------------

/** True when a re-route dropped the atom (round-1 supersede contract). */
export function isSuperseded(atom: AtomData): boolean {
  return atom.content.startsWith(SUPERSEDED_PREFIX);
}

/** Settled = judged: verified or refuted. Settled questions cost no context. */
export function isSettled(atom: AtomData): boolean {
  return atom.isVerified || atom.isRefuted === true;
}

/** Matches skill hypotheses materialized by `aot sgt route`. */
export function isSgtHypothesis(atom: AtomData): boolean {
  return atom.atomType === 'hypothesis' && atom.skillRef !== undefined && SGT_HYPOTHESIS_ID_RE.test(atom.atomId);
}

export type ExpandRefusalReason = 'refuted' | 'verified' | 'superseded';

/**
 * Why `aot sgt expand` must refuse this hypothesis, or undefined when it is
 * expandable. Precedence is pinned: refuted > verified > superseded — a judge
 * verdict outranks retrieval bookkeeping.
 */
export function expandRefusal(hypothesis: AtomData): ExpandRefusalReason | undefined {
  if (hypothesis.isRefuted) return 'refuted';
  if (hypothesis.isVerified) return 'verified';
  if (isSuperseded(hypothesis)) return 'superseded';
  return undefined;
}

export function isExpandable(hypothesis: AtomData): boolean {
  return expandRefusal(hypothesis) === undefined;
}

/** The e:{slug} disclosure scaffold for a hypothesis, if one exists at all. */
export function hasExpandScaffold(atoms: Record<string, AtomData>, namespace: string, slug: string): AtomData | undefined {
  return atoms[sgtIds.expand(namespace, slug)];
}

/**
 * Slugs excluded by I3, derived from LIVE hypothesis state: the slug of any
 * sgt hypothesis (any namespace) currently marked isRefuted. NOT derived from
 * mere j:*:refutes atom presence — verifyAtom clears isRefuted when a later
 * `judge --supports` verifies the hypothesis, and that recovery must make the
 * slug eligible again. Exclusion still survives re-routes because judged
 * hypotheses are preserved (round-1 epistemic protection).
 */
export function refutedSlugs(atoms: Record<string, AtomData>): Set<string> {
  const slugs = new Set<string>();
  for (const atom of Object.values(atoms)) {
    if (isSgtHypothesis(atom) && atom.isRefuted) slugs.add(atom.skillRef!.slug);
  }
  return slugs;
}

/**
 * Hypotheses still in play: not superseded, not settled, slug not refuted
 * anywhere in the session. Sorted by atomId ascending for determinism.
 */
export function activeSgtHypotheses(atoms: Record<string, AtomData>): AtomData[] {
  const refuted = refutedSlugs(atoms);
  return Object.values(atoms)
    .filter(isSgtHypothesis)
    .filter(atom => !isSuperseded(atom) && !isSettled(atom) && !refuted.has(atom.skillRef!.slug))
    .sort((a, b) => (a.atomId < b.atomId ? -1 : a.atomId > b.atomId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Hypothesis resolution (atomId | bare slug) — lifted from `aot sgt judge`;
// judge and expand share this single resolver and error taxonomy.
// ---------------------------------------------------------------------------

export function resolveSgtHypothesis(atoms: Record<string, AtomData>, target: string, sessionId: string): AtomData {
  const direct: AtomData | undefined = atoms[target];
  if (direct) {
    if (direct.atomType !== 'hypothesis' || !direct.skillRef || !SGT_HYPOTHESIS_ID_RE.test(direct.atomId)) {
      throw new Errors.IncurError({
        code: 'SGT_NOT_HYPOTHESIS',
        message: `${target} is not an sgt skill hypothesis (need an sgt:q{hash}:h:{slug} hypothesis atom with skillRef)`,
        hint: 'Create skill hypotheses with `aot sgt route` first.',
      });
    }
    return direct;
  }
  const candidates = Object.values(atoms).filter(atom =>
    atom.atomType === 'hypothesis' && atom.skillRef?.slug === target && SGT_HYPOTHESIS_ID_RE.test(atom.atomId));
  if (candidates.length === 0) {
    throw new Errors.IncurError({
      code: 'SGT_HYPOTHESIS_NOT_FOUND',
      message: `No sgt skill hypothesis matches "${target}" in session ${sessionId}`,
      hint: 'Run `aot sgt route` first, or pass a full sgt:q{hash}:h:{slug} atom ID.',
    });
  }
  if (candidates.length > 1) {
    throw new Errors.IncurError({
      code: 'SGT_AMBIGUOUS_SLUG',
      message: `Slug "${target}" matches multiple hypotheses: ${candidates.map(c => c.atomId).join(', ')}`,
      hint: 'Pass the full atom ID to pick one.',
    });
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Advise candidates (metacognition, spec §2c tier table)
// ---------------------------------------------------------------------------

export type AdviseAction = 'expand' | 'judge' | 'related' | 'refine';

export interface AdviseCandidate {
  tier: 1 | 2 | 3 | 4;
  action: AdviseAction;
  /** Directly executable — never carries a `--a|--b` alternation. */
  command: string;
  /** Present when the command additionally needs exactly one of these flags. */
  argChoices?: string[];
  why: string;
  atomId: string;
  slug: string;
  score: number;
}

function stripSupersededPrefix(content: string): string {
  return content.startsWith(SUPERSEDED_PREFIX) ? content.slice(SUPERSEDED_PREFIX.length) : content;
}

/**
 * Ranked next actions derived purely from session atoms — zero subprocess
 * (works with no sgt binary at all; spec I1).
 *
 * Tier assignment is exclusive: one action per hypothesis atom, LOWEST tier
 * wins (pinned in spec §2c).
 *   1 expand  — active, no live scaffold, confidence >= EXPAND_ADVISE_MIN_CONFIDENCE
 *   2 judge   — active, live scaffold awaiting a verdict
 *   3 related — verified hypotheses (lateral moves in the skill graph)
 *   4 refine  — active, missing tokens, coverage undefined or < 0.30
 * Excluded from EVERY tier: superseded hypotheses and any slug in
 * refutedSlugs (I3, live state).
 *
 * Total order: tier asc, score desc, atomId asc — byte-stable output.
 */
export function adviseCandidates(atoms: Record<string, AtomData>): AdviseCandidate[] {
  const refuted = refutedSlugs(atoms);
  const candidates: AdviseCandidate[] = [];

  for (const atom of Object.values(atoms)) {
    if (!isSgtHypothesis(atom)) continue;
    const slug = atom.skillRef!.slug;
    if (refuted.has(slug) || isSuperseded(atom)) continue;
    const parsed = parseSgtAtomId(atom.atomId);
    if (!parsed) continue;
    const { namespace } = parsed;

    if (atom.isVerified) {
      candidates.push({
        tier: 3,
        action: 'related',
        command: `sgt graph related ${slug}`,
        why: `skill ${slug} is verified useful; explore lateral neighbors in the skill graph`,
        atomId: atom.atomId,
        slug,
        score: round4(atom.confidence * 0.85),
      });
      continue;
    }

    // Unsettled, active hypothesis from here on.
    const scaffold = hasExpandScaffold(atoms, namespace, slug);
    const scaffoldLive = scaffold !== undefined && !isSuperseded(scaffold);
    if (scaffoldLive) {
      candidates.push({
        tier: 2,
        action: 'judge',
        command: `aot sgt judge ${atom.atomId}`,
        argChoices: ['--supports', '--refutes'],
        why: `disclosure scaffold ${scaffold.atomId} awaits a verdict; judge the disclosed excerpts`,
        atomId: atom.atomId,
        slug,
        score: atom.confidence,
      });
      continue;
    }
    if (atom.confidence >= EXPAND_ADVISE_MIN_CONFIDENCE) {
      candidates.push({
        tier: 1,
        action: 'expand',
        command: `aot sgt expand ${atom.atomId} --budget 1200`,
        why: `unexpanded high-confidence hypothesis (confidence ${atom.confidence}); disclose budgeted excerpts before judging`,
        atomId: atom.atomId,
        slug,
        score: atom.confidence,
      });
      continue;
    }
    const missingTokens = atom.skillRef!.missingTokens ?? [];
    const coverage = atom.skillRef!.coverage;
    if (missingTokens.length > 0 && (coverage === undefined || coverage < 0.30)) {
      const premise = atoms[sgtIds.premise(namespace)];
      const query = premise ? stripSupersededPrefix(premise.content) : slug;
      candidates.push({
        tier: 4,
        action: 'refine',
        command: `aot sgt route "${query} ${missingTokens.join(' ')}"`,
        why: `low coverage with missing tokens [${missingTokens.join(', ')}]; refine the route query`,
        atomId: atom.atomId,
        slug,
        score: round4(0.50 + 0.08 * Math.min(missingTokens.length, 6)),
      });
    }
  }

  candidates.sort((a, b) =>
    a.tier - b.tier
    || b.score - a.score
    || (a.atomId < b.atomId ? -1 : a.atomId > b.atomId ? 1 : 0));
  return candidates;
}

// ---------------------------------------------------------------------------
// advise_pending lint (round 3) — informational analyze awareness
// ---------------------------------------------------------------------------

/**
 * Shape-compatible with graph-analysis GraphIssue ({code, atomIds, message})
 * on purpose: no severity, no notes[] — the analyze issues contract is
 * unchanged, only a new code appears.
 */
export interface AdvisePendingIssue {
  code: 'advise_pending';
  atomIds: string[];
  message: string;
}

/**
 * One informational issue per stale unexpanded/unjudged skill hypothesis —
 * exactly the advise tier-1 (awaits expand) and tier-2 (awaits judge)
 * candidates, so analyze and advise can never disagree about what is
 * pending. Pure session read, zero subprocess (I1). Sorted atomId asc.
 *
 * Gate semantics live in the CLI: advise_pending is exempt from the default
 * `aot analyze --gate` (informational only); `--failOn advise_pending` opts
 * back in.
 */
export function advisePendingIssues(atoms: Record<string, AtomData>): AdvisePendingIssue[] {
  return adviseCandidates(atoms)
    .filter(candidate => candidate.tier === 1 || candidate.tier === 2)
    .map(candidate => ({
      code: 'advise_pending' as const,
      atomIds: [candidate.atomId],
      message: `Skill hypothesis ${candidate.atomId} (${candidate.slug}) awaits ${candidate.tier === 1 ? 'expand' : 'judge'}`,
    }))
    .sort((a, b) => (a.atomIds[0] < b.atomIds[0] ? -1 : a.atomIds[0] > b.atomIds[0] ? 1 : 0));
}
