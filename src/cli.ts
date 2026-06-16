#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Cli, z } from 'incur';
import { AtomOfThoughtsServer, type AtomServerSnapshot } from './atom-server.js';
import { AtomOfThoughtsLightServer } from './atom-light-server.js';
import { exportGraph } from './graph-export.js';
import { getAllTools } from './tools.js';
import { brCommandAvailable, summarizeBrSync, syncGraphToBr, type BrSyncOptions } from './integrations/br.js';
import { bvCommandAvailable, runBvRobot, summarizeBvRobot, type BvRobotCommand } from './integrations/bv.js';
import { buildDagAtoms, buildDagGraph, collectGitDagContext, normalizeDag, summarizeDag, syncDagToLinear } from './integrations/dag.js';
import { pexCommandAvailable, runPexBundle } from './integrations/pex.js';
import { errorToPayload } from './integrations/shell-json.js';

const VERSION = '3.1.0';
const OUTPUT_SCHEMA_VERSION = 'aot.cli.pipeline.v1';
const SERVER_BIN = process.env.AOT_SERVER_BIN ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');
const STATE_PATH = process.env.AOT_STATE ?? path.join(os.homedir(), '.local/state/aot-cli/state.json');

type ToolName = 'AoT-fast' | 'AoT-full' | 'atomcommands';
type AutoBeadsOptions = {
  sessionId?: string;
  beads?: boolean;
  noBeads?: boolean;
  brDb?: string;
  brActor?: string;
  brPriority?: string;
  brCwd?: string;
  noBrInit?: boolean;
};

const AtomType = z.enum(['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion']);
const TypeAlias = z.enum(['p', 'premise', 'r', 'reason', 'reasoning', 'h', 'hypothesis', 'v', 'verify', 'verification', 'c', 'conclude', 'conclusion']);
const ToolNameSchema = z.enum(['AoT-fast', 'AoT-full', 'atomcommands']);
const BvRobotCommandSchema = z.enum(['triage', 'insights', 'plan', 'priority', 'next', 'alerts', 'metrics', 'label-health', 'label-attention', 'suggest']);

const AtomPayload = z.object({
  atomId: z.string().describe('Unique atom identifier, e.g. P1, R1, H1, V1, C1'),
  atomType: AtomType.describe('Atom type'),
  content: z.string().describe('Thought content'),
  dependencies: z.array(z.string()).default([]).describe('Atom IDs this atom depends on'),
  confidence: z.number().min(0).max(1).default(0.7).describe('Confidence from 0 to 1'),
  isVerified: z.boolean().default(false).describe('Whether the atom is verified'),
  depth: z.number().optional().describe('Optional depth override'),
  sessionId: z.string().optional().describe('Target session'),
});
const BatchAtomPayload = AtomPayload.extend({
  tool: z.enum(['AoT-fast', 'AoT-full']).default('AoT-fast').describe('Tool used for this atom'),
});
const DagNodePayload = z.object({
  id: z.string().describe('Stable DAG node/atom ID'),
  title: z.string().optional().describe('Human issue title'),
  content: z.string().optional().describe('Task or issue body'),
  body: z.string().optional().describe('Alias for content'),
  type: z.string().optional().describe('Task kind: task, constraint, risk, validation, decision, etc.'),
  atomType: AtomType.optional().describe('Explicit AoT atom type override'),
  confidence: z.number().min(0).max(1).optional(),
  verified: z.boolean().optional(),
  priority: z.string().optional().describe('br priority, e.g. P1/P2/P3'),
  labels: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional().describe('Prerequisite node IDs'),
  dependsOn: z.array(z.string()).optional().describe('Prerequisite node IDs'),
  requires: z.array(z.string()).optional().describe('Prerequisite node IDs'),
  constraints: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  entailments: z.array(z.string()).optional(),
  linearId: z.string().optional().describe('Existing Linear identifier, e.g. ABC-123'),
  metadata: z.record(z.string(), z.any()).optional(),
});
const DagPayload = z.object({
  title: z.string().optional(),
  sessionId: z.string().optional(),
  nodes: z.array(DagNodePayload).min(1),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    type: z.string().optional().describe('depends_on/requires/blocks/constrains/entails/related'),
    relation: z.string().optional().describe('Alias for type'),
    description: z.string().optional(),
    blocking: z.boolean().optional().describe('Override whether this edge blocks execution'),
  })).optional(),
  constraints: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const AnyOutput = z.record(z.string(), z.any());

function pipelineMeta(pipeline: string): Record<string, unknown> {
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    runId: randomUUID(),
    generatedAt: new Date().toISOString(),
    pipeline,
  };
}
const StateOutput = z.object({
  statePath: z.string(),
  activeSessionId: z.string(),
  maxDepth: z.number(),
  sessions: z.array(z.object({
    id: z.string(),
    status: z.string(),
    atomCount: z.number(),
    createdAt: z.number(),
  })),
});

function normalizeType(type: z.infer<typeof TypeAlias>): z.infer<typeof AtomType> {
  switch (type) {
    case 'p': return 'premise';
    case 'r':
    case 'reason': return 'reasoning';
    case 'h': return 'hypothesis';
    case 'v':
    case 'verify': return 'verification';
    case 'c':
    case 'conclude': return 'conclusion';
    default: return type;
  }
}

function normalizeConfidence(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value;
}

function parseDeps(value?: string): string[] {
  return value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
}

function shouldAutoCreateBeads(options: AutoBeadsOptions = {}): boolean {
  if (options.noBeads) return false;
  if (options.beads !== undefined) return options.beads;
  return process.env.AOT_BR_AUTO !== '0';
}

function brOptionsFromAuto(options: AutoBeadsOptions = {}): BrSyncOptions {
  return {
    sessionId: options.sessionId,
    db: options.brDb ?? process.env.AOT_BR_DB,
    actor: options.brActor ?? process.env.AOT_BR_ACTOR,
    priority: options.brPriority ?? process.env.AOT_BR_PRIORITY,
    cwd: options.brCwd ?? process.env.AOT_BR_CWD,
    init: !options.noBrInit && process.env.AOT_BR_INIT !== '0',
  };
}

function makeServer(): AtomOfThoughtsServer {
  const server = new AtomOfThoughtsServer(5);
  if (!fs.existsSync(STATE_PATH)) return server;

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Partial<AtomServerSnapshot>;
  server.importState(state);
  return server;
}

function saveServer(server: AtomOfThoughtsServer): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    version: 1,
    ...server.exportState(),
  }, null, 2) + '\n');
}

function parseToolText(result: { content: Array<{ type: string; text: string }> }): unknown {
  const text = result.content.find(c => c.type === 'text')?.text ?? '';
  try { return JSON.parse(text); } catch { return { text }; }
}

function readJsonArg(value: string): unknown {
  const raw = value === '-'
    ? fs.readFileSync(0, 'utf8')
    : value.startsWith('@')
      ? fs.readFileSync(value.slice(1), 'utf8')
      : value;
  return JSON.parse(raw);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withStateLock<T>(fn: () => T): T {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const lockPath = `${STATE_PATH}.lock`;
  const deadline = Date.now() + 5000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline) {
        throw error;
      }
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
  }
}

function withoutTrace<T>(enabled: boolean | undefined, fn: () => T): T {
  if (enabled) return fn();
  const original = console.error;
  console.error = () => undefined;
  try { return fn(); } finally { console.error = original; }
}

function processAtomOnServer(server: AtomOfThoughtsServer, tool: Exclude<ToolName, 'atomcommands'>, payload: z.infer<typeof AtomPayload>, trace?: boolean): unknown {
  const target = tool === 'AoT-fast' ? new AtomOfThoughtsLightServer(3, server) : server;
  const result = withoutTrace(trace, () => target.processAtom(payload));
  return parseToolText(result);
}

function withBeadsResult(result: unknown, options: AutoBeadsOptions): unknown {
  if (!shouldAutoCreateBeads(options)) return result;
  const beads = maybeAutoCreateBeads(options);
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), beads };
  }
  return { result, beads };
}

function callAtom(tool: Exclude<ToolName, 'atomcommands'>, payload: z.infer<typeof AtomPayload>, trace?: boolean, beadsOptions: AutoBeadsOptions = {}): unknown {
  return withStateLock(() => {
    const server = makeServer();
    const result = processAtomOnServer(server, tool, payload, trace);
    saveServer(server);
    return withBeadsResult(result, { ...beadsOptions, sessionId: beadsOptions.sessionId ?? payload.sessionId });
  });
}

function callAtomBatch(items: Array<z.infer<typeof AtomPayload> & { tool?: Exclude<ToolName, 'atomcommands'> }>, trace?: boolean, beadsOptions: AutoBeadsOptions = {}): Record<string, unknown> {
  return withStateLock(() => {
    const server = makeServer();
    const results = items.map((item) => {
      const { tool = 'AoT-fast', ...payload } = item;
      return { tool, atomId: payload.atomId, result: processAtomOnServer(server, tool, payload, trace) };
    });
    saveServer(server);
    const result = { count: results.length, results };
    if (!shouldAutoCreateBeads(beadsOptions)) return result;
    return { ...result, beads: maybeAutoCreateBeads(beadsOptions) };
  });
}

function runAtomCommand(command: string, options: {
  atomId?: string;
  decompositionId?: string;
  maxDepth?: number;
  title?: string;
  sessionId?: string;
}): Record<string, unknown> {
  return withStateLock(() => {
  const server = makeServer();
  let result: Record<string, unknown>;

  switch (command) {
    case 'decompose':
      if (!options.atomId) throw new Error('atomId is required');
      result = { status: 'success', command, decompositionId: server.startDecomposition(options.atomId, options.sessionId) };
      break;
    case 'complete_decomposition':
      if (!options.decompositionId) throw new Error('decompositionId is required');
      result = { status: 'success', command, completed: server.completeDecomposition(options.decompositionId, options.sessionId) };
      break;
    case 'termination_status':
      result = { status: 'success', command, ...server.getTerminationStatus(options.sessionId) };
      break;
    case 'best_conclusion': {
      const conclusion = server.getBestConclusion(options.sessionId);
      result = { status: 'success', command, conclusion: conclusion ? { atomId: conclusion.atomId, content: conclusion.content, confidence: conclusion.confidence } : null };
      break;
    }
    case 'set_max_depth':
      if (!options.maxDepth) throw new Error('maxDepth is required');
      server.maxDepth = options.maxDepth;
      result = { status: 'success', command, maxDepth: server.maxDepth };
      break;
    case 'export':
      result = { status: 'success', command, graph: exportGraph(server.getAtoms(options.sessionId), server.getAtomOrder(options.sessionId), options.title) };
      break;
    case 'new_session':
      result = { status: 'success', command, sessionId: server.newSession(options.sessionId), activeSessionId: server.getActiveSessionId() };
      break;
    case 'switch_session':
      if (!options.sessionId) throw new Error('sessionId is required');
      server.switchSession(options.sessionId);
      result = { status: 'success', command, activeSessionId: server.getActiveSessionId() };
      break;
    case 'list_sessions':
      result = { status: 'success', command, activeSessionId: server.getActiveSessionId(), sessions: server.listSessions(), statePath: STATE_PATH };
      break;
    case 'reset_session':
      server.resetSession(options.sessionId);
      result = { status: 'success', command, sessionId: options.sessionId ?? server.getActiveSessionId() };
      break;
    default:
      throw new Error(`Unknown atomcommands command: ${command}`);
  }

  saveServer(server);
  return result;
  });
}

function passthrough(args: string[]): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(SERVER_BIN, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', exitCode => resolve({ exitCode }));
  });
}

function exportCurrentGraph(options: BrSyncOptions = {}): { graph: ReturnType<typeof exportGraph>; sessionId: string } {
  const server = makeServer();
  const sessionId = options.sessionId ?? server.getActiveSessionId();
  const graph = exportGraph(server.getAtoms(options.sessionId), server.getAtomOrder(options.sessionId), options.title);
  return { graph, sessionId };
}

function syncCurrentGraphToBr(options: BrSyncOptions = {}): Record<string, unknown> {
  const { graph, sessionId } = exportCurrentGraph(options);
  return syncGraphToBr(graph, sessionId, options);
}

function maybeAutoCreateBeads(options: AutoBeadsOptions = {}): Record<string, unknown> {
  if (!brCommandAvailable(brOptionsFromAuto(options))) return { status: 'skipped', reason: 'br command not found' };
  try {
    return summarizeBrSync(syncCurrentGraphToBr(brOptionsFromAuto(options))) as unknown as Record<string, unknown>;
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

const cli = Cli.create('aot', {
  version: VERSION,
  aliases: ['mcp-atom-of-thoughts-cli'],
  description: 'Native stateful CLI for Atom of Thoughts reasoning graphs with first-class br/beads sync, bv robot evaluation, and PEX retrieval seeding. Atom creation automatically creates/syncs br beads by default; set AOT_BR_AUTO=0 or pass --noBeads to disable. MCP server mode is opt-in via `aot server` or `aot --mcp`.',
  sync: {
    depth: 1,
    suggestions: [
      'use aot fast premise P1 "API returns 500" and inspect the created br bead',
      'use aot batch - to create a dependency graph of atoms and beads from JSON',
      'use aot dag @dag.json --dryRun --linear to encode dependencies, constraints, and entailments across AoT/br/Linear',
      'use aot bv triage --sync to evaluate the current AoT graph through bv robot',
      'use aot pex AP19B01 --topic "suxamethonium adverse effects" --toAtoms to seed examiner-grounded atoms',
      'export the current atom graph',
    ],
  },
});

cli.command('tools', {
  description: 'List available Atom of Thoughts tools without starting an MCP server.',
  output: z.object({ tools: z.array(z.any()) }),
  examples: [{ description: 'List tools' }],
  run() {
    return { tools: getAllTools() };
  },
});

for (const mode of ['fast', 'full'] as const) {
  cli.command(mode, {
    description: mode === 'fast' ? 'Add one shallow AoT atom to persistent CLI state.' : 'Add one full-depth AoT atom to persistent CLI state.',
    args: z.object({
      type: TypeAlias.describe('Atom type or shorthand: p/r/h/v/c'),
      atomId: z.string().describe('Atom ID, e.g. P1'),
      content: z.string().describe('Thought content'),
    }),
    options: z.object({
      deps: z.string().optional().describe('Comma-separated dependency atom IDs'),
      confidence: z.coerce.number().optional().describe('Confidence as 0-1 or 0-100'),
      verified: z.boolean().optional().describe('Mark atom verified'),
      sessionId: z.string().optional().describe('Target session ID'),
      trace: z.boolean().optional().describe('Show the upstream formatted atom stderr trace'),
      noBeads: z.boolean().optional().describe('Disable automatic br/beads issue creation for this atom'),
      brDb: z.string().optional().describe('br database path for automatic bead creation'),
      brActor: z.string().optional().describe('br actor for automatic bead creation'),
      brPriority: z.string().optional().describe('br priority for automatic bead creation, e.g. P2 or P3'),
      brCwd: z.string().optional().describe('Working directory for automatic br workspace discovery/init'),
      noBrInit: z.boolean().optional().describe('Do not auto-run br init when no beads workspace exists'),
    }),
    alias: { deps: 'd', confidence: 'c' },
    output: z.any(),
    examples: [
      { args: { type: 'premise', atomId: 'P1', content: 'API returns 500' }, options: { confidence: 0.9 }, description: 'Add a premise' },
      { args: { type: 'reasoning', atomId: 'R1', content: 'Handler likely throws' }, options: { deps: 'P1' }, description: 'Add dependent reasoning' },
    ],
    run({ args, options }) {
      return callAtom(mode === 'fast' ? 'AoT-fast' : 'AoT-full', {
        atomId: args.atomId,
        atomType: normalizeType(args.type),
        content: args.content,
        dependencies: parseDeps(options.deps),
        confidence: normalizeConfidence(options.confidence) ?? 0.7,
        isVerified: options.verified ?? false,
        sessionId: options.sessionId,
      }, options.trace, options);
    },
  });
}

cli.command('batch', {
  description: 'Create multiple atomic reasoning elements from a JSON array in one locked state transaction. Input may be raw JSON, @file, or - for stdin.',
  args: z.object({
    atoms: z.string().describe('JSON array, @file, or - for stdin'),
  }),
  options: z.object({
    trace: z.boolean().optional().describe('Show upstream formatted atom stderr trace'),
    noBeads: z.boolean().optional().describe('Disable automatic br/beads issue creation for this batch'),
    brDb: z.string().optional().describe('br database path for automatic bead creation'),
    brActor: z.string().optional().describe('br actor for automatic bead creation'),
    brPriority: z.string().optional().describe('br priority for automatic bead creation, e.g. P2 or P3'),
    brCwd: z.string().optional().describe('Working directory for automatic br workspace discovery/init'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init when no beads workspace exists'),
  }),
  output: AnyOutput,
  examples: [
    { args: { atoms: '[{"tool":"AoT-full","atomId":"P1","atomType":"premise","content":"API returns 500"}]' }, description: 'Create atoms from inline JSON' },
    { args: { atoms: '@atoms.json' }, description: 'Create atoms from a file' },
  ],
  run({ args, options }) {
    const parsed = z.array(BatchAtomPayload).parse(readJsonArg(args.atoms));
    return callAtomBatch(parsed, options.trace, options);
  },
});

cli.command('call', {
  description: 'Call an AoT tool natively with a JSON payload using persistent CLI state.',
  args: z.object({
    tool: ToolNameSchema.describe('AoT-fast, AoT-full, or atomcommands'),
    payload: z.string().describe('JSON payload, @file, or - for stdin'),
  }),
  options: z.object({
    noBeads: z.boolean().optional().describe('Disable automatic br/beads issue creation for AoT-fast/AoT-full calls'),
    brDb: z.string().optional().describe('br database path for automatic bead creation'),
    brActor: z.string().optional().describe('br actor for automatic bead creation'),
    brPriority: z.string().optional().describe('br priority for automatic bead creation, e.g. P2 or P3'),
    brCwd: z.string().optional().describe('Working directory for automatic br workspace discovery/init'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init when no beads workspace exists'),
  }),
  output: z.any(),
  examples: [
    { args: { tool: 'AoT-fast', payload: '{"atomId":"P1","atomType":"premise","content":"API returns 500"}' }, description: 'Call AoT-fast directly' },
  ],
  run({ args, options }) {
    const payload = readJsonArg(args.payload) as Record<string, unknown>;
    if (args.tool === 'atomcommands') {
      return runAtomCommand(String(payload.command), {
        atomId: payload.atomId as string | undefined,
        decompositionId: payload.decompositionId as string | undefined,
        maxDepth: payload.maxDepth as number | undefined,
        title: payload.title as string | undefined,
        sessionId: payload.sessionId as string | undefined,
      });
    }
    return callAtom(args.tool, AtomPayload.parse(payload), undefined, options);
  },
});

cli.command('cmd', {
  description: 'Run an atomcommands operation natively against persistent CLI state.',
  args: z.object({ command: z.string().describe('atomcommands command') }),
  options: z.object({
    atomId: z.string().optional().describe('Atom ID for decompose'),
    decompositionId: z.string().optional().describe('Decomposition ID for complete_decomposition'),
    maxDepth: z.coerce.number().optional().describe('New max depth for set_max_depth'),
    title: z.string().optional().describe('Title for export'),
    sessionId: z.string().optional().describe('Target session'),
  }),
  output: AnyOutput,
  examples: [
    { args: { command: 'termination_status' }, description: 'Check whether reasoning should terminate' },
    { args: { command: 'export' }, options: { title: 'Auth decision' }, description: 'Export the graph' },
  ],
  run({ args, options }) {
    return runAtomCommand(args.command, options);
  },
});

cli.command('status', {
  description: 'Show termination status for the active session.',
  output: AnyOutput,
  run() { return runAtomCommand('termination_status', {}); },
});

cli.command('export', {
  description: 'Export the active atom graph.',
  options: z.object({ title: z.string().optional().describe('Graph title'), sessionId: z.string().optional().describe('Session to export') }),
  output: AnyOutput,
  run({ options }) { return runAtomCommand('export', options); },
});

cli.command('br', {
  description: 'Sync the active AoT graph into a br/beads workspace as issues, using external_ref aot:<session>:<atomId> and br dependencies for atom dependencies.',
  options: z.object({
    sessionId: z.string().optional().describe('AoT session to sync'),
    title: z.string().optional().describe('Graph title used during export'),
    dryRun: z.boolean().optional().describe('Preview br creates without writing'),
    db: z.string().optional().describe('br database path'),
    actor: z.string().optional().describe('br audit actor'),
    priority: z.string().optional().describe('br priority, e.g. P2 or P3'),
    init: z.boolean().optional().describe('Auto-run br init when no beads workspace exists (default true)'),
    cwd: z.string().optional().describe('Working directory for br workspace discovery/init'),
  }),
  output: AnyOutput,
  examples: [
    { options: { dryRun: true }, description: 'Preview br issues for the active graph' },
    { options: { db: '.beads/project.db' }, description: 'Sync into an explicit br database' },
  ],
  run({ options }) { return syncCurrentGraphToBr(options); },
});

cli.command('bv', {
  description: 'Run bv robot analysis over the br/beads graph for the current AoT session, optionally syncing AoT atoms to br first.',
  args: z.object({ command: BvRobotCommandSchema.default('triage').describe('bv robot command: triage, insights, plan, priority, next, alerts, metrics, label-health, label-attention, suggest') }),
  options: z.object({
    db: z.string().optional().describe('bv/br database path or .beads directory'),
    format: z.enum(['json', 'toon']).default('json').describe('bv structured output format'),
    maxResults: z.coerce.number().optional().describe('Limit robot recommendations'),
    label: z.string().optional().describe('Scope bv analysis to a label subgraph'),
    minConfidence: z.coerce.number().optional().describe('Minimum confidence filter'),
    noCache: z.boolean().optional().describe('Bypass bv disk cache'),
    sync: z.boolean().optional().describe('Sync current AoT graph to br before running bv'),
    sessionId: z.string().optional().describe('AoT session to sync before bv'),
    brPriority: z.string().optional().describe('br priority used when --sync creates issues'),
    brActor: z.string().optional().describe('br actor used when --sync creates issues'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init during --sync'),
    cwd: z.string().optional().describe('Working directory for br/bv workspace discovery'),
  }),
  output: AnyOutput,
  examples: [
    { args: { command: 'triage' }, options: { sync: true, maxResults: 10 }, description: 'Sync AoT to br and get bv triage' },
    { args: { command: 'insights' }, options: { db: '.beads' }, description: 'Run bv insights on an explicit beads workspace' },
  ],
  run({ args, options }) {
    if (!bvCommandAvailable()) return { status: 'skipped', reason: 'bv command not found' };
    const sync = options.sync
      ? syncCurrentGraphToBr({ sessionId: options.sessionId, db: options.db, actor: options.brActor, priority: options.brPriority, init: !options.noBrInit, cwd: options.cwd })
      : undefined;
    const robot = runBvRobot(args.command as BvRobotCommand, {
      db: options.db,
      format: options.format,
      maxResults: options.maxResults,
      label: options.label,
      minConfidence: options.minConfidence,
      noCache: options.noCache,
      cwd: options.cwd,
    });
    return { status: 'ok', sync: sync ? summarizeBrSync(sync) : undefined, robotSummary: summarizeBvRobot(args.command as BvRobotCommand, robot), robot };
  },
});

cli.command('pex', {
  description: 'Run recursive PEX retrieval for an exam code/topic and optionally convert the PEX bundle into AoT atoms.',
  args: z.object({ target: z.string().describe('PEX exam code or topic, e.g. AP19B01 or 2019B01') }),
  options: z.object({
    topic: z.string().optional().describe('Topic phrase for pex brief/evidence/layers'),
    k: z.coerce.number().optional().describe('Evidence hit count'),
    layers: z.string().optional().describe('Comma-separated pex layers, default reports,texts,ontology'),
    noPipeline: z.boolean().optional().describe('Do not pass --pipeline to pex brief'),
    noRecursive: z.boolean().optional().describe('Do not pass --recursive to pex layer search'),
    noSourcegraph: z.boolean().optional().describe('Skip pex sourcegraph for exam-code targets'),
    collection: z.string().optional().describe('PEX collection override'),
    toAtoms: z.boolean().optional().describe('Create AoT atoms from the PEX bundle'),
    sessionId: z.string().optional().describe('AoT session for generated PEX atoms'),
    trace: z.boolean().optional().describe('Show upstream AoT trace when --toAtoms is used'),
    noBeads: z.boolean().optional().describe('Disable automatic br sync when --toAtoms is used'),
    brDb: z.string().optional().describe('br database path for --toAtoms automatic sync'),
    brActor: z.string().optional().describe('br actor for --toAtoms automatic sync'),
    brPriority: z.string().optional().describe('br priority for --toAtoms automatic sync'),
    brCwd: z.string().optional().describe('Working directory for --toAtoms br workspace discovery/init'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init for --toAtoms'),
  }),
  output: AnyOutput,
  examples: [
    { args: { target: 'AP19B01' }, options: { topic: 'suxamethonium adverse effects', toAtoms: true }, description: 'Retrieve PEX context and seed AoT atoms' },
  ],
  run({ args, options }) {
    if (!pexCommandAvailable()) return { status: 'skipped', reason: 'pex command not found' };
    const bundle = runPexBundle(args.target, {
      topic: options.topic,
      k: options.k,
      layers: options.layers ? parseDeps(options.layers) : undefined,
      pipeline: !options.noPipeline,
      recursive: !options.noRecursive,
      sourcegraph: !options.noSourcegraph,
      collection: options.collection,
    }, options.sessionId);
    const atomResult = options.toAtoms
      ? callAtomBatch(bundle.atoms, options.trace, options)
      : undefined;
    const okCalls = bundle.calls.filter(call => call.ok).length;
    return { ...pipelineMeta('pex'), status: 'ok', target: bundle.target, pexTarget: bundle.pexTarget, topic: bundle.topic, callCount: bundle.calls.length, okCalls, calls: bundle.calls, atoms: options.toAtoms ? atomResult : bundle.atoms };
  },
});

cli.command('prep', {
  description: 'Automated exam-prep pipeline: PEX retrieval -> AoT seed atoms -> br sync -> bv robot evaluation.',
  args: z.object({ target: z.string().describe('PEX exam code or topic, e.g. AP19B01 or 2019B01') }),
  options: z.object({
    topic: z.string().optional().describe('Topic phrase for pex brief/evidence/layers'),
    sessionId: z.string().optional().describe('AoT session for generated atoms'),
    k: z.coerce.number().optional().describe('PEX evidence hit count'),
    layers: z.string().optional().describe('Comma-separated PEX layers, default reports,texts,ontology'),
    noPipeline: z.boolean().optional().describe('Do not pass --pipeline to pex brief'),
    noRecursive: z.boolean().optional().describe('Do not pass --recursive to pex layer search'),
    noSourcegraph: z.boolean().optional().describe('Skip pex sourcegraph for exam-code targets'),
    collection: z.string().optional().describe('PEX collection override'),
    trace: z.boolean().optional().describe('Show upstream AoT trace'),
    noBr: z.boolean().optional().describe('Skip br sync'),
    noBv: z.boolean().optional().describe('Skip bv robot evaluation'),
    brDb: z.string().optional().describe('br database path'),
    brActor: z.string().optional().describe('br actor'),
    brPriority: z.string().optional().describe('br priority for generated atom issues'),
    brCwd: z.string().optional().describe('Working directory for br workspace discovery/init'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init'),
    bvCommand: BvRobotCommandSchema.default('triage').describe('bv robot command to run after sync'),
    maxResults: z.coerce.number().optional().describe('Limit bv robot recommendations'),
  }),
  output: AnyOutput,
  examples: [
    { args: { target: 'AP19B01' }, options: { topic: 'suxamethonium adverse effects' }, description: 'Run full exam-prep pipeline' },
  ],
  run({ args, options }) {
    if (!pexCommandAvailable()) return { status: 'skipped', reason: 'pex command not found' };
    const bundle = runPexBundle(args.target, {
      topic: options.topic,
      k: options.k,
      layers: options.layers ? parseDeps(options.layers) : undefined,
      pipeline: !options.noPipeline,
      recursive: !options.noRecursive,
      sourcegraph: !options.noSourcegraph,
      collection: options.collection,
    }, options.sessionId);
    const atomResult = callAtomBatch(bundle.atoms, options.trace, { noBeads: true });
    const br = options.noBr ? undefined : syncCurrentGraphToBr({
      sessionId: options.sessionId,
      db: options.brDb,
      actor: options.brActor,
      priority: options.brPriority,
      cwd: options.brCwd,
      init: !options.noBrInit,
    });
    const bv = options.noBv ? undefined : runBvRobot(options.bvCommand as BvRobotCommand, {
      db: options.brDb,
      cwd: options.brCwd,
      maxResults: options.maxResults,
    });
    return {
      ...pipelineMeta('prep'),
      status: 'ok',
      target: bundle.target,
      pexTarget: bundle.pexTarget,
      topic: bundle.topic,
      pex: { callCount: bundle.calls.length, okCalls: bundle.calls.filter(call => call.ok).length, calls: bundle.calls },
      atoms: atomResult,
      br: br ? summarizeBrSync(br) : undefined,
      bv: bv ? summarizeBvRobot(options.bvCommand as BvRobotCommand, bv) : undefined,
      bvRaw: bv,
    };
  },
});

cli.command('plan', {
  description: 'Automated planning pipeline: JSON atoms -> AoT state -> br dependency graph -> bv robot triage.',
  args: z.object({ atoms: z.string().describe('JSON atom array, @file, or - for stdin') }),
  options: z.object({
    trace: z.boolean().optional().describe('Show upstream AoT trace'),
    sessionId: z.string().optional().describe('AoT session to sync/evaluate'),
    noBr: z.boolean().optional().describe('Skip br sync'),
    noBv: z.boolean().optional().describe('Skip bv robot evaluation'),
    brDb: z.string().optional().describe('br database path'),
    brActor: z.string().optional().describe('br actor'),
    brPriority: z.string().optional().describe('br priority for generated atom issues'),
    brCwd: z.string().optional().describe('Working directory for br workspace discovery/init'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init'),
    bvCommand: BvRobotCommandSchema.default('triage').describe('bv robot command to run after sync'),
    maxResults: z.coerce.number().optional().describe('Limit bv robot recommendations'),
  }),
  output: AnyOutput,
  examples: [
    { args: { atoms: '@atoms.json' }, description: 'Create a plan, sync it to br, and evaluate with bv' },
  ],
  run({ args, options }) {
    const parsed = z.array(BatchAtomPayload).parse(readJsonArg(args.atoms));
    const items = options.sessionId
      ? parsed.map(atom => ({ ...atom, sessionId: atom.sessionId ?? options.sessionId }))
      : parsed;
    const atomResult = callAtomBatch(items, options.trace, { noBeads: true, sessionId: options.sessionId });
    const br = options.noBr ? undefined : syncCurrentGraphToBr({
      sessionId: options.sessionId,
      db: options.brDb,
      actor: options.brActor,
      priority: options.brPriority,
      cwd: options.brCwd,
      init: !options.noBrInit,
    });
    const bv = options.noBv ? undefined : runBvRobot(options.bvCommand as BvRobotCommand, {
      db: options.brDb,
      cwd: options.brCwd,
      maxResults: options.maxResults,
    });
    return {
      ...pipelineMeta('plan'),
      status: 'ok',
      atoms: atomResult,
      br: br ? summarizeBrSync(br) : undefined,
      bv: bv ? summarizeBvRobot(options.bvCommand as BvRobotCommand, bv) : undefined,
      bvRaw: bv,
    };
  },
});

cli.command('dag', {
  description: 'Encode a nuanced task/issue DAG with constraints, dependencies, and entailments through AoT atoms, git context, br dependencies, optional Linear relations, and bv robot triage.',
  args: z.object({ dag: z.string().describe('DAG JSON object, @file, or - for stdin') }),
  options: z.object({
    dryRun: z.boolean().optional().describe('Preview AoT/br/Linear writes without mutating state or trackers'),
    trace: z.boolean().optional().describe('Show upstream AoT trace'),
    sessionId: z.string().optional().describe('Override AoT session ID'),
    tool: z.enum(['AoT-fast', 'AoT-full']).default('AoT-full').describe('AoT tool used for generated atoms'),
    noAot: z.boolean().optional().describe('Skip creating AoT atoms'),
    noGit: z.boolean().optional().describe('Skip git/Linear branch context capture'),
    noBr: z.boolean().optional().describe('Skip br issue/dependency sync'),
    noBv: z.boolean().optional().describe('Skip bv robot evaluation'),
    linear: z.boolean().optional().describe('Also create/sync Linear issues and relations via linear-cli'),
    linearTeam: z.string().optional().describe('Linear team key/name for new issues'),
    linearState: z.string().optional().describe('Linear state for new issues'),
    linearAssignee: z.string().optional().describe('Linear assignee for new issues, e.g. me'),
    linearPriority: z.coerce.number().optional().describe('Linear priority: 1 urgent, 2 high, 3 normal, 4 low'),
    linearLabels: z.string().optional().describe('Comma-separated extra Linear labels'),
    linearProfile: z.string().optional().describe('linear-cli profile'),
    linearBin: z.string().optional().describe('linear-cli binary override'),
    brDb: z.string().optional().describe('br database path'),
    brActor: z.string().optional().describe('br actor'),
    brPriority: z.string().optional().describe('Default br priority for nodes without priority'),
    brCwd: z.string().optional().describe('Working directory for git/br/bv/Linear workspace discovery'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init'),
    bvCommand: BvRobotCommandSchema.default('triage').describe('bv robot command to run after br sync'),
    maxResults: z.coerce.number().optional().describe('Limit bv robot recommendations'),
    label: z.string().optional().describe('Scope bv analysis to a label'),
  }),
  output: AnyOutput,
  examples: [
    { args: { dag: '@dag.json' }, options: { dryRun: true, linear: true }, description: 'Preview AoT/br/Linear encoding for a rich DAG' },
  ],
  run({ args, options }) {
    const meta = pipelineMeta('dag');
    try {
      const parsed = DagPayload.parse(readJsonArg(args.dag));
      const dag = normalizeDag({ ...parsed, sessionId: options.sessionId ?? parsed.sessionId }, options.sessionId ?? 'default');
      const git = options.noGit ? undefined : collectGitDagContext(options.brCwd, true);
      const atoms = buildDagAtoms(dag, { tool: options.tool, git });
      const atomResult = options.noAot
        ? undefined
        : options.dryRun
          ? { status: 'dry-run', count: atoms.length, atoms }
          : callAtomBatch(atoms, options.trace, { noBeads: true, sessionId: dag.sessionId });
      const brGraph = buildDagGraph(dag, { git });
      const br = options.noBr ? undefined : syncGraphToBr(brGraph, dag.sessionId, {
        sessionId: dag.sessionId,
        dryRun: options.dryRun,
        db: options.brDb,
        actor: options.brActor,
        priority: options.brPriority,
        cwd: options.brCwd,
        init: !options.noBrInit,
      });
      const linear = options.linear ? syncDagToLinear(dag, {
        command: options.linearBin,
        cwd: options.brCwd,
        dryRun: options.dryRun,
        team: options.linearTeam,
        state: options.linearState,
        assignee: options.linearAssignee,
        priority: options.linearPriority,
        labels: options.linearLabels ? parseDeps(options.linearLabels) : undefined,
        profile: options.linearProfile,
      }) : undefined;
      const bv = options.noBv || options.dryRun ? undefined : runBvRobot(options.bvCommand as BvRobotCommand, {
        db: options.brDb,
        cwd: options.brCwd,
        maxResults: options.maxResults,
        label: options.label,
      });
      return {
        ...meta,
        status: 'ok',
        dryRun: Boolean(options.dryRun),
        dag: summarizeDag(dag),
        git,
        atoms: atomResult,
        br: br ? summarizeBrSync(br) : undefined,
        brRaw: br,
        linear,
        bv: bv ? summarizeBvRobot(options.bvCommand as BvRobotCommand, bv) : options.dryRun ? { status: 'skipped', reason: 'dry-run' } : undefined,
        bvRaw: bv,
      };
    } catch (error) {
      return { ...meta, status: 'error', dryRun: Boolean(options.dryRun), error: errorToPayload(error) };
    }
  },
});

cli.command('audit', {
  description: 'Automated evaluation pipeline: current AoT graph -> br sync -> bv robot analysis.',
  args: z.object({ command: BvRobotCommandSchema.default('triage').describe('bv robot command to run') }),
  options: z.object({
    sessionId: z.string().optional().describe('AoT session to sync/evaluate'),
    noSync: z.boolean().optional().describe('Run bv against existing br workspace without syncing AoT first'),
    brDb: z.string().optional().describe('br/bv database path'),
    brActor: z.string().optional().describe('br actor'),
    brPriority: z.string().optional().describe('br priority for generated atom issues'),
    brCwd: z.string().optional().describe('Working directory for br/bv workspace discovery'),
    noBrInit: z.boolean().optional().describe('Do not auto-run br init'),
    maxResults: z.coerce.number().optional().describe('Limit bv robot recommendations'),
    label: z.string().optional().describe('Scope bv analysis to a label'),
  }),
  output: AnyOutput,
  examples: [
    { args: { command: 'triage' }, description: 'Sync current AoT graph and evaluate next work' },
    { args: { command: 'insights' }, options: { noSync: true }, description: 'Analyze an existing br workspace' },
  ],
  run({ args, options }) {
    const br = options.noSync ? undefined : syncCurrentGraphToBr({
      sessionId: options.sessionId,
      db: options.brDb,
      actor: options.brActor,
      priority: options.brPriority,
      cwd: options.brCwd,
      init: !options.noBrInit,
    });
    const bv = runBvRobot(args.command as BvRobotCommand, {
      db: options.brDb,
      cwd: options.brCwd,
      maxResults: options.maxResults,
      label: options.label,
    });
    return {
      ...pipelineMeta('audit'),
      status: 'ok',
      br: br ? summarizeBrSync(br) : undefined,
      bv: summarizeBvRobot(args.command as BvRobotCommand, bv),
      bvRaw: bv,
    };
  },
});

cli.command('sessions', {
  description: 'List persistent AoT sessions.',
  output: StateOutput,
  run() {
    const result = runAtomCommand('list_sessions', {});
    return {
      statePath: STATE_PATH,
      activeSessionId: String(result.activeSessionId),
      maxDepth: makeServer().maxDepth,
      sessions: result.sessions as z.infer<typeof StateOutput>['sessions'],
    };
  },
});

cli.command('new', {
  description: 'Create and switch to a new session.',
  args: z.object({ sessionId: z.string().optional().describe('Optional session ID') }),
  output: AnyOutput,
  run({ args }) { return runAtomCommand('new_session', { sessionId: args.sessionId }); },
});

cli.command('switch', {
  description: 'Switch active session.',
  args: z.object({ sessionId: z.string().describe('Session ID') }),
  output: AnyOutput,
  run({ args }) { return runAtomCommand('switch_session', { sessionId: args.sessionId }); },
});

cli.command('reset', {
  description: 'Reset a session, defaulting to the active session.',
  args: z.object({ sessionId: z.string().optional().describe('Optional session ID') }),
  output: AnyOutput,
  run({ args }) { return runAtomCommand('reset_session', { sessionId: args.sessionId }); },
});

cli.command('server', {
  description: 'Start the original upstream MCP stdio server. This is opt-in, not the default CLI behavior.',
  args: z.object({ args: z.array(z.string()).default([]).describe('Arguments passed to the MCP server') }),
  outputPolicy: 'agent-only',
  output: z.object({ exitCode: z.number().nullable() }),
  async run({ args }) { return passthrough(args.args); },
});

cli.command('tui', {
  description: 'Start the original upstream live TUI.',
  args: z.object({ args: z.array(z.string()).default([]).describe('Arguments passed to the TUI') }),
  outputPolicy: 'agent-only',
  output: z.object({ exitCode: z.number().nullable() }),
  async run({ args }) { return passthrough(['tui', ...args.args]); },
});

cli.serve();
export default cli;
