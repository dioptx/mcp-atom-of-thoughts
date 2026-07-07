/**
 * sgt bridge: subprocess adapter + pure mapping helpers for the
 * skill-graph-traversal CLI (`sgt route plan --format json`).
 *
 * Loose coupling by design (spec I1/I5): aot shells out to SGT_BIN (default
 * "sgt"), parses JSON, and maps the route plan onto AoT atoms. No corpus, no
 * compile-time dependency; every failure surfaces as a structured
 * SGT_UNAVAILABLE error and never touches session state.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AtomType, SkillRef } from './types.js';

export const SGT_DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Explicit maxBuffer: 7114-skill plans can exceed Node's 1 MB default, which
 * would misclassify a healthy run as an exit error.
 */
export const SGT_MAX_BUFFER = 16 * 1024 * 1024;
/** Applied exactly once to atoms dropped by a re-route (check-before-prefix). */
export const SUPERSEDED_PREFIX = '[superseded by re-route] ';
export const SUPERSEDED_CONFIDENCE_CAP = 0.35;

// ---------------------------------------------------------------------------
// Route-plan schema — mirrors the REAL binary's output shape (verified against
// `sgt route plan --format json`): decisionTree is a TOP-LEVEL ARRAY of steps;
// skills carry slug/name/title/score/reasons/facets/storedAt. coverage /
// matchedTokens / missingTokens exist only on sgt's semantic/query-dag paths,
// so they are optional-only here. Unknown extra fields pass through.
// ---------------------------------------------------------------------------

export const DecisionStepSchema = z.object({
  step: z.number().optional(),
  axis: z.string(),
  choice: z.string(),
  why: z.string().default(''),
  candidatesBefore: z.number(),
  candidatesAfter: z.number(),
  alternatives: z.array(z.unknown()).optional(),
}).passthrough();

export const RouteSkillSchema = z.object({
  slug: z.string(),
  score: z.number().optional(),
  coverage: z.number().optional(),
  matchedTokens: z.array(z.string()).optional(),
  missingTokens: z.array(z.string()).optional(),
}).passthrough();

export const RoutePlanSchema = z.object({
  query: z.string(),
  decisionTree: z.array(DecisionStepSchema).default([]),
  skills: z.array(RouteSkillSchema).default([]),
}).passthrough();

export type DecisionStep = z.infer<typeof DecisionStepSchema>;
export type RouteSkill = z.infer<typeof RouteSkillSchema>;
export type RoutePlan = z.infer<typeof RoutePlanSchema>;

// ---------------------------------------------------------------------------
// Context-pack schema — mirrors the REAL binary's output shape (verified
// against `sgt context pack <slug> --query ... --budget ... --format json`,
// sgt 0.7.0; captured envelope recorded in docs/sgt-integration-spec.md §2c):
// budget/packets/unresolvedSlugs/omittedDueToBudget at top level; each packet
// carries skill/excerpts/references plus optional contextDeferred and
// omittedReason. Unknown extra fields pass through.
// ---------------------------------------------------------------------------

export const ContextPackExcerptSchema = z.object({
  heading: z.string(),
  score: z.number().optional(),
  excerpt: z.string(),
}).passthrough();

export const ContextPackReferenceSchema = z.object({
  kind: z.string(),
  path: z.string(),
  bytes: z.number().optional(),
}).passthrough();

export const ContextPackPacketSchema = z.object({
  skill: z.object({
    slug: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
  }).passthrough(),
  excerpts: z.array(ContextPackExcerptSchema).default([]),
  references: z.array(ContextPackReferenceSchema).default([]),
  contextDeferred: z.boolean().optional(),
  omittedReason: z.string().optional(),
}).passthrough();

export const ContextPackSchema = z.object({
  budget: z.object({
    requestedTokens: z.number(),
    estimatedTokens: z.number().optional(),
    policy: z.string().optional(),
  }).passthrough(),
  packets: z.array(ContextPackPacketSchema).default([]),
  unresolvedSlugs: z.array(z.string()).default([]),
  omittedDueToBudget: z.array(z.string()).default([]),
}).passthrough();

export type ContextPackExcerpt = z.infer<typeof ContextPackExcerptSchema>;
export type ContextPackReference = z.infer<typeof ContextPackReferenceSchema>;
export type ContextPackPacket = z.infer<typeof ContextPackPacketSchema>;
export type ContextPack = z.infer<typeof ContextPackSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SgtBridgeErrorDetail =
  | 'SGT_NOT_FOUND'
  | 'SGT_TIMEOUT'
  | 'SGT_EXIT_ERROR'
  | 'SGT_BAD_JSON'
  | 'SGT_SCHEMA_MISMATCH';

export interface SgtBridgeError {
  /** Single stable code for every bridge failure (spec I1). */
  code: 'SGT_UNAVAILABLE';
  detail: SgtBridgeErrorDetail;
  message: string;
  command: string[];
  exitCode?: number;
  stderrHint?: string;
}

export type SgtRouteResult =
  | { ok: true; plan: RoutePlan }
  | { ok: false; error: SgtBridgeError };

export type SgtJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SgtBridgeError };

export type SgtContextPackResult =
  | { ok: true; pack: ContextPack }
  | { ok: false; error: SgtBridgeError };

export interface SgtRouteOptions {
  budget?: number;
  limit?: number;
  /** Facet pins passed through as repeated `--facet DIM:PATH` flags. */
  facets?: string[];
  /** Binary override; defaults to SGT_BIN env, then "sgt". */
  bin?: string;
  /** Timeout override; defaults to SGT_TIMEOUT_MS env, then 30000. */
  timeoutMs?: number;
}

function envTimeoutMs(): number | undefined {
  const raw = process.env.SGT_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type ExecError = Error & {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
};

export interface SgtJsonOptions {
  /** Timeout override; defaults to SGT_TIMEOUT_MS env, then 30000. */
  timeoutMs?: number;
  /** Human label for schema-mismatch messages, e.g. "route-plan". */
  schemaLabel?: string;
}

/**
 * Run one sgt subcommand as a subprocess and parse its JSON stdout against a
 * schema. Shared core for `route plan` and `context pack` — ONE error
 * taxonomy, one subprocess contract:
 * - execFile with an argv ARRAY only — arguments are never shell-interpolated,
 *   so `; $( ) "` and newlines pass through verbatim.
 * - timeout kills with SIGKILL; classified via err.killed/err.signal, never
 *   the exit code.
 * - non-zero exit wins over parseable stdout: a failing sgt never partially
 *   materializes, even if it printed valid JSON before dying.
 * - maxBuffer 16 MB (7114-skill outputs exceed Node's 1 MB default).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod input type must stay open for .default() schemas
export function runSgtJson<T>(bin: string, argv: string[], schema: z.ZodType<T, z.ZodTypeDef, any>, options: SgtJsonOptions = {}): Promise<SgtJsonResult<T>> {
  const timeout = options.timeoutMs ?? envTimeoutMs() ?? SGT_DEFAULT_TIMEOUT_MS;
  const schemaLabel = options.schemaLabel ?? 'sgt';
  const command = [bin, ...argv];

  const fail = (detail: SgtBridgeErrorDetail, message: string, extra: Partial<SgtBridgeError> = {}): SgtJsonResult<T> =>
    ({ ok: false, error: { code: 'SGT_UNAVAILABLE', detail, message, command, ...extra } });

  return new Promise(resolve => {
    execFile(bin, argv, {
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: SGT_MAX_BUFFER,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        const err = error as ExecError;
        const stderrHint = stderr ? stderr.trim().slice(0, 400) : undefined;
        // Timeout first: a killed child may also carry a null exit code.
        if (err.killed || err.signal) {
          resolve(fail('SGT_TIMEOUT', `sgt timed out after ${timeout}ms (signal ${err.signal ?? 'unknown'})`, { stderrHint }));
          return;
        }
        if (err.code === 'ENOENT') {
          resolve(fail('SGT_NOT_FOUND', `sgt binary not found: ${bin}`));
          return;
        }
        if (typeof err.code === 'number') {
          // Exit status wins even when stdout holds valid JSON.
          resolve(fail('SGT_EXIT_ERROR', `sgt exited with code ${err.code}`, { exitCode: err.code, stderrHint }));
          return;
        }
        resolve(fail('SGT_EXIT_ERROR', `sgt failed: ${err.message}`, { stderrHint }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (parseError) {
        resolve(fail('SGT_BAD_JSON', `sgt emitted unparseable JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`, {
          stderrHint: stdout.trim().slice(0, 200) || undefined,
        }));
        return;
      }
      const data = schema.safeParse(parsed);
      if (!data.success) {
        const issues = data.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
        resolve(fail('SGT_SCHEMA_MISMATCH', `sgt JSON does not match the ${schemaLabel} schema: ${issues}`));
        return;
      }
      resolve({ ok: true, data: data.data });
    });
  });
}

/**
 * Run `sgt route plan <query> --format json`. Thin wrapper over runSgtJson;
 * result type and every round-1 pinned behavior unchanged.
 */
export async function runSgtRoutePlan(query: string, options: SgtRouteOptions = {}): Promise<SgtRouteResult> {
  const bin = options.bin ?? process.env.SGT_BIN ?? 'sgt';
  const argv = ['route', 'plan', query, '--format', 'json'];
  if (options.budget !== undefined) argv.push('--budget', String(options.budget));
  if (options.limit !== undefined) argv.push('--limit', String(options.limit));
  for (const facet of options.facets ?? []) argv.push('--facet', facet);
  const result = await runSgtJson(bin, argv, RoutePlanSchema, { timeoutMs: options.timeoutMs, schemaLabel: 'route-plan' });
  return result.ok ? { ok: true, plan: result.data } : result;
}

export interface SgtContextPackOptions {
  /** Query used by sgt to choose matching excerpt windows. */
  query?: string;
  /** sgt context token budget (`--budget`). */
  budget?: number;
  /** Excerpt windows per skill (`--windows`). */
  windows?: number;
  /** Maximum internal references per skill (`--refs`). */
  refs?: number;
  /** Binary override; defaults to SGT_BIN env, then "sgt". */
  bin?: string;
  /** Timeout override; defaults to SGT_TIMEOUT_MS env, then 30000. */
  timeoutMs?: number;
}

/**
 * Run `sgt context pack <slug> --query <q> --format json` for ONE slug.
 * Single-slug argv is pinned (spec §2c): `aot sgt expand` only ever discloses
 * one hypothesis at a time — progressive disclosure never batches.
 */
export function runSgtContextPack(slug: string, options: SgtContextPackOptions = {}): Promise<SgtContextPackResult> {
  const bin = options.bin ?? process.env.SGT_BIN ?? 'sgt';
  const argv = ['context', 'pack', slug, '--query', options.query ?? '', '--format', 'json'];
  if (options.budget !== undefined) argv.push('--budget', String(options.budget));
  if (options.windows !== undefined) argv.push('--windows', String(options.windows));
  if (options.refs !== undefined) argv.push('--refs', String(options.refs));
  return runSgtJson(bin, argv, ContextPackSchema, { timeoutMs: options.timeoutMs, schemaLabel: 'context-pack' })
    .then(result => (result.ok ? { ok: true, pack: result.data } : result));
}

// ---------------------------------------------------------------------------
// Deterministic ids (spec I4/Q1): namespace = sgt:q{sha256(normalized)[:8]}:
// Reasoning ids key on the axis NAME, not the index, so they stay stable when
// an axis is dropped by a re-route.
// ---------------------------------------------------------------------------

export function normalizeSgtQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFC');
}

export function sgtQueryHash(query: string): string {
  return createHash('sha256').update(normalizeSgtQuery(query), 'utf8').digest('hex').slice(0, 8);
}

export function sgtNamespace(query: string): string {
  return `sgt:q${sgtQueryHash(query)}:`;
}

export const sgtIds = {
  premise: (namespace: string): string => `${namespace}p`,
  reasoning: (namespace: string, axis: string): string => `${namespace}r:${axis}`,
  hypothesis: (namespace: string, slug: string): string => `${namespace}h:${slug}`,
  expand: (namespace: string, slug: string): string => `${namespace}e:${slug}`,
  judge: (namespace: string, slug: string, polarity: 'supports' | 'refutes'): string => `${namespace}j:${slug}:${polarity}`,
};

/** Matches hypothesis atoms materialized by `aot sgt route`. */
export const SGT_HYPOTHESIS_ID_RE = /^(sgt:q[0-9a-f]{8}:)h:(.+)$/;

// ---------------------------------------------------------------------------
// Excerpt provenance on evidence (spec §2c grammar):
//   sgt:packet:{slug}:{headingKey}:{index}   — one per excerpt window
//   sgt:ref:{slug}:{kind}:{basename}         — one per internal reference
// headingKey = NFC lowercase, [^a-z0-9]+ -> '-', trimmed of '-', max 48
// chars; falls back to x{sha256(heading)[:8]} for symbol-only headings.
// ---------------------------------------------------------------------------

/**
 * Grammar regex for the provenance strings above (round 3, exported so tests
 * and downstream consumers pin the SAME grammar the emitter uses). Two arms:
 * packet refs end in a numeric excerpt index; ref refs end in a basename that
 * may contain dots but never colons. Slugs and headingKeys never contain ':'.
 */
export const SGT_PROVENANCE_REF_RE = /^sgt:(?:packet:[^:]+:[^:]+:\d+|ref:[^:]+:[^:]+:[^:]+)$/;

export function packHeadingKey(heading: string): string {
  const key = heading
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (key.length > 0) return key;
  return `x${createHash('sha256').update(heading, 'utf8').digest('hex').slice(0, 8)}`;
}

/**
 * Provenance strings for one context-pack packet, in pack emission order:
 * excerpt refs first (array index preserved), then reference refs.
 */
export function packEvidenceRefs(slug: string, packet: ContextPackPacket): string[] {
  const refs: string[] = [];
  packet.excerpts.forEach((excerpt, index) => {
    refs.push(`sgt:packet:${slug}:${packHeadingKey(excerpt.heading)}:${index}`);
  });
  for (const reference of packet.references) {
    const basename = reference.path.split('/').pop() || reference.path;
    refs.push(`sgt:ref:${slug}:${reference.kind}:${basename}`);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Confidence mappings (spec Q2). Documented constants, revisable in later
// rounds; the tier tables below are pinned by tests.
// ---------------------------------------------------------------------------

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * score/coverage -> hypothesis confidence.
 *
 * The score-only branch is the PRIMARY route-plan path (route plans carry
 * score but no coverage); coverage tiers apply only when sgt's semantic /
 * query-dag paths supply it.
 *
 * coverage base: >=0.55 -> 0.82 | >=0.30 -> 0.68 | >=0.15 -> 0.55 | else 0.45
 * score-only base: 0.62 | both missing -> 0.60
 * score modifier: >=80 -> +0.08 | >=40 -> +0.04 | >=15 -> +0.00 | <15 -> -0.05
 * clamp [0.40, 0.92].
 */
export function mapSgtSkillConfidence(skill: { score?: number; coverage?: number }): number {
  const { score, coverage } = skill;
  let base: number;
  if (coverage !== undefined) {
    base = coverage >= 0.55 ? 0.82 : coverage >= 0.30 ? 0.68 : coverage >= 0.15 ? 0.55 : 0.45;
  } else if (score !== undefined) {
    base = 0.62;
  } else {
    base = 0.60;
  }
  const modifier = score === undefined ? 0 : score >= 80 ? 0.08 : score >= 40 ? 0.04 : score >= 15 ? 0 : -0.05;
  return round4(Math.min(0.92, Math.max(0.40, base + modifier)));
}

/**
 * Decision-tree narrowing -> reasoning confidence. Stronger narrowing (small
 * after/before ratio) means the axis choice carried more information.
 *
 * before <= 0 -> 0.58 | ratio >= 1 -> 0.56 | else 0.56 + 0.28*(1-ratio)^0.7,
 * bounded [0.56, 0.84].
 */
export function narrowingConfidence(candidatesBefore: number, candidatesAfter: number): number {
  if (candidatesBefore <= 0) return 0.58;
  const ratio = candidatesAfter / candidatesBefore;
  if (ratio >= 1) return 0.56;
  const value = 0.56 + 0.28 * Math.pow(1 - ratio, 0.7);
  return round4(Math.min(0.84, Math.max(0.56, value)));
}

// ---------------------------------------------------------------------------
// Pure materialization planning: RoutePlan -> ordered atom payloads.
// The CLI turns this into processAtom (new) / updateAtom (existing) calls.
// ---------------------------------------------------------------------------

export interface PlannedAtom {
  atomId: string;
  atomType: AtomType;
  content: string;
  dependencies: string[];
  confidence: number;
  skillRef?: SkillRef;
}

export interface RouteMaterializationPlan {
  namespace: string;
  queryHash: string;
  premiseId: string;
  /** Creation order: premise, reasoning chain, then hypotheses. */
  atoms: PlannedAtom[];
}

export function planRouteAtoms(query: string, plan: RoutePlan, premiseConfidence = 0.95): RouteMaterializationPlan {
  const namespace = sgtNamespace(query);
  const premiseId = sgtIds.premise(namespace);
  const atoms: PlannedAtom[] = [{
    atomId: premiseId,
    atomType: 'premise',
    content: query,
    dependencies: [],
    confidence: premiseConfidence,
  }];

  let previousId = premiseId;
  for (const step of plan.decisionTree) {
    const atomId = sgtIds.reasoning(namespace, step.axis);
    atoms.push({
      atomId,
      atomType: 'reasoning',
      content: `${step.axis}: ${step.choice} (${step.candidatesBefore}->${step.candidatesAfter}) — ${step.why}`,
      dependencies: [previousId],
      confidence: narrowingConfidence(step.candidatesBefore, step.candidatesAfter),
    });
    previousId = atomId;
  }

  // Hypotheses hang off the last reasoning atom (premise when the tree is empty).
  for (const skill of plan.skills) {
    atoms.push({
      atomId: sgtIds.hypothesis(namespace, skill.slug),
      atomType: 'hypothesis',
      content: `skill ${skill.slug} is relevant to: ${query}`,
      dependencies: [previousId],
      confidence: mapSgtSkillConfidence(skill),
      skillRef: {
        slug: skill.slug,
        source: 'sgt',
        ...(skill.score !== undefined ? { score: skill.score } : {}),
        ...(skill.coverage !== undefined ? { coverage: skill.coverage } : {}),
        ...(skill.matchedTokens !== undefined ? { matchedTokens: skill.matchedTokens } : {}),
        ...(skill.missingTokens !== undefined ? { missingTokens: skill.missingTokens } : {}),
      },
    });
  }

  return { namespace, queryHash: sgtQueryHash(query), premiseId, atoms };
}

/**
 * Token-list equality for skillRef diffing. Absent (undefined) and empty
 * ([]) are DISTINCT states (pinned in spec §2c): sgt not reporting tokens is
 * not the same claim as sgt reporting zero tokens, and collapsing them would
 * make a re-route that starts reporting `missingTokens: []` a silent no-op.
 */
function tokenListEquals(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.join('\u0000') === b.join('\u0000');
}

export function skillRefEquals(a: SkillRef | undefined, b: SkillRef | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.slug === b.slug && a.source === b.source && a.score === b.score && a.coverage === b.coverage
    && tokenListEquals(a.matchedTokens, b.matchedTokens)
    && tokenListEquals(a.missingTokens, b.missingTokens);
}
