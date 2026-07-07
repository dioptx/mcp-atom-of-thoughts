/**
 * Golden-vector pins for the provenance-string grammar (spec §2c, exported as
 * SGT_PROVENANCE_REF_RE in round 3), the Round-2 must-fix traceability
 * negative control, and grammar consistency between the regex and every ref
 * the REAL `aot sgt expand` emits (including headingKey hash-fallback vectors
 * produced by the actual normalization function, not hand-tuned fixtures).
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import {
  SGT_PROVENANCE_REF_RE,
  packEvidenceRefs,
  packHeadingKey,
  sgtNamespace,
  type ContextPackPacket,
} from '../src/sgt-bridge.js';
import { chmodFixtures, createHarness, fixture, requireBuild, type SgtCliHarness } from './helpers/sgt-cli-harness.js';

requireBuild();

const GOLDEN_ACCEPT = [
  // Long real-world slug with double dashes + multi-word headingKey.
  'sgt:packet:kubernetes-deployment-creator--claude-specific--5eda8a52:example-1-deploying-a-web-application:1',
  // Symbol-only-heading hash fallback form.
  'sgt:packet:my-skill:x1a2b3c4d5:0',
  // Reference arm with a dotted basename.
  'sgt:ref:my-skill:doc:SKILL.md',
];

const GOLDEN_REJECT = [
  'sgt:packet:my:skill:intro:0', // colon-bearing slug: segments cannot span ':'
  'sgt:packet:my-skill:intro', // missing excerpt index
];

/**
 * Negative-control regex for the traceability matrix (spec §6, row MF1).
 * RECONSTRUCTED — the verbatim Round-2 original could not be recovered from
 * the planning artifacts, so this encodes the documented failure mode
 * instead: the ref: arm is missing entirely and the headingKey charset is
 * too narrow to admit anything but bare kebab keys. The matrix row is
 * labeled 'reconstructed' accordingly.
 */
const ROUND2_WRONG_RE_RECONSTRUCTED = /^sgt:packet:[^:]+:[a-z0-9-]+:\d+$/;

describe('SGT_PROVENANCE_REF_RE golden vectors', () => {
  it.each(GOLDEN_ACCEPT)('accepts %s', (vector) => {
    expect(SGT_PROVENANCE_REF_RE.test(vector)).toBe(true);
  });

  it.each(GOLDEN_REJECT)('rejects %s', (vector) => {
    expect(SGT_PROVENANCE_REF_RE.test(vector)).toBe(false);
  });

  it('negative control: the reconstructed Round-2 regex FAILS at least one golden vector the corrected regex accepts', () => {
    const rejectedByWrong = GOLDEN_ACCEPT.filter(vector => !ROUND2_WRONG_RE_RECONSTRUCTED.test(vector));
    // This test fails if the negative-control regex accepts ALL golden
    // vectors — that would make the matrix row vacuous.
    expect(rejectedByWrong.length).toBeGreaterThan(0);
    expect(rejectedByWrong).toContain('sgt:ref:my-skill:doc:SKILL.md'); // the missing ref: arm
  });
});

describe('grammar consistency: emitter output always matches the exported regex', () => {
  it('every ref from packEvidenceRefs over the repo context-pack fixture matches', () => {
    const pack = JSON.parse(fs.readFileSync(fixture('context-pack.json'), 'utf8')) as { packets: ContextPackPacket[] };
    for (const packet of pack.packets) {
      const refs = packEvidenceRefs(packet.skill.slug, packet);
      for (const ref of refs) {
        expect(ref, `fixture ref ${ref}`).toMatch(SGT_PROVENANCE_REF_RE);
      }
    }
  });

  it('headingKey hash fallback and hostile headings, produced by the ACTUAL normalization function', () => {
    const hostileHeadings = ['☂☂☂', '§ 4.2 — Ω', ':::', '   ', 'Example 1: Deploying a Web Application', 'x'.repeat(200)];
    const packet: ContextPackPacket = {
      skill: { slug: 'my-skill' },
      excerpts: hostileHeadings.map(heading => ({ heading, excerpt: 'body' })),
      references: [
        { kind: 'doc', path: 'store/my-skill/docs/SKILL.v2.md' },
        { kind: 'scripts', path: 'render.sh' },
      ],
    };
    const refs = packEvidenceRefs('my-skill', packet);
    expect(refs).toHaveLength(hostileHeadings.length + 2);
    for (const ref of refs) {
      expect(ref, `emitted ref ${ref}`).toMatch(SGT_PROVENANCE_REF_RE);
    }
    // Symbol-only headings fall back to the pinned x{sha256[:8]} form.
    expect(packHeadingKey('☂☂☂')).toMatch(/^x[0-9a-f]{8}$/);
    expect(refs[0]).toBe(`sgt:packet:my-skill:${packHeadingKey('☂☂☂')}:0`);
  });
});

describe('grammar consistency through a real `aot sgt expand` (built CLI)', () => {
  let h: SgtCliHarness;

  beforeAll(() => {
    chmodFixtures();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('every provenance string on the e:{slug} scaffold matches SGT_PROVENANCE_REF_RE', () => {
    h = createHarness('aot-sgt-provenance-test-');
    const QUERY = 'deploy kubernetes service';
    const SLUG = 'k8s-manifest-generator';
    h.runJson(['sgt', 'route', QUERY]);
    h.runJson(['sgt', 'expand', SLUG]);
    const scaffold = h.sessionAtoms()[`${sgtNamespace(QUERY)}e:${SLUG}`];
    const evidence = scaffold.evidence as string[];
    expect(evidence.length).toBeGreaterThan(0);
    for (const ref of evidence) {
      expect(ref, `scaffold ref ${ref}`).toMatch(SGT_PROVENANCE_REF_RE);
    }
  });
});
