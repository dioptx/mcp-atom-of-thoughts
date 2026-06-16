import { describe, expect, it } from 'vitest';
import { summarizeBrSync } from '../src/integrations/br.js';
import { summarizeBvRobot } from '../src/integrations/bv.js';
import { buildDagAtoms, buildDagGraph, normalizeDag, summarizeDag } from '../src/integrations/dag.js';
import { buildPexAtoms, normalizePexTarget, pexSourcegraphArgs } from '../src/integrations/pex.js';
import { commandErrorPayload, ExternalCommandError, errorToPayload, type CommandResult } from '../src/integrations/shell-json.js';

describe('CLI integration helpers', () => {
  it('normalizes ANZCA AP codes for PEX', () => {
    expect(normalizePexTarget('AP19B01')).toBe('2019B01');
    expect(normalizePexTarget('2019B01')).toBe('2019B01');
  });

  it('derives PEX sourcegraph args from exam codes', () => {
    expect(pexSourcegraphArgs('2019B01')).toEqual(['sourcegraph', '2019B', '--focus', '2019B01', '--json']);
    expect(pexSourcegraphArgs('suxamethonium')).toBeNull();
  });

  it('builds dependency-ordered PEX atoms', () => {
    const atoms = buildPexAtoms({
      target: 'AP19B01',
      pexTarget: '2019B01',
      topic: 'suxamethonium adverse effects',
      calls: [
        { name: 'scope', command: ['pex', 'scope'], ok: true, data: { pass_rate: 45 } },
        { name: 'brief', command: ['pex', 'brief'], ok: true, data: { phase: 'brief' } },
        { name: 'evidence', command: ['pex', 'evidence'], ok: true, data: { hits: [] } },
      ],
    }, 'study');

    expect(atoms.map(atom => atom.atomId)).toEqual([
      '2019B01-PEX-SCOPE',
      '2019B01-PEX-BRIEF',
      '2019B01-PEX-EVIDENCE',
      '2019B01-PEX-SYNTHESIS',
    ]);
    expect(atoms[1].dependencies).toEqual(['2019B01-PEX-SCOPE']);
    expect(atoms.at(-1)?.dependencies).toContain('2019B01-PEX-EVIDENCE');
    expect(atoms[0].sessionId).toBe('study');
  });

  it('summarizes br sync results compactly', () => {
    expect(summarizeBrSync({
      sessionId: 'default',
      nodeCount: 2,
      linkCount: 1,
      created: [{ id: 'bd-1' }],
      existing: [{ id: 'bd-0' }],
      dependencies: [{ from: 'P1', to: 'R1' }],
    })).toMatchObject({
      status: 'ok',
      sessionId: 'default',
      nodeCount: 2,
      linkCount: 1,
      createdCount: 1,
      existingCount: 1,
      dependencyCount: 1,
    });
  });

  it('summarizes bv robot triage payloads', () => {
    const summary = summarizeBvRobot('triage', {
      triage: {
        quick_ref: {
          open_count: 3,
          actionable_count: 1,
          blocked_count: 2,
          top_picks: [{ id: 'bd-1' }],
        },
      },
    });
    expect(summary).toMatchObject({ command: 'triage', openCount: 3, actionableCount: 1, blockedCount: 2 });
  });

  it('normalizes nuanced DAG dependencies, constraints, and entailments', () => {
    const dag = normalizeDag({
      title: 'Nuanced DAG',
      sessionId: 'dag-test',
      constraints: ['do not publish until validation passes'],
      nodes: [
        { id: 'A', title: 'Define interface', type: 'task', constraints: ['schema first'] },
        { id: 'B', title: 'Implement adapter', type: 'task', dependsOn: ['A'] },
        { id: 'C', title: 'Validate graph', type: 'validation' },
      ],
      edges: [
        { from: 'A', to: 'C', type: 'entails', description: 'interface determines validation cases' },
        { from: 'C', to: 'B', type: 'constrains', description: 'implementation must satisfy validation' },
      ],
    });

    expect(summarizeDag(dag)).toMatchObject({ nodeCount: 3, edgeCount: 3, blockingEdgeCount: 1, constraintEdgeCount: 1, entailmentEdgeCount: 1 });
    expect(dag.nodes.find(node => node.id === 'B')?.dependencies).toEqual(['A']);
    expect(dag.nodes.find(node => node.id === 'B')?.constraints).toContain('C: implementation must satisfy validation');
    expect(dag.nodes.find(node => node.id === 'C')?.entailments).toContain('A: interface determines validation cases');
  });

  it('builds AoT atoms and br graph with rich DAG edge metadata', () => {
    const dag = normalizeDag({
      sessionId: 'dag-test',
      nodes: [
        { id: 'REQ', title: 'Requirement', type: 'constraint' },
        { id: 'TASK', title: 'Task', type: 'task', requires: ['REQ'], priority: 'P2', labels: ['adapter'] },
      ],
      edges: [{ from: 'REQ', to: 'TASK', type: 'entails', blocking: false }],
    });
    const atoms = buildDagAtoms(dag);
    const graph = buildDagGraph(dag);

    expect(atoms.find(atom => atom.atomId === 'TASK')?.dependencies).toEqual(['REQ']);
    expect(atoms.find(atom => atom.atomId === 'TASK')?.content).toContain('AoT external ref: aot:dag-test:TASK');
    expect(graph.nodes.find(node => node.id === 'TASK')).toMatchObject({ title: 'Task', priority: 'P2' });
    expect(graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'REQ', target: 'TASK', relation: 'depends_on', blocking: true }),
      expect.objectContaining({ source: 'REQ', target: 'TASK', relation: 'entails', blocking: false }),
    ]));
  });

  it('formats external command failures as structured agent-readable payloads', () => {
    const result: CommandResult = {
      command: 'linear-cli',
      args: ['search', 'issues', 'aot:session:node'],
      status: 7,
      stdout: '',
      stderr: 'network unavailable',
      combined: '\nnetwork unavailable',
    };
    const payload = commandErrorPayload(result, 'dedupe failed');
    const error = new ExternalCommandError(payload);

    expect(errorToPayload(error)).toMatchObject({
      status: 'error',
      code: 'external_command_failed',
      command: 'linear-cli',
      exitCode: 7,
      message: 'dedupe failed',
      stderrHint: 'network unavailable',
    });
  });
});
