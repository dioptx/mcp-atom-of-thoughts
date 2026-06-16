import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GraphData } from '../types.js';
import { assertCommandOk, commandAvailable, firstJson } from './shell-json.js';

export type BrSyncOptions = {
  sessionId?: string;
  title?: string;
  dryRun?: boolean;
  db?: string;
  actor?: string;
  priority?: string;
  init?: boolean;
  command?: string;
  cwd?: string;
};

export interface BrSyncSummary {
  status: 'ok';
  sessionId: unknown;
  nodeCount: unknown;
  linkCount: unknown;
  createdCount: number;
  existingCount: number;
  dependencyCount: number;
}

function brCommand(options: BrSyncOptions = {}): string {
  if (options.command ?? process.env.AOT_BR_BIN) return options.command ?? process.env.AOT_BR_BIN ?? 'br';
  const fallback = path.join(os.homedir(), '.local/bin/br');
  return fs.existsSync(fallback) ? fallback : 'br';
}

export function brCommandAvailable(options: BrSyncOptions = {}): boolean {
  return commandAvailable(brCommand(options), ['--version']);
}

function brGlobalArgs(options: BrSyncOptions = {}): string[] {
  const global = ['--json'];
  if (options.db) global.push('--db', options.db);
  if (options.actor) global.push('--actor', options.actor);
  return global;
}

export function runBr(args: string[], options: BrSyncOptions = {}): unknown {
  const command = brCommand(options);
  const proc = spawnSync(command, [...brGlobalArgs(options), ...args], { encoding: 'utf8', cwd: options.cwd });
  const combined = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`;
  assertCommandOk({ command, args: [...brGlobalArgs(options), ...args], status: proc.status, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '', combined });
  return firstJson(combined);
}

export function ensureBrWorkspace(options: BrSyncOptions = {}): Record<string, unknown> {
  const command = brCommand(options);
  const where = spawnSync(command, [...brGlobalArgs(options), 'where'], { encoding: 'utf8', cwd: options.cwd });
  if (where.status === 0) {
    return { status: 'existing', details: firstJson(`${where.stdout ?? ''}\n${where.stderr ?? ''}`) };
  }
  if (options.init === false) {
    throw new Error(`No br/beads workspace found. Run br init or pass --brDb/--db. ${where.stdout}${where.stderr}`.trim());
  }

  const init = spawnSync(command, [...brGlobalArgs(options), 'init'], { encoding: 'utf8', cwd: options.cwd });
  const combined = `${init.stdout ?? ''}\n${init.stderr ?? ''}`;
  assertCommandOk({ command, args: [...brGlobalArgs(options), 'init'], status: init.status, stdout: init.stdout ?? '', stderr: init.stderr ?? '', combined });
  let details: unknown = combined.trim();
  try { details = firstJson(combined); } catch { /* br init may emit text even with --json */ }
  return { status: 'initialized', details };
}

export function summarizeBrSync(sync: Record<string, unknown>): BrSyncSummary {
  return {
    status: 'ok',
    sessionId: sync.sessionId,
    nodeCount: sync.nodeCount,
    linkCount: sync.linkCount,
    createdCount: Array.isArray(sync.created) ? sync.created.length : 0,
    existingCount: Array.isArray(sync.existing) ? sync.existing.length : 0,
    dependencyCount: Array.isArray(sync.dependencies) ? sync.dependencies.length : 0,
  };
}

export function syncGraphToBr(graph: GraphData, sessionId: string, options: BrSyncOptions = {}): Record<string, unknown> {
  const workspace = options.dryRun ? { status: 'dry-run' } : ensureBrWorkspace(options);
  const existingList = options.dryRun ? [] : (runBr(['list'], options) as Array<Record<string, unknown>>);
  const existingByRef = new Map<string, Record<string, unknown>>();
  for (const issue of existingList) {
    const ref = String(issue.external_ref ?? '');
    if (ref.startsWith('aot:')) existingByRef.set(ref, issue);
  }

  const issueByAtom = new Map<string, string>();
  const created: unknown[] = [];
  const existing: unknown[] = [];
  for (const node of graph.nodes) {
    const ref = node.externalRef ?? `aot:${sessionId}:${node.id}`;
    const found = existingByRef.get(ref);
    if (found) {
      issueByAtom.set(node.id, String(found.id));
      existing.push({ atomId: node.id, issueId: found.id, externalRef: ref });
      continue;
    }

    const description = node.description ?? [
      node.content,
      '',
      `AoT atom: ${node.id}`,
      `type: ${node.type}`,
      `confidence: ${node.confidence}`,
      `session: ${sessionId}`,
    ].join('\n');
    const labels = Array.isArray(node.labels) && node.labels.length > 0
      ? node.labels.join(',')
      : `aot,atom,${node.type}`;
    const result = runBr([
      'create',
      node.title ?? `AoT ${node.id}: ${node.type}`,
      '--type', 'task',
      '--priority', node.priority ?? options.priority ?? 'P3',
      '--labels', labels,
      '--description', description,
      '--external-ref', ref,
      ...(options.dryRun ? ['--dry-run'] : []),
    ], options) as Record<string, unknown>;
    if (result.id) issueByAtom.set(node.id, String(result.id));
    else if (options.dryRun) issueByAtom.set(node.id, `DRY:${node.id}`);
    created.push({ atomId: node.id, issueId: result.id, externalRef: ref, dryRun: Boolean(options.dryRun) });
  }

  const dependencies: unknown[] = [];
  for (const link of graph.links) {
    const dependent = issueByAtom.get(link.target);
    const dependency = issueByAtom.get(link.source);
    if (!dependent || !dependency) continue;
    const relation = link.relation ?? 'blocks';
    const depType = link.blocking === false ? relation : (relation === 'depends_on' || relation === 'requires' ? 'blocks' : relation);
    if (options.dryRun) {
      dependencies.push({ from: link.source, to: link.target, relation, type: depType, dryRun: true, dependent, dependency });
      continue;
    }
      const result = runBr([
        'dep', 'add', dependent, dependency,
        '--type', depType,
        '--metadata', JSON.stringify({ source: 'aot', sessionId, from: link.source, to: link.target, relation, blocking: link.blocking !== false, description: link.description }),
      ], options);
      dependencies.push({ from: link.source, to: link.target, relation, type: depType, result });
  }

  return { sessionId, nodeCount: graph.nodes.length, linkCount: graph.links.length, created, existing, dependencies, dryRun: Boolean(options.dryRun), workspace };
}
