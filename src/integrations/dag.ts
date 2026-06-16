import { spawnSync } from 'node:child_process';
import type { AtomType, GraphData, GraphLink, GraphNode } from '../types.js';
import { assertCommandOk, commandAvailable, firstJson, runCommand } from './shell-json.js';

export type DagRelation =
  | 'depends_on'
  | 'requires'
  | 'blocks'
  | 'blocked_by'
  | 'constrains'
  | 'constrained_by'
  | 'entails'
  | 'entailed_by'
  | 'parent_child'
  | 'related';

export interface DagNodeInput {
  id: string;
  title?: string;
  content?: string;
  body?: string;
  type?: string;
  atomType?: AtomType;
  confidence?: number;
  verified?: boolean;
  priority?: string;
  labels?: string[];
  dependencies?: string[];
  dependsOn?: string[];
  requires?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
  entailments?: string[];
  linearId?: string;
  metadata?: Record<string, unknown>;
}

export interface DagEdgeInput {
  from: string;
  to: string;
  type?: DagRelation | string;
  relation?: DagRelation | string;
  description?: string;
  blocking?: boolean;
}

export interface DagInput {
  title?: string;
  sessionId?: string;
  nodes: DagNodeInput[];
  edges?: DagEdgeInput[];
  constraints?: string[];
  metadata?: Record<string, unknown>;
}

export interface NormalizedDagEdge {
  from: string;
  to: string;
  relation: DagRelation | string;
  dependency: string;
  dependent: string;
  blocking: boolean;
  description?: string;
}

export interface NormalizedDagNode extends DagNodeInput {
  title: string;
  content: string;
  atomType: AtomType;
  dependencies: string[];
  constraints: string[];
  entailments: string[];
  labels: string[];
  confidence: number;
  verified: boolean;
}

export interface NormalizedDag {
  title: string;
  sessionId: string;
  nodes: NormalizedDagNode[];
  edges: NormalizedDagEdge[];
  constraints: string[];
  metadata: Record<string, unknown>;
}

export interface DagAtomPayload {
  tool: 'AoT-fast' | 'AoT-full';
  atomId: string;
  atomType: AtomType;
  content: string;
  dependencies: string[];
  confidence: number;
  isVerified: boolean;
  sessionId?: string;
}

export interface GitDagContext {
  available: boolean;
  cwd?: string;
  root?: string;
  branch?: string;
  head?: string;
  dirtyCount?: number;
  linearIssue?: unknown;
}

export interface LinearDagOptions {
  command?: string;
  cwd?: string;
  dryRun?: boolean;
  team?: string;
  state?: string;
  assignee?: string;
  priority?: number;
  labels?: string[];
  profile?: string;
}

const BLOCKING_RELATIONS = new Set(['depends_on', 'requires', 'blocks', 'blocked_by', 'parent_child']);
const DEPENDENT_TO_DEPENDENCY = new Set(['depends_on', 'requires', 'constrained_by', 'blocked_by', 'entailed_by']);

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asAtomType(node: DagNodeInput): AtomType {
  if (node.atomType) return node.atomType;
  switch ((node.type ?? '').toLowerCase()) {
    case 'premise':
    case 'constraint':
    case 'fact':
      return 'premise';
    case 'hypothesis':
    case 'risk':
      return 'hypothesis';
    case 'verification':
    case 'validation':
    case 'test':
      return 'verification';
    case 'conclusion':
    case 'decision':
      return 'conclusion';
    default:
      return 'reasoning';
  }
}

function normalizeRelation(value?: string): DagRelation | string {
  const relation = (value ?? 'depends_on').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (relation === 'dependency' || relation === 'depends') return 'depends_on';
  if (relation === 'require') return 'requires';
  if (relation === 'constraint') return 'constrains';
  if (relation === 'entailment') return 'entails';
  if (relation === 'parent' || relation === 'child' || relation === 'parent_child') return 'parent_child';
  return relation;
}

function normalizeEdge(edge: DagEdgeInput): NormalizedDagEdge {
  const relation = normalizeRelation(edge.type ?? edge.relation);
  const blocking = edge.blocking ?? BLOCKING_RELATIONS.has(relation);
  const dependentFirst = DEPENDENT_TO_DEPENDENCY.has(relation);
  const dependency = dependentFirst ? edge.to : edge.from;
  const dependent = dependentFirst ? edge.from : edge.to;
  return {
    from: edge.from,
    to: edge.to,
    relation,
    dependency,
    dependent,
    blocking,
    description: edge.description,
  };
}

export function normalizeDag(input: DagInput, fallbackSessionId = 'default'): NormalizedDag {
  const constraints = input.constraints ?? [];
  const explicitEdges = (input.edges ?? []).map(normalizeEdge);
  const nodeEdges = input.nodes.flatMap((node): NormalizedDagEdge[] => {
    const depIds = [...(node.dependencies ?? []), ...(node.dependsOn ?? []), ...(node.requires ?? [])];
    return depIds.map(depId => normalizeEdge({ from: node.id, to: depId, type: 'depends_on' }));
  });
  const edges = [...explicitEdges, ...nodeEdges];

  const nodes = input.nodes.map((node): NormalizedDagNode => {
    const incomingConstraints = edges
      .filter(edge => edge.relation === 'constrains' && edge.dependent === node.id)
      .map(edge => edge.description ? `${edge.dependency}: ${edge.description}` : edge.dependency);
    const incomingEntailments = edges
      .filter(edge => edge.relation === 'entails' && edge.dependent === node.id)
      .map(edge => edge.description ? `${edge.dependency}: ${edge.description}` : edge.dependency);
    const blockingDeps = edges
      .filter(edge => edge.blocking && edge.dependent === node.id)
      .map(edge => edge.dependency);
    const title = node.title ?? node.id;
    return {
      ...node,
      title,
      content: node.content ?? node.body ?? title,
      atomType: asAtomType(node),
      dependencies: unique(blockingDeps),
      constraints: unique([...(node.constraints ?? []), ...incomingConstraints]),
      entailments: unique([...(node.entailments ?? []), ...incomingEntailments]),
      labels: unique(['aot', 'dag', ...(node.labels ?? []), node.type ? String(node.type) : 'task']),
      confidence: node.confidence ?? 0.7,
      verified: node.verified ?? false,
    };
  });

  return {
    title: input.title ?? 'AoT DAG',
    sessionId: input.sessionId ?? fallbackSessionId,
    nodes,
    edges,
    constraints,
    metadata: input.metadata ?? {},
  };
}

function renderNodeContent(node: NormalizedDagNode, dag: NormalizedDag, git?: GitDagContext): string {
  const externalRef = dagExternalRef(dag, node.id);
  const lines = [node.content, '', `AoT external ref: ${externalRef}`];
  if (node.constraints.length > 0) lines.push('', 'Constraints:', ...node.constraints.map(item => `- ${item}`));
  if (node.entailments.length > 0) lines.push('', 'Entailments:', ...node.entailments.map(item => `- ${item}`));
  if (node.acceptanceCriteria && node.acceptanceCriteria.length > 0) {
    lines.push('', 'Acceptance criteria:', ...node.acceptanceCriteria.map(item => `- ${item}`));
  }
  if (dag.constraints.length > 0) lines.push('', 'DAG constraints:', ...dag.constraints.map(item => `- ${item}`));
  if (git?.branch || git?.head) {
    lines.push('', 'Git context:');
    if (git.branch) lines.push(`- branch: ${git.branch}`);
    if (git.head) lines.push(`- head: ${git.head}`);
    if (git.root) lines.push(`- root: ${git.root}`);
  }
  if (node.metadata && Object.keys(node.metadata).length > 0) {
    lines.push('', 'Metadata:', '```json', JSON.stringify(node.metadata, null, 2), '```');
  }
  return lines.join('\n');
}

function dagExternalRef(dag: NormalizedDag, nodeId: string): string {
  return `aot:${dag.sessionId}:${nodeId}`;
}

export function buildDagAtoms(dag: NormalizedDag, options: { tool?: 'AoT-fast' | 'AoT-full'; git?: GitDagContext } = {}): DagAtomPayload[] {
  return dag.nodes.map(node => ({
    tool: options.tool ?? 'AoT-full',
    atomId: node.id,
    atomType: node.atomType,
    content: renderNodeContent(node, dag, options.git),
    dependencies: node.dependencies,
    confidence: node.confidence,
    isVerified: node.verified,
    sessionId: dag.sessionId,
  }));
}

type RichGraphNode = GraphNode & {
  title?: string;
  labels?: string[];
  priority?: string;
  description?: string;
  externalRef?: string;
  linearId?: string;
};

type RichGraphLink = GraphLink & {
  relation?: string;
  blocking?: boolean;
  description?: string;
};

export function buildDagGraph(dag: NormalizedDag, options: { git?: GitDagContext } = {}): GraphData {
  const nodes = dag.nodes.map((node): RichGraphNode => ({
    id: node.id,
    type: node.atomType,
    content: node.content,
    confidence: node.confidence,
    depth: 0,
    isVerified: node.verified,
    title: node.title,
    labels: node.labels,
    priority: node.priority,
    externalRef: dagExternalRef(dag, node.id),
    linearId: node.linearId,
    description: renderNodeContent(node, dag, options.git),
  }));
  const links = dag.edges.map((edge): RichGraphLink => ({
    source: edge.dependency,
    target: edge.dependent,
    relation: edge.relation,
    blocking: edge.blocking,
    description: edge.description,
  }));
  return { title: dag.title, nodes, links };
}

function git(args: string[], cwd?: string): string | undefined {
  const proc = spawnSync('git', args, { encoding: 'utf8', cwd });
  return proc.status === 0 ? proc.stdout.trim() : undefined;
}

export function collectGitDagContext(cwd?: string, includeLinearContext = true): GitDagContext {
  if (!commandAvailable('git', ['--version'])) return { available: false, cwd };
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const branch = git(['branch', '--show-current'], cwd);
  const head = git(['rev-parse', '--short', 'HEAD'], cwd);
  const status = git(['status', '--short'], cwd);
  let linearIssue: unknown;
  if (includeLinearContext && linearCommandAvailable()) {
    const result = runCommand(linearCommand(), ['--output', 'json', '--compact', 'context'], undefined, cwd);
    if (result.status === 0) {
      try { linearIssue = firstJson(result.combined); } catch { linearIssue = result.stdout.trim(); }
    }
  }
  return {
    available: true,
    cwd,
    root,
    branch,
    head,
    dirtyCount: status ? status.split('\n').filter(Boolean).length : 0,
    linearIssue,
  };
}

function linearCommand(command?: string): string {
  if (command ?? process.env.AOT_LINEAR_BIN) return command ?? process.env.AOT_LINEAR_BIN ?? 'linear-cli';
  return commandAvailable('linear-cli', ['--version']) ? 'linear-cli' : 'linear';
}

export function linearCommandAvailable(command?: string): boolean {
  return commandAvailable(linearCommand(command), ['--version']);
}

function linearGlobalArgs(options: LinearDagOptions): string[] {
  const args = ['--output', 'json', '--compact'];
  if (options.profile) args.push('--profile', options.profile);
  return args;
}

function linearIssueId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  return String(record.identifier ?? record.id ?? record.key ?? '') || undefined;
}

function linearIssueCandidates(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['issues', 'results', 'nodes', 'data']) {
    const value = record[key];
    const candidates = linearIssueCandidates(value);
    if (candidates.length > 0) return candidates;
  }
  return [record];
}

function issueContainsRef(issue: Record<string, unknown>, externalRef: string): boolean {
  return JSON.stringify(issue).includes(externalRef);
}

function findExistingLinearIssue(command: string, dag: NormalizedDag, node: NormalizedDagNode, options: LinearDagOptions): Record<string, unknown> | undefined {
  const externalRef = dagExternalRef(dag, node.id);
  const args = [...linearGlobalArgs(options), 'search', 'issues', externalRef, '--limit', '10'];
  const result = runCommand(command, args, undefined, options.cwd);
  assertCommandOk(result, `Linear dedupe search failed for ${externalRef}; refusing to create a possible duplicate`);
  const payload = firstJson(result.combined);
  return linearIssueCandidates(payload).find(issue => issueContainsRef(issue, externalRef));
}

function linearRelationExists(command: string, from: string, to: string, relation: string, options: LinearDagOptions): boolean {
  const result = runCommand(command, [...linearGlobalArgs(options), 'relations', 'list', from], undefined, options.cwd);
  assertCommandOk(result, `Linear relation dedupe check failed for ${from} -> ${to}`);
  const payload = firstJson(result.combined);
  return JSON.stringify(payload).includes(to) && JSON.stringify(payload).toLowerCase().includes(relation.toLowerCase());
}

export function syncDagToLinear(dag: NormalizedDag, options: LinearDagOptions = {}): Record<string, unknown> {
  const command = linearCommand(options.command);
  if (!options.dryRun && !linearCommandAvailable(command)) return { status: 'skipped', reason: 'linear-cli command not found' };

  const issueByNode = new Map<string, string>();
  const created: unknown[] = [];
  for (const node of dag.nodes) {
    if (node.linearId) {
      issueByNode.set(node.id, node.linearId);
      created.push({ nodeId: node.id, issueId: node.linearId, existing: true });
      continue;
    }
    const externalRef = dagExternalRef(dag, node.id);
    const description = renderNodeContent(node, dag);
    if (!options.dryRun) {
      const existingIssue = findExistingLinearIssue(command, dag, node, options);
      const existingIssueId = existingIssue ? linearIssueId(existingIssue) : undefined;
      if (existingIssueId) {
        issueByNode.set(node.id, existingIssueId);
        created.push({ nodeId: node.id, issueId: existingIssueId, externalRef, existing: true, payload: existingIssue });
        continue;
      }
    }
    const args = [
      ...linearGlobalArgs(options),
      'issues', 'create', node.title,
      '--description', '-',
      '--labels', unique([...(options.labels ?? []), ...node.labels]).join(','),
    ];
    if (options.team) args.push('--team', options.team);
    if (options.state) args.push('--state', options.state);
    if (options.assignee) args.push('--assignee', options.assignee);
    if (options.priority !== undefined) args.push('--priority', String(options.priority));
    if (options.dryRun) args.push('--dry-run');
    if (options.dryRun) {
      issueByNode.set(node.id, `NEW:${node.id}`);
      created.push({ nodeId: node.id, externalRef, planned: [command, ...args], stdinBytes: Buffer.byteLength(description, 'utf8') });
      continue;
    }
    const result = runCommand(command, args, undefined, options.cwd, description);
    assertCommandOk(result);
    const payload = firstJson(result.combined);
    const issueId = linearIssueId(payload);
    if (issueId) issueByNode.set(node.id, issueId);
    created.push({ nodeId: node.id, issueId, payload });
  }

  const relations: unknown[] = [];
  for (const edge of dag.edges) {
    const from = issueByNode.get(edge.dependency);
    const to = issueByNode.get(edge.dependent);
    if (!from || !to) continue;
    const relation = edge.blocking ? 'blocks' : 'related';
    const args = [...linearGlobalArgs(options), 'relations', 'add', '--relation', relation, from, to];
    if (options.dryRun) args.push('--dry-run');
    if (options.dryRun) {
      relations.push({ from: edge.dependency, to: edge.dependent, relation, planned: [command, ...args] });
      continue;
    }
    if (linearRelationExists(command, from, to, relation, options)) {
      relations.push({ from: edge.dependency, to: edge.dependent, relation, existing: true, issueIds: { from, to } });
      continue;
    }
    const result = runCommand(command, args, undefined, options.cwd);
    assertCommandOk(result);
    relations.push({ from: edge.dependency, to: edge.dependent, relation, payload: firstJson(result.combined) });
  }

  return { status: 'ok', dryRun: Boolean(options.dryRun), created, relations };
}

export function summarizeDag(dag: NormalizedDag): Record<string, unknown> {
  return {
    title: dag.title,
    sessionId: dag.sessionId,
    nodeCount: dag.nodes.length,
    edgeCount: dag.edges.length,
    blockingEdgeCount: dag.edges.filter(edge => edge.blocking).length,
    constraintEdgeCount: dag.edges.filter(edge => String(edge.relation).includes('constrain')).length,
    entailmentEdgeCount: dag.edges.filter(edge => String(edge.relation).includes('entail')).length,
  };
}
