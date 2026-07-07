/**
 * Docs + scope-guard pins for sgt round 3: spec status/matrix/checklist,
 * CHANGELOG entry, README section with the full error-code inventory,
 * dossier section, and the frozen v1 scope (no MCP sgt_* verbs, no
 * `aot sgt dag`, no severity/notes fields on issues).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ERROR_CODES = [
  'SGT_NOT_FOUND', 'SGT_TIMEOUT', 'SGT_EXIT_ERROR', 'SGT_BAD_JSON', 'SGT_SCHEMA_MISMATCH',
  'SGT_UNAVAILABLE', 'SGT_EXPAND_REFUSED', 'SGT_SLUG_UNRESOLVED',
  'SGT_NOT_HYPOTHESIS', 'SGT_HYPOTHESIS_NOT_FOUND', 'SGT_AMBIGUOUS_SLUG',
];

describe('docs/sgt-integration-spec.md', () => {
  const spec = read('docs/sgt-integration-spec.md');

  it('Status line says implemented', () => {
    expect(spec).toMatch(/^Status: .*implemented/m);
  });

  it('§6 traceability matrix has exactly 6 rows (one per Round-2 must-fix) with real test anchors', () => {
    const rows = spec.match(/^\| MF\d /gm) ?? [];
    expect(rows).toHaveLength(6);
    // Real anchors, not payload-shape.test.ts (that file pins processAtom v3
    // slim payloads) — checked per row so the explanatory note may name it.
    const matrix = spec.slice(spec.indexOf('## 6.'), spec.indexOf('## 7.'));
    for (const row of rows.length ? matrix.split('\n').filter(line => line.startsWith('| MF')) : []) {
      expect(row).not.toContain('payload-shape.test.ts');
    }
    for (const anchor of [
      'sgt-provenance-golden.test.ts', 'cli-sgt-expand.test.ts', 'sgt-adversarial.test.ts',
      'cli-sgt-advise.test.ts', 'sgt-bridge.test.ts',
    ]) {
      expect(matrix).toContain(anchor);
    }
    // The negative-control regex row is honest about being reconstructed.
    expect(matrix).toMatch(/RECONSTRUCTED/i);
  });

  it('§7 ship/no-ship checklist carries gates S1-S11 and deferrals D1-D7', () => {
    const checklist = spec.slice(spec.indexOf('## 7.'));
    for (let gate = 1; gate <= 11; gate++) expect(checklist).toMatch(new RegExp(`\\| S${gate} \\|`));
    for (let deferral = 1; deferral <= 7; deferral++) expect(checklist).toMatch(new RegExp(`\\| D${deferral} \\|`));
  });

  it('error-code inventory covers the full taxonomy with the state-never-modified guarantee', () => {
    for (const code of ERROR_CODES) expect(spec).toContain(code);
    expect(spec).toContain('never modified');
  });
});

describe('CHANGELOG.md', () => {
  it('has an sgt round-3 Added entry mentioning aot sgt trace', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toMatch(/^### Added — sgt .*round 3/m);
    expect(changelog).toContain('aot sgt trace');
    expect(changelog).toContain('advise_pending');
  });
});

describe('README.md', () => {
  const readme = read('README.md');

  it('has the Skill graph bridge section with SGT_BIN, the command table, and the advise_pending gate note', () => {
    expect(readme).toContain('## Skill graph bridge (`aot sgt`)');
    expect(readme).toContain('SGT_BIN');
    for (const command of ['sgt route', 'sgt expand', 'sgt judge', 'sgt advise', 'sgt trace']) {
      expect(readme).toContain(command);
    }
    expect(readme).toContain('advise_pending');
    expect(readme).toContain('--failOn advise_pending');
  });

  it('documents the full error-code inventory with the state guarantee', () => {
    for (const code of ERROR_CODES) expect(readme).toContain(code);
    expect(readme).toContain('state never modified');
  });
});

describe('docs/aot-dossier.md', () => {
  it('has the sgt bridge section (round-brief requirement)', () => {
    const dossier = read('docs/aot-dossier.md');
    expect(dossier).toMatch(/^## .*sgt skill-graph bridge/m);
    expect(dossier).toContain('aot sgt trace');
  });
});

describe('scope guard: frozen v1 surface', () => {
  it('no MCP sgt_* verbs, no `aot sgt dag` command, no new subprocess path for trace/advise', () => {
    const tools = read('src/tools.ts');
    for (const verb of ['sgt_route', 'sgt_judge', 'sgt_expand', 'sgt_advise', 'sgt_trace']) {
      expect(tools).not.toContain(verb);
    }
    const cli = read('src/cli.ts');
    expect(cli).not.toContain("sgt.command('dag'");
    // trace goes through runGraphRender — never through runSgtJson/execFile.
    const traceBlock = cli.slice(cli.indexOf("sgt.command('trace'"), cli.indexOf("cli.command(sgt)"));
    expect(traceBlock).toContain('runGraphRender');
    expect(traceBlock).not.toContain('runSgt');
  });

  it('advise_pending issues carry no severity/notes fields (contract pinned at type level too)', () => {
    const epistemics = read('src/sgt-epistemics.ts');
    const issueBlock = epistemics.slice(epistemics.indexOf('interface AdvisePendingIssue'), epistemics.indexOf('export function advisePendingIssues'));
    expect(issueBlock).not.toContain('severity');
    expect(issueBlock).not.toContain('notes');
  });
});
