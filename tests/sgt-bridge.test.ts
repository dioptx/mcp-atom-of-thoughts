/**
 * Unit tests for the sgt bridge adapter (src/sgt-bridge.ts): subprocess error
 * classification (SGT_UNAVAILABLE details), argv/maxBuffer subprocess
 * contract, route-plan schema fidelity to the real binary output, and the
 * pure confidence/id/mapping helpers.
 *
 * Fixture SGT_BIN scripts are POSIX #!/bin/sh; chmod +x is (re-)applied in
 * beforeAll because the executable bit does not reliably survive npm pack.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextPackSchema,
  RoutePlanSchema,
  SGT_MAX_BUFFER,
  SUPERSEDED_PREFIX,
  mapSgtSkillConfidence,
  narrowingConfidence,
  normalizeSgtQuery,
  planRouteAtoms,
  runSgtContextPack,
  runSgtRoutePlan,
  sgtIds,
  sgtNamespace,
  sgtQueryHash,
  skillRefEquals,
} from '../src/sgt-bridge.js';

const FIXTURES = path.resolve(__dirname, 'fixtures', 'sgt-bin');
const fixture = (name: string): string => path.join(FIXTURES, name);

beforeAll(() => {
  for (const file of fs.readdirSync(FIXTURES)) {
    if (file.endsWith('.sh')) fs.chmodSync(fixture(file), 0o755);
  }
});

describe('runSgtRoutePlan error classification (all SGT_UNAVAILABLE)', () => {
  it('missing binary -> SGT_NOT_FOUND', async () => {
    const result = await runSgtRoutePlan('x', { bin: '/nonexistent/binary' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SGT_UNAVAILABLE');
    expect(result.error.detail).toBe('SGT_NOT_FOUND');
    expect(result.error.command[0]).toBe('/nonexistent/binary');
  });

  it('non-zero exit -> SGT_EXIT_ERROR with exitCode and stderrHint, even with valid JSON on stdout', async () => {
    const result = await runSgtRoutePlan('x', { bin: fixture('sgt-exit-error.sh') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe('SGT_EXIT_ERROR'); // exit status wins over parseable stdout
    expect(result.error.exitCode).toBe(3);
    expect(result.error.stderrHint).toContain('ontology bundle missing');
  });

  it('unparseable stdout -> SGT_BAD_JSON', async () => {
    const result = await runSgtRoutePlan('x', { bin: fixture('sgt-bad-json.sh') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe('SGT_BAD_JSON');
  });

  it('schema-violating JSON -> SGT_SCHEMA_MISMATCH', async () => {
    const result = await runSgtRoutePlan('x', { bin: fixture('sgt-schema-mismatch.sh') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe('SGT_SCHEMA_MISMATCH');
    expect(result.error.message).toContain('query');
  });

  it('timeout -> SGT_TIMEOUT via kill/signal classification (opts override)', async () => {
    const result = await runSgtRoutePlan('x', { bin: fixture('sgt-slow.sh'), timeoutMs: 200 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe('SGT_TIMEOUT');
    // Never misclassified as an exit error.
    expect(result.error.exitCode).toBeUndefined();
  }, 15_000);

  it('timeout honors the SGT_TIMEOUT_MS env variable', async () => {
    const previous = process.env.SGT_TIMEOUT_MS;
    process.env.SGT_TIMEOUT_MS = '200';
    try {
      const result = await runSgtRoutePlan('x', { bin: fixture('sgt-slow.sh') });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.detail).toBe('SGT_TIMEOUT');
    } finally {
      if (previous === undefined) delete process.env.SGT_TIMEOUT_MS;
      else process.env.SGT_TIMEOUT_MS = previous;
    }
  }, 15_000);
});

describe('runSgtRoutePlan subprocess contract', () => {
  it('passes the query through argv verbatim — no shell interpolation', async () => {
    const hostile = 'deploy; $(rm -rf /) "quoted" `tick`\nnewline';
    const result = await runSgtRoutePlan(hostile, { bin: fixture('sgt-echo.sh') });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query).toBe(hostile); // round-trips exactly
    expect(result.plan.skills[0].slug).toBe('echo-skill');
  });

  it('uses an explicit maxBuffer >= 16MB and survives >1MB plans', async () => {
    expect(SGT_MAX_BUFFER).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    const result = await runSgtRoutePlan('big', { bin: fixture('sgt-big.sh') });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    expect(result.plan.skills.length).toBe(20_000);
  }, 30_000);

  it('parses the ok fixture into a typed plan', async () => {
    const result = await runSgtRoutePlan('deploy kubernetes service', { bin: fixture('sgt-ok.sh') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query).toBe('deploy kubernetes service');
    expect(result.plan.decisionTree).toHaveLength(2);
    expect(result.plan.skills.map(s => s.slug)).toEqual([
      'kubernetes-deployment-creator--claude-specific--5eda8a52',
      'k8s-manifest-generator',
      'sparse-notes-skill',
    ]);
  });
});

describe('RoutePlanSchema (mirrors the real binary output shape)', () => {
  it('parses captured-real-shape output: top-level decisionTree ARRAY, skills without coverage', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('route-plan.json'), 'utf8'));
    const parsed = RoutePlanSchema.parse(raw);
    expect(Array.isArray(parsed.decisionTree)).toBe(true);
    expect(parsed.decisionTree[0]).toMatchObject({
      step: 1,
      axis: 'domain',
      choice: 'Infrastructure/DevOps/Deployment',
      candidatesBefore: 7114,
      candidatesAfter: 412,
    });
    // Real skills carry score/reasons/facets/storedAt — never coverage.
    const first = parsed.skills[0] as Record<string, unknown>;
    expect(first.slug).toBe('kubernetes-deployment-creator--claude-specific--5eda8a52');
    expect(first.score).toBe(119.07);
    expect(first.coverage).toBeUndefined();
    expect(first.reasons).toEqual(['name:deploy', 'name:kubernetes', 'term:service']);
    expect(first.storedAt).toBe('store/kubernetes-deployment-creator--claude-specific--5eda8a52');
  });

  it('accepts unknown extra fields (passthrough) and defaults missing decisionTree', () => {
    const parsed = RoutePlanSchema.parse({
      query: 'q',
      skills: [{ slug: 's', score: 1, futureField: { nested: true } }],
      budget: { requestedTokens: 10 },
      brandNewTopLevel: 42,
    });
    expect(parsed.decisionTree).toEqual([]);
    expect((parsed as Record<string, unknown>).brandNewTopLevel).toBe(42);
    expect((parsed.skills[0] as Record<string, unknown>).futureField).toEqual({ nested: true });
  });

  it('accepts optional-only coverage/matchedTokens/missingTokens (semantic/query-dag path)', () => {
    const parsed = RoutePlanSchema.parse({
      query: 'q',
      decisionTree: [],
      skills: [{ slug: 's', coverage: 0.5, matchedTokens: ['a'], missingTokens: ['b'] }],
    });
    expect(parsed.skills[0].coverage).toBe(0.5);
  });

  it('parses the v2 fixture', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('route-plan-v2.json'), 'utf8'));
    const parsed = RoutePlanSchema.parse(raw);
    expect(parsed.decisionTree).toHaveLength(1);
    expect(parsed.skills.map(s => s.slug)).toContain('maintainx-deploy-integration');
  });
});

describe('mapSgtSkillConfidence tier table (documented constants)', () => {
  it('matches the pinned table', () => {
    expect(mapSgtSkillConfidence({ coverage: 0.7, score: 95 })).toBe(0.90);
    expect(mapSgtSkillConfidence({ coverage: 0.32, score: 41 })).toBe(0.72);
    expect(mapSgtSkillConfidence({ coverage: 0.10 })).toBe(0.45);
    expect(mapSgtSkillConfidence({ score: 41 })).toBe(0.66); // score-only = primary route-plan path
    expect(mapSgtSkillConfidence({ score: 119 })).toBe(0.70);
    expect(mapSgtSkillConfidence({})).toBe(0.60);
  });

  it('clamps every output to [0.40, 0.92]', () => {
    const inputs: Array<{ score?: number; coverage?: number }> = [
      {}, { score: -100 }, { score: 0 }, { score: 5 }, { score: 10_000 },
      { coverage: -1 }, { coverage: 0 }, { coverage: 0.01, score: 1 },
      { coverage: 1, score: 10_000 }, { coverage: 0.14, score: 14 },
    ];
    for (const input of inputs) {
      const value = mapSgtSkillConfidence(input);
      expect(value).toBeGreaterThanOrEqual(0.40);
      expect(value).toBeLessThanOrEqual(0.92);
    }
  });
});

describe('narrowingConfidence', () => {
  it('follows 0.56 + 0.28*(1-ratio)^0.7 for real narrowing', () => {
    // (7114, 412): ratio ~= 0.0579 -> ~0.8285 (~0.828 at 3dp per the formula)
    const expected = 0.56 + 0.28 * Math.pow(1 - 412 / 7114, 0.7);
    expect(narrowingConfidence(7114, 412)).toBeCloseTo(expected, 4);
    expect(narrowingConfidence(7114, 412)).toBeCloseTo(0.8285, 3);
  });

  it('no narrowing -> 0.56; empty before -> 0.58', () => {
    expect(narrowingConfidence(10, 10)).toBe(0.56);
    expect(narrowingConfidence(0, 5)).toBe(0.58);
  });

  it('stays within [0.56, 0.84] for all inputs', () => {
    const cases: Array<[number, number]> = [[-5, 2], [0, 0], [1, 0], [10, 10], [10, 20], [7114, 412], [7114, 1], [1_000_000, 0]];
    for (const [before, after] of cases) {
      const value = narrowingConfidence(before, after);
      expect(value).toBeGreaterThanOrEqual(0.56);
      expect(value).toBeLessThanOrEqual(0.84);
    }
  });
});

describe('deterministic ids and query normalization', () => {
  it('trim/collapse-ws/lowercase/NFC normalize to the same namespace', () => {
    expect(normalizeSgtQuery('Deploy  K8s Service ')).toBe('deploy k8s service');
    expect(sgtQueryHash('Deploy  K8s Service ')).toBe(sgtQueryHash('deploy k8s service'));
    expect(sgtNamespace('Deploy  K8s Service ')).toBe(sgtNamespace('deploy k8s service'));
    expect(sgtQueryHash('deploy k8s service')).toMatch(/^[0-9a-f]{8}$/);
    expect(sgtQueryHash('a totally different query')).not.toBe(sgtQueryHash('deploy k8s service'));
  });

  it('id builders produce the pinned shapes', () => {
    const ns = sgtNamespace('deploy k8s service');
    expect(sgtIds.premise(ns)).toBe(`${ns}p`);
    expect(sgtIds.reasoning(ns, 'domain')).toBe(`${ns}r:domain`);
    expect(sgtIds.hypothesis(ns, 'kubernetes-deployment-creator--claude-specific--5eda8a52'))
      .toBe(`${ns}h:kubernetes-deployment-creator--claude-specific--5eda8a52`);
    expect(sgtIds.judge(ns, 'x', 'refutes')).toBe(`${ns}j:x:refutes`);
  });
});

describe('planRouteAtoms mapping', () => {
  const plan = RoutePlanSchema.parse(JSON.parse(fs.readFileSync(fixture('route-plan.json'), 'utf8')));

  it('premise -> chained reasoning (keyed by axis NAME) -> hypotheses off the last reasoning atom', () => {
    const materialization = planRouteAtoms('deploy kubernetes service', plan);
    const ns = materialization.namespace;
    const ids = materialization.atoms.map(a => a.atomId);
    expect(ids).toEqual([
      `${ns}p`,
      `${ns}r:domain`,
      `${ns}r:capability`,
      `${ns}h:kubernetes-deployment-creator--claude-specific--5eda8a52`,
      `${ns}h:k8s-manifest-generator`,
      `${ns}h:sparse-notes-skill`,
    ]);
    const [premise, rDomain, rCapability, h1, h2, h3] = materialization.atoms;
    expect(premise).toMatchObject({ atomType: 'premise', content: 'deploy kubernetes service', dependencies: [], confidence: 0.95 });
    expect(rDomain.dependencies).toEqual([premise.atomId]);
    expect(rDomain.confidence).toBeCloseTo(0.8285, 3);
    expect(rDomain.content).toContain('domain: Infrastructure/DevOps/Deployment (7114->412)');
    expect(rCapability.dependencies).toEqual([rDomain.atomId]);
    for (const hypothesis of [h1, h2, h3]) {
      expect(hypothesis.atomType).toBe('hypothesis');
      expect(hypothesis.dependencies).toEqual([rCapability.atomId]);
      expect(hypothesis.content).toContain('is relevant to: deploy kubernetes service');
    }
    // Score-tier-mapped confidences with skillRef provenance.
    expect(h1.confidence).toBe(0.70); // score 119.07
    expect(h1.skillRef).toEqual({ slug: 'kubernetes-deployment-creator--claude-specific--5eda8a52', source: 'sgt', score: 119.07 });
    expect(h2.confidence).toBe(0.66); // score 41
    expect(h3.confidence).toBe(0.60); // no score
    expect(h3.skillRef).toEqual({ slug: 'sparse-notes-skill', source: 'sgt' });
  });

  it('hypotheses hang off the premise when decisionTree is empty', () => {
    const empty = RoutePlanSchema.parse({ query: 'q', decisionTree: [], skills: [{ slug: 's', score: 50 }] });
    const materialization = planRouteAtoms('q', empty);
    expect(materialization.atoms).toHaveLength(2);
    expect(materialization.atoms[1].dependencies).toEqual([materialization.premiseId]);
  });

  it('is deterministic: same plan + query -> identical planned atoms', () => {
    const a = planRouteAtoms('deploy kubernetes service', plan);
    const b = planRouteAtoms('Deploy  Kubernetes Service', plan); // normalizes to same namespace
    expect(a.namespace).toBe(b.namespace);
    expect(a.atoms.map(x => x.atomId)).toEqual(b.atoms.map(x => x.atomId));
  });

  it('skillRefEquals compares all fields', () => {
    expect(skillRefEquals(undefined, undefined)).toBe(true);
    expect(skillRefEquals({ slug: 'a', source: 'sgt' }, undefined)).toBe(false);
    expect(skillRefEquals({ slug: 'a', source: 'sgt', score: 1 }, { slug: 'a', source: 'sgt', score: 1 })).toBe(true);
    expect(skillRefEquals({ slug: 'a', source: 'sgt', score: 1 }, { slug: 'a', source: 'sgt', score: 2 })).toBe(false);
  });

  it('exposes the superseded prefix constant used by re-route', () => {
    expect(SUPERSEDED_PREFIX).toBe('[superseded by re-route] ');
  });
});

// ---------------------------------------------------------------------------
// Round 2 additions (additive describes only): context-pack schema, single-
// slug argv construction, shared runSgtJson failure taxonomy, and the
// matchedTokens/missingTokens skillRef extension.
// ---------------------------------------------------------------------------

describe('ContextPackSchema (mirrors the real `sgt context pack --format json` shape)', () => {
  it('parses the captured-real-shape fixture', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('context-pack.json'), 'utf8'));
    const parsed = ContextPackSchema.parse(raw);
    expect(parsed.budget.requestedTokens).toBe(1200);
    expect(parsed.packets).toHaveLength(2);
    expect(parsed.packets[0].skill.slug).toBe('k8s-manifest-generator');
    expect(parsed.packets[0].excerpts.map(e => e.heading)).toEqual(['Trigger & When', 'Usage']);
    expect(parsed.packets[0].references[0]).toMatchObject({ kind: 'references', path: 'store/k8s-manifest-generator/references/SKILL.md', bytes: 4321 });
    expect(parsed.packets[1].contextDeferred).toBe(true);
    expect(parsed.packets[1].omittedReason).toBe('excerpt packet exceeds requested budget');
    expect(parsed.unresolvedSlugs).toEqual([]);
    expect(parsed.omittedDueToBudget).toEqual(['sparse-notes-skill']);
  });

  it('accepts unknown extra fields (passthrough) and defaults missing arrays', () => {
    const parsed = ContextPackSchema.parse({
      budget: { requestedTokens: 400, estimatedTokens: 67, policy: 'x', futureBudgetField: 1 },
      packets: [{ skill: { slug: 's', facets: { domain: 'X' }, storedAt: 'store/s' }, excerpts: [{ heading: 'h', excerpt: 'e', futureField: true }], references: [] }],
      brandNewTopLevel: 42,
    });
    expect(parsed.unresolvedSlugs).toEqual([]);
    expect(parsed.omittedDueToBudget).toEqual([]);
    expect((parsed as Record<string, unknown>).brandNewTopLevel).toBe(42);
    expect((parsed.packets[0].skill as Record<string, unknown>).storedAt).toBe('store/s');
    expect((parsed.packets[0].excerpts[0] as Record<string, unknown>).futureField).toBe(true);
  });

  it('rejects required-field mismatches', () => {
    expect(ContextPackSchema.safeParse({ packets: [] }).success).toBe(false); // budget missing
    expect(ContextPackSchema.safeParse({ budget: { requestedTokens: 'lots' }, packets: [] }).success).toBe(false);
    expect(ContextPackSchema.safeParse({ budget: { requestedTokens: 1 }, packets: [{ skill: {} }] }).success).toBe(false); // packet without slug
  });
});

describe('runSgtContextPack (single-slug argv over the shared runSgtJson core)', () => {
  it('builds the pinned single-slug argv: context pack <slug> --query <q> --format json [--budget --windows --refs]', async () => {
    const result = await runSgtContextPack('my-slug', {
      bin: fixture('sgt-pack-echo.sh'),
      query: 'q text',
      budget: 400,
      windows: 3,
      refs: 2,
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    expect((result.pack as Record<string, unknown>).argv).toEqual([
      'context', 'pack', 'my-slug', '--query', 'q text', '--format', 'json',
      '--budget', '400', '--windows', '3', '--refs', '2',
    ]);
  });

  it('never shell-interpolates the query and defaults it to the empty string', async () => {
    const hostile = 'deploy; $(rm -rf /) "quoted" `tick`';
    const withQuery = await runSgtContextPack('s', { bin: fixture('sgt-pack-echo.sh'), query: hostile });
    expect(withQuery.ok).toBe(true);
    if (withQuery.ok) {
      expect(((withQuery.pack as Record<string, unknown>).argv as string[])[4]).toBe(hostile);
    }
    const noQuery = await runSgtContextPack('s', { bin: fixture('sgt-pack-echo.sh') });
    expect(noQuery.ok).toBe(true);
    if (noQuery.ok) {
      expect((noQuery.pack as Record<string, unknown>).argv).toEqual(['context', 'pack', 's', '--query', '', '--format', 'json']);
    }
  });

  it('reuses the shared failure taxonomy: exit error / bad JSON / schema mismatch with the context-pack label', async () => {
    const exitError = await runSgtContextPack('s', { bin: fixture('sgt-exit-error.sh') });
    expect(!exitError.ok && exitError.error.detail).toBe('SGT_EXIT_ERROR');

    const badJson = await runSgtContextPack('s', { bin: fixture('sgt-bad-json.sh') });
    expect(!badJson.ok && badJson.error.detail).toBe('SGT_BAD_JSON');

    const mismatch = await runSgtContextPack('s', { bin: fixture('sgt-schema-mismatch.sh') });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.detail).toBe('SGT_SCHEMA_MISMATCH');
    expect(mismatch.error.message).toContain('context-pack');

    const notFound = await runSgtContextPack('s', { bin: '/nonexistent/binary' });
    expect(!notFound.ok && notFound.error.detail).toBe('SGT_NOT_FOUND');
  });
});

describe('skillRef matchedTokens/missingTokens extension (round 2)', () => {
  it('skillRefEquals pins undefined vs [] as DISTINCT and compares token content and order', () => {
    const base = { slug: 'a', source: 'sgt' as const };
    expect(skillRefEquals({ ...base }, { ...base, missingTokens: [] })).toBe(false); // absent !== empty
    expect(skillRefEquals({ ...base, missingTokens: [] }, { ...base, missingTokens: [] })).toBe(true);
    expect(skillRefEquals({ ...base, missingTokens: ['a', 'b'] }, { ...base, missingTokens: ['a', 'b'] })).toBe(true);
    expect(skillRefEquals({ ...base, missingTokens: ['a', 'b'] }, { ...base, missingTokens: ['b', 'a'] })).toBe(false);
    expect(skillRefEquals({ ...base, matchedTokens: ['x'] }, { ...base })).toBe(false);
    expect(skillRefEquals({ ...base, matchedTokens: ['x'], missingTokens: ['y'] }, { ...base, matchedTokens: ['x'], missingTokens: ['y'] })).toBe(true);
  });

  it('planRouteAtoms passes matchedTokens/missingTokens through onto skillRef', () => {
    const withTokens = RoutePlanSchema.parse(JSON.parse(fs.readFileSync(fixture('route-plan-tokens.json'), 'utf8')));
    const materialization = planRouteAtoms('deploy kubernetes service', withTokens);
    const hypotheses = materialization.atoms.filter(a => a.atomType === 'hypothesis');
    expect(hypotheses[0].skillRef).toEqual({
      slug: 'kubernetes-deployment-creator--claude-specific--5eda8a52',
      source: 'sgt',
      score: 119.07,
      missingTokens: ['helm', 'chart'],
    });
    expect(hypotheses[1].skillRef).toEqual({ slug: 'k8s-manifest-generator', source: 'sgt', score: 41 }); // no token keys when absent
    expect(hypotheses[2].skillRef).toEqual({
      slug: 'sparse-notes-skill',
      source: 'sgt',
      matchedTokens: ['service'],
      missingTokens: ['helm', 'chart'],
    });
  });

  it('exposes the expand id builder alongside the round-1 shapes', () => {
    const ns = sgtNamespace('deploy k8s service');
    expect(sgtIds.expand(ns, 'k8s-manifest-generator')).toBe(`${ns}e:k8s-manifest-generator`);
  });
});
