#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Cli, Errors, z } from 'incur';
import { AtomOfThoughtsServer, type AtomServerSnapshot } from './atom-server.js';
import { AtomOfThoughtsLightServer } from './atom-light-server.js';
import { exportGraph, graphDataToAtoms } from './graph-export.js';
import type { CausalLink, GraphData } from './types.js';
import { getAllTools } from './tools.js';
import { brCommandAvailable, summarizeBrSync, syncGraphToBr, type BrSyncOptions } from './integrations/br.js';
import { bvCommandAvailable, runBvRobot, summarizeBvRobot, type BvRobotCommand } from './integrations/bv.js';
import { buildDagAtoms, buildDagGraph, collectGitDagContext, normalizeDag, resolveDagSession, summarizeDag, syncDagToLinear } from './integrations/dag.js';
import { pexCommandAvailable, runPexBundle } from './integrations/pex.js';
import { errorToPayload } from './integrations/shell-json.js';
import { analyzeGraph } from './graph-analysis.js';
import { analyzeLoops, analyzeSystems, computeLeverage, enumerateLoops, simulate } from './systems-analysis.js';
import { renderGraph } from './graph-render.js';
import { booleanFlagLiteralHint, booleanOptionNames, graphFormatMisuseHint, positionalFlagMisuseHint, rewriteNegatedBoolFlags } from './cli-hints.js';

const VERSION = '3.1.0';
const OUTPUT_SCHEMA_VERSION = 'aot.cli.pipeline.v1';
const SERVER_BIN = process.env.AOT_SERVER_BIN ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');

// State targeting: --state <path> beats AOT_STATE beats the default. The flag
// is stripped from argv before the framework parses (it is global, not
// per-command).
function extractStateFlag(argv: string[]): { statePath: string | undefined; argv: string[] } {
  const out: string[] = [];
  let statePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--state') { statePath = argv[++i]; continue; }
    if (token.startsWith('--state=')) { statePath = token.slice('--state='.length); continue; }
    out.push(token);
  }
  return { statePath, argv: out };
}
const stateFlag = extractStateFlag(process.argv.slice(2));
process.argv = [...process.argv.slice(0, 2), ...stateFlag.argv];
const STATE_PATH = stateFlag.statePath ?? process.env.AOT_STATE ?? path.join(os.homedir(), '.local/state/aot-cli/state.json');

/**
 * Rethrow engine errors as IncurError with a machine-readable code instead of
 * the framework's blanket UNKNOWN.
 */
function withDomainErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Errors.IncurError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const rules: Array<[RegExp, string, string | undefined]> = [
      // Systems-layer rules FIRST: the generic /cycle/i rule below would
      // shadow them (systems-layer messages must say "causal loop", never
      // the bare word "cycle").
      [/missing required option --sign/i, 'MISSING_SIGN', 'Causal sign is + (same direction) or - (opposite): --sign plus | --sign minus | --sign=-'],
      [/causal link .* already exists/i, 'CAUSAL_LINK_EXISTS', 'One causal link per (from,to) pair; `aot sys unlink` it first to change sign/gain.'],
      [/causal link .* not found/i, 'CAUSAL_LINK_NOT_FOUND', 'Use `aot sys loops` or `aot export` to inspect existing causal links.'],
      [/refuted atom/i, 'REFUTED_ATOM', 'Refuted atoms are excluded from causal analysis; link an active atom instead.'],
      [/Atom with ID .* not found/i, 'ATOM_NOT_FOUND', 'Use `aot list` to see atom IDs in the session.'],
      [/has dependents/i, 'HAS_DEPENDENTS', 'Pass --force to detach dependents and remove.'],
      [/cycle/i, 'DEPENDENCY_CYCLE', 'Adjust --deps so the atom does not transitively depend on itself.'],
      [/Dependencies not yet created/i, 'MISSING_DEPENDENCY', 'Create the missing dependency atoms first.'],
      [/Confidence must be between/i, 'INVALID_CONFIDENCE', 'Confidence must be 0-1 (or 0-100, normalized).'],
      [/Session not found/i, 'SESSION_NOT_FOUND', 'Use `aot sessions` to list sessions.'],
      [/Session already exists/i, 'SESSION_EXISTS', 'Pick a different session ID or `aot switch` to it.'],
      [/polarity is only valid/i, 'INVALID_POLARITY', 'Polarity applies to verification atoms only.'],
      [/nothing to update/i, 'NO_FIELDS', 'Pass at least one of --content/--confidence/--verified/--polarity/--deps/--evidence.'],
    ];
    for (const [pattern, code, hint] of rules) {
      if (pattern.test(message)) {
        // Omit `cause` when it would only echo `message` — the framework
        // renders the cause as a "Details: ..." line, duplicating the message.
        const causeAddsDetail = error instanceof Error && error.message !== message;
        throw new Errors.IncurError({ code, message, hint, cause: causeAddsDetail ? error : undefined });
      }
    }
    throw error;
  }
}

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
  polarity: z.enum(['supports', 'refutes']).optional().describe('Verification atoms only: evidence direction (default supports)'),
  evidence: z.array(z.string()).optional().describe('Evidence artifact references (paths, URLs)'),
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

  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Partial<AtomServerSnapshot>;
    if (!state || typeof state !== 'object' || (state.sessions !== undefined && typeof state.sessions !== 'object')) {
      throw new Error('Invalid state shape');
    }
    server.importState(state);
  } catch {
    // Corrupt state: quarantine instead of bricking every future command.
    const quarantine = `${STATE_PATH}.corrupt-${Date.now()}`;
    try { fs.renameSync(STATE_PATH, quarantine); } catch { /* best effort */ }
    console.error(`aot: corrupt state quarantined to ${quarantine}; starting fresh`);
  }
  return server;
}

function saveServer(server: AtomOfThoughtsServer): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({
    version: 1,
    ...server.exportState(),
  }, null, 2) + '\n');
  fs.renameSync(tmp, STATE_PATH);
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
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Errors.IncurError({
      code: 'INVALID_JSON',
      message: `Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      hint: 'Pass raw JSON, @file, or - for stdin.',
    });
  }
}

/** Zod-parse with a structured validation_error instead of a raw issue dump. */
function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new Errors.IncurError({
    code: 'VALIDATION_ERROR',
    message: `Payload validation failed: ${issues.join('; ')}`,
    hint: 'Fix the listed fields and retry.',
  });
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
      // Break stale locks left by crashed processes.
      try {
        const holderPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (Number.isFinite(holderPid)) {
          try {
            process.kill(holderPid, 0);
          } catch (killError) {
            if ((killError as NodeJS.ErrnoException).code === 'ESRCH') {
              fs.rmSync(lockPath, { force: true });
              continue;
            }
          }
        }
      } catch { /* lock vanished or unreadable; retry below */ }
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

// Commands that never mutate state: no exclusive lock, no state rewrite.
// Safe lockless because state writes are atomic (tmp + rename).
const READ_ONLY_ATOM_COMMANDS = new Set(['termination_status', 'best_conclusion', 'export', 'list_sessions']);

function runAtomCommand(command: string, options: {
  atomId?: string;
  decompositionId?: string;
  maxDepth?: number;
  title?: string;
  sessionId?: string;
}): Record<string, unknown> {
  const readOnly = READ_ONLY_ATOM_COMMANDS.has(command);
  const execute = (): Record<string, unknown> => {
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
      result = { status: 'success', command, graph: exportGraph(server.getAtoms(options.sessionId), server.getAtomOrder(options.sessionId), options.title, server.getCausalLinks(options.sessionId)) };
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
      result = { status: 'success', command, activeSessionId: server.getActiveSessionId(), maxDepth: server.maxDepth, sessions: server.listSessions(), statePath: STATE_PATH };
      break;
    case 'reset_session':
      server.resetSession(options.sessionId);
      result = { status: 'success', command, sessionId: options.sessionId ?? server.getActiveSessionId() };
      break;
    case 'archive_session': {
      const session = server.setSessionStatus('completed', options.sessionId);
      result = { status: 'success', command, sessionId: session.id, sessionStatus: session.status };
      break;
    }
    case 'reopen_session': {
      const session = server.setSessionStatus('active', options.sessionId);
      result = { status: 'success', command, sessionId: session.id, sessionStatus: session.status };
      break;
    }
    default:
      throw new Error(`Unknown atomcommands command: ${command}`);
  }

  if (!readOnly) saveServer(server);
  return result;
  };
  return readOnly ? withDomainErrors(execute) : withStateLock(() => withDomainErrors(execute));
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
  const graph = exportGraph(server.getAtoms(options.sessionId), server.getAtomOrder(options.sessionId), options.title, server.getCausalLinks(options.sessionId));
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

/**
 * Renders boolean example options in the explicit `--flag=value` form. The
 * framework's default example rendering emits `--flag value`, which is
 * exactly the bare-boolean footgun the CLI now rejects up front.
 */
function exampleOptions<const T extends Record<string, unknown>>(options: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    // Kebab-case in examples matches how the framework lists the option
    // flags, so one help screen never shows two spellings of the same flag.
    const kebab = key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
    if (typeof value === 'boolean') out[`${kebab}=${value}`] = '';
    else out[kebab] = value;
  }
  return out as T;
}

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
      refutes: z.boolean().optional().describe('Verification atoms only: this evidence REFUTES its hypothesis/conclusion dependencies instead of supporting them'),
      evidence: z.string().optional().describe('Comma-separated evidence refs (file paths, URLs)'),
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
      const result = callAtom(mode === 'fast' ? 'AoT-fast' : 'AoT-full', {
        atomId: args.atomId,
        atomType: normalizeType(args.type),
        content: args.content,
        dependencies: parseDeps(options.deps),
        confidence: normalizeConfidence(options.confidence) ?? 0.7,
        isVerified: options.verified ?? false,
        polarity: options.refutes ? 'refutes' : undefined,
        evidence: options.evidence ? parseDeps(options.evidence) : undefined,
        sessionId: options.sessionId,
      }, options.trace, options);
      // Silent defaults are a friction: say when 0.7 was assumed, not chosen.
      if (options.confidence === undefined && result && typeof result === 'object' && !Array.isArray(result)) {
        (result as Record<string, unknown>).confidenceDefaulted = true;
      }
      return result;
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
    const parsed = parseWithSchema(z.array(BatchAtomPayload), readJsonArg(args.atoms));
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
    return callAtom(args.tool, parseWithSchema(AtomPayload, payload), undefined, options);
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
    { options: exampleOptions({ dryRun: true }), description: 'Preview br issues for the active graph' },
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
    { args: { command: 'triage' }, options: exampleOptions({ maxResults: 10, sync: true }), description: 'Sync AoT to br and get bv triage' },
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
    { args: { target: 'AP19B01' }, options: exampleOptions({ topic: 'suxamethonium adverse effects', toAtoms: true }), description: 'Retrieve PEX context and seed AoT atoms' },
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
    const parsed = parseWithSchema(z.array(BatchAtomPayload), readJsonArg(args.atoms));
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
    sessionId: z.string().optional().describe('Target AoT session (default: payload sessionId, then active session)'),
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
    { args: { dag: '@dag.json' }, options: exampleOptions({ dryRun: true, linear: true }), description: 'Preview AoT/br/Linear encoding for a rich DAG' },
  ],
  run({ args, options }) {
    const meta = pipelineMeta('dag');
    try {
      const parsed = parseWithSchema(DagPayload, readJsonArg(args.dag));
      // Session precedence matches every other command: explicit flag >
      // payload sessionId > active session > 'default'. Dry-run and real run
      // resolve identically because both use this one resolution.
      const stateServer = makeServer();
      const activeSessionId = stateServer.getActiveSessionId();
      const session = resolveDagSession({
        flagSessionId: options.sessionId,
        payloadSessionId: parsed.sessionId,
        activeSessionId,
        activeSessionStatus: stateServer.listSessions().find(s => s.id === activeSessionId)?.status,
      });
      if (session.warning) console.error(`aot dag: ${session.warning}`);
      const dag = normalizeDag({ ...parsed, sessionId: session.sessionId });
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
        sessionId: dag.sessionId,
        sessionSource: session.sessionSource,
        sessionWarning: session.warning,
        dag: summarizeDag(dag),
        git,
        atoms: atomResult,
        // Consistent simulated-vs-real labeling: every stage in a --dryRun
        // payload says 'dry-run', never 'ok'.
        br: br ? { ...summarizeBrSync(br), ...(options.dryRun ? { status: 'dry-run' } : {}) } : undefined,
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
    { args: { command: 'insights' }, options: exampleOptions({ noSync: true }), description: 'Analyze an existing br workspace' },
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
  description: 'List persistent AoT sessions. Read-only: takes no lock and never rewrites state.',
  output: AnyOutput,
  run() {
    const result = runAtomCommand('list_sessions', {});
    return {
      statePath: STATE_PATH,
      activeSessionId: String(result.activeSessionId),
      maxDepth: result.maxDepth as number,
      sessions: (result.sessions as Array<{ id: string; status: string; atomCount: number; createdAt: number }>).map(s => ({
        ...s,
        createdAtIso: new Date(s.createdAt).toISOString(),
      })),
    };
  },
});

cli.command('archive', {
  description: 'Mark a session completed (default: active session), making it eligible for `aot gc`. Reopen with --reopen.',
  args: z.object({ sessionId: z.string().optional().describe('Session to archive (default active)') }),
  options: z.object({ reopen: z.boolean().optional().describe('Set the session back to active instead') }),
  output: AnyOutput,
  examples: [
    { description: 'Archive the active session' },
    { args: { sessionId: 'api500' }, options: exampleOptions({ reopen: true }), description: 'Reopen an archived session' },
  ],
  run({ args, options }) {
    return runAtomCommand(options.reopen ? 'reopen_session' : 'archive_session', { sessionId: args.sessionId });
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

cli.command('list', {
  description: 'List atoms in a session with optional type/verification/confidence filters.',
  options: z.object({
    sessionId: z.string().optional().describe('Session to list (default active)'),
    type: TypeAlias.optional().describe('Filter by atom type or shorthand p/r/h/v/c'),
    verified: z.boolean().optional().describe('Filter by verification state'),
    minConfidence: z.coerce.number().optional().describe('Minimum confidence (0-1 or 0-100)'),
  }),
  output: AnyOutput,
  examples: [
    { options: exampleOptions({ type: 'h', verified: false }), description: 'List unverified hypotheses' },
  ],
  run({ options }) {
    const server = makeServer();
    const sessionId = options.sessionId ?? server.getActiveSessionId();
    const atoms = server.getAtoms(options.sessionId);
    const minConfidence = normalizeConfidence(options.minConfidence);
    const rows = server.getAtomOrder(options.sessionId)
      .map(id => atoms[id])
      .filter(Boolean)
      .filter(atom => options.type === undefined || atom.atomType === normalizeType(options.type))
      .filter(atom => options.verified === undefined || atom.isVerified === options.verified)
      .filter(atom => minConfidence === undefined || atom.confidence >= minConfidence)
      .map(atom => ({
        atomId: atom.atomId,
        atomType: atom.atomType,
        confidence: atom.confidence,
        isVerified: atom.isVerified,
        ...(atom.isRefuted ? { isRefuted: true } : {}),
        ...(atom.polarity ? { polarity: atom.polarity } : {}),
        depth: atom.depth,
        dependencies: atom.dependencies,
        ...(atom.evidence?.length ? { evidence: atom.evidence } : {}),
        createdIso: new Date(atom.created).toISOString(),
        content: atom.content.length > 120 ? `${atom.content.slice(0, 119)}…` : atom.content,
      }));
    return { sessionId, count: rows.length, atoms: rows };
  },
});

cli.command('show', {
  description: 'Show one atom in full, with its direct dependencies, dependents, and effective confidence.',
  args: z.object({ atomId: z.string().describe('Atom ID') }),
  options: z.object({ sessionId: z.string().optional().describe('Session (default active)') }),
  output: AnyOutput,
  examples: [{ args: { atomId: 'H1' }, description: 'Inspect hypothesis H1' }],
  run({ args, options }) {
    return withDomainErrors(() => {
      const server = makeServer();
      const sessionId = options.sessionId ?? server.getActiveSessionId();
      const atoms = server.getAtoms(options.sessionId);
      const atom = atoms[args.atomId];
      if (!atom) throw new Error(`Atom with ID ${args.atomId} not found in session ${sessionId}`);
      const analysis = analyzeGraph(atoms);
      const atomAnalysis = analysis.atoms.find(a => a.atomId === args.atomId);
      return {
        sessionId,
        atom: { ...atom, createdIso: new Date(atom.created).toISOString() },
        effectiveConfidence: atomAnalysis?.effectiveConfidence,
        dependencies: atom.dependencies.map(id => atoms[id]).filter(Boolean),
        dependents: (atomAnalysis?.dependents ?? []).map(id => atoms[id]).filter(Boolean),
        issues: analysis.issues.filter(issue => issue.atomIds.includes(args.atomId)),
      };
    });
  },
});

/** Loosely validate causal links carried by an exported graph file. */
function causalLinksFromGraph(graph: GraphData): CausalLink[] {
  if (!Array.isArray(graph.causalLinks)) return [];
  return graph.causalLinks.filter((link): link is CausalLink =>
    !!link && typeof link === 'object'
    && typeof link.from === 'string' && typeof link.to === 'string'
    && (link.sign === '+' || link.sign === '-'));
}

/**
 * Resolve the atoms map for analyze/graph/sys: either a session from
 * persistent state, or a graph file (`--from`): exported GraphData or an
 * `aot export` payload. Causal links ride along when present.
 */
function atomsForInspection(options: { sessionId?: string; from?: string }): { atoms: Record<string, import('./types.js').AtomData>; atomOrder: string[]; causalLinks: CausalLink[]; source: string } {
  if (options.from) {
    const parsed = readJsonArg(options.from.startsWith('@') || options.from === '-' ? options.from : `@${options.from}`) as Record<string, unknown>;
    if (Array.isArray(parsed.nodes)) {
      const graph = parsed as unknown as GraphData;
      const { atoms, atomOrder } = graphDataToAtoms(graph);
      return { atoms, atomOrder, causalLinks: causalLinksFromGraph(graph), source: `file:${options.from}` };
    }
    if (parsed.graph && Array.isArray((parsed.graph as GraphData).nodes)) {
      const graph = parsed.graph as GraphData;
      const { atoms, atomOrder } = graphDataToAtoms(graph);
      return { atoms, atomOrder, causalLinks: causalLinksFromGraph(graph), source: `file:${options.from}` };
    }
    throw new Errors.IncurError({ code: 'INVALID_GRAPH_FILE', message: 'File is neither exported GraphData ({nodes,links}) nor an `aot export` payload ({graph:{nodes,links}}).', hint: 'Export with `aot export` or `aot cmd export`.' });
  }
  const server = makeServer();
  const sessionId = options.sessionId ?? server.getActiveSessionId();
  return { atoms: server.getAtoms(options.sessionId), atomOrder: server.getAtomOrder(options.sessionId), causalLinks: server.getCausalLinks(options.sessionId), source: `session:${sessionId}` };
}

cli.command('analyze', {
  description: 'Analyze the atom graph: cycles, dangling deps, topological order, effective (propagated) confidence, weakest links, contradictions, refuted atoms, critical path, and lint issues. Gate mode for CI: exit 1 on issues.',
  options: z.object({
    sessionId: z.string().optional().describe('Session to analyze (default active)'),
    from: z.string().optional().describe('Analyze a graph file (aot export output or GraphData JSON) instead of session state; @file, path, or - for stdin'),
    weakThreshold: z.coerce.number().optional().describe('Effective-confidence threshold for weak_support issues (default 0.5)'),
    gate: z.boolean().optional().describe('Exit with code 1 when lint issues are found (CI gate mode)'),
    failOn: z.string().optional().describe('Comma-separated issue codes that trigger gate failure (default: all)'),
  }),
  output: AnyOutput,
  examples: [
    { description: 'Analyze the active session' },
    { options: exampleOptions({ weakThreshold: 0.7 }), description: 'Stricter weak-support lint' },
    { options: exampleOptions({ gate: true, failOn: 'cycle,refuted_support,dangling_dependency' }), description: 'CI gate: fail only on structural breakage' },
  ],
  run({ options }) {
    const { atoms, source } = atomsForInspection(options);
    const analysis = analyzeGraph(atoms, { weakThreshold: options.weakThreshold });
    const failCodes = options.failOn ? new Set(parseDeps(options.failOn)) : null;
    const gateIssues = failCodes ? analysis.issues.filter(issue => failCodes.has(issue.code)) : analysis.issues;
    if (options.gate && gateIssues.length > 0) {
      process.exitCode = 1;
    }
    return {
      source,
      ...(options.gate ? { gate: { failed: gateIssues.length > 0, failingIssueCount: gateIssues.length, failOn: failCodes ? [...failCodes] : 'all' } } : {}),
      ...analysis,
    };
  },
});

cli.command('import', {
  description: 'Import an exported graph (aot export output or GraphData JSON) into a session, making exports round-trippable.',
  args: z.object({ file: z.string().describe('Graph JSON: path, @file, or - for stdin') }),
  options: z.object({
    sessionId: z.string().optional().describe('Target session (default active); auto-created if missing'),
    replace: z.boolean().optional().describe('Reset the target session before importing (default: merge/overwrite by atom ID)'),
  }),
  output: AnyOutput,
  examples: [
    { args: { file: 'graph.json' }, options: exampleOptions({ sessionId: 'restored' }), description: 'Import an exported graph into a fresh session' },
  ],
  run({ args, options }) {
    return withStateLock(() => withDomainErrors(() => {
      const parsed = readJsonArg(args.file.startsWith('@') || args.file === '-' ? args.file : `@${args.file}`) as Record<string, unknown>;
      const graph = Array.isArray(parsed.nodes) ? parsed as unknown as GraphData
        : parsed.graph && Array.isArray((parsed.graph as GraphData).nodes) ? parsed.graph as GraphData
        : null;
      if (!graph) throw new Errors.IncurError({ code: 'INVALID_GRAPH_FILE', message: 'File is neither exported GraphData ({nodes,links}) nor an `aot export` payload.', hint: 'Export with `aot export`.' });
      const { atoms, atomOrder } = graphDataToAtoms(graph);
      const server = makeServer();
      const sessionId = options.sessionId ?? server.getActiveSessionId();
      const state = server.exportState();
      if (!state.sessions[sessionId]) {
        server.newSession(sessionId);
      }
      const session = state.sessions[sessionId] ?? server.exportState().sessions[sessionId];
      if (options.replace) server.resetSession(sessionId);
      let imported = 0;
      for (const id of atomOrder) {
        session.atoms[id] = atoms[id];
        if (!session.atomOrder.includes(id)) session.atomOrder.push(id);
        imported++;
      }
      session.verifiedConclusions = session.atomOrder.filter(id =>
        session.atoms[id]?.atomType === 'conclusion' && session.atoms[id].isVerified);
      // Restore the causal layer (round-trippable since export carries it).
      // Merge semantics match atoms: existing (from,to) pairs win; links whose
      // endpoints did not survive the import are dropped.
      let importedCausalLinks = 0;
      const fileCausalLinks = causalLinksFromGraph(graph);
      if (fileCausalLinks.length > 0) {
        session.causalLinks ??= [];
        for (const link of fileCausalLinks) {
          if (!session.atoms[link.from] || !session.atoms[link.to]) continue;
          if (session.causalLinks.some(existing => existing.from === link.from && existing.to === link.to)) continue;
          session.causalLinks.push({
            id: `cl:${link.from}>${link.to}`,
            from: link.from,
            to: link.to,
            sign: link.sign,
            gain: link.gain ?? 'med',
            ...(link.label ? { label: link.label } : {}),
            created: typeof link.created === 'number' ? link.created : Date.now(),
          });
          importedCausalLinks++;
        }
      }
      saveServer(server);
      return { status: 'success', sessionId, importedCount: imported, atomCount: Object.keys(session.atoms).length, ...(importedCausalLinks > 0 ? { importedCausalLinks } : {}), title: graph.title };
    }));
  },
});

cli.command('graph', {
  description: 'Render the atom graph as an ASCII tree, mermaid, graphviz dot, or Obsidian JSON Canvas.',
  options: z.object({
    graphFormat: z.enum(['tree', 'mermaid', 'dot', 'canvas']).default('tree').describe('Render format'),
    sessionId: z.string().optional().describe('Session to render (default active)'),
    from: z.string().optional().describe('Render a graph file (aot export output or GraphData JSON) instead of session state'),
    title: z.string().optional().describe('Graph title'),
    out: z.string().optional().describe('Write rendered output to a file (e.g. plan.canvas) instead of returning it inline'),
  }),
  // Union: raw rendered string by default, structured payload with --format/--out.
  output: z.any(),
  examples: [
    { options: { graphFormat: 'mermaid' }, description: 'Mermaid diagram for docs' },
    { options: { graphFormat: 'canvas', out: 'reasoning.canvas' }, description: 'Obsidian canvas file' },
  ],
  run({ options, formatExplicit }) {
    let graph: GraphData;
    let sourceLabel: string;
    if (options.from) {
      const { atoms, atomOrder, causalLinks, source } = atomsForInspection({ from: options.from });
      graph = exportGraph(atoms, atomOrder, options.title, causalLinks);
      sourceLabel = source;
    } else {
      const current = exportCurrentGraph({ sessionId: options.sessionId, title: options.title });
      graph = current.graph;
      sourceLabel = `session:${current.sessionId}`;
    }
    const rendered = renderGraph(graph, options.graphFormat);
    if (options.out) {
      fs.writeFileSync(options.out, rendered.endsWith('\n') ? rendered : `${rendered}\n`);
      return { source: sourceLabel, format: options.graphFormat, out: path.resolve(options.out), bytes: Buffer.byteLength(rendered, 'utf8') };
    }
    // Structured envelope only on explicit request (--format json / --json /
    // --format toon ...); by default the render goes to stdout raw so
    // tree/mermaid/dot output is terminal- and doc-pasteable, with metadata
    // on stderr.
    if (formatExplicit) return { source: sourceLabel, format: options.graphFormat, rendered };
    process.stderr.write(`aot graph: ${sourceLabel} graphFormat=${options.graphFormat}\n`);
    return rendered;
  },
});

// ---------------------------------------------------------------------------
// Systems-thinking layer: `aot sys link|unlink|loops`. Mounted as a sub-CLI
// (incur resolves only the first argv token; space-named literal commands
// like 'sys link' would be unreachable dead code).
// ---------------------------------------------------------------------------

// Bare `-` can be eaten by arg parsing; aliases are the escape hatch
// (`--sign=-` also works).
const CausalSignSchema = z.enum(['+', '-', 'plus', 'minus', 'pos', 'neg']);
const CausalGainSchema = z.enum(['low', 'med', 'high']);

function normalizeCausalSign(sign: z.infer<typeof CausalSignSchema>): '+' | '-' {
  return sign === '+' || sign === 'plus' || sign === 'pos' ? '+' : '-';
}

const sys = Cli.create('sys', {
  description: 'Systems-thinking layer: signed causal links between atoms and feedback-loop (reinforcing/balancing) analysis. Causal loops are legal — they never appear as dependency-cycle issues in `aot analyze`.',
});

sys.command('link', {
  description: 'Add a signed causal link between two existing atoms. One link per (from,to) pair; use `--sign minus` or `--sign=-` for opposite-direction influence.',
  args: z.object({
    from: z.string().describe('Cause atom ID'),
    to: z.string().describe('Effect atom ID'),
  }),
  options: z.object({
    // Schema-optional on purpose: it is the only way to reach run() and emit
    // a domain error (MISSING_SIGN, after atom validation) instead of a raw
    // zod enum dump. The flag is still required.
    sign: CausalSignSchema.optional().describe('(required) Causal sign: +/plus/pos (same direction) or -/minus/neg (opposite)'),
    gain: CausalGainSchema.default('med').describe('Influence strength: low, med, or high'),
    label: z.string().optional().describe('Optional human label for the link'),
    update: z.boolean().optional().describe('Idempotent upsert: update the link in place if it exists (preserving id/created), else create it'),
    sessionId: z.string().optional().describe('Session (default active)'),
  }),
  output: AnyOutput,
  examples: [
    { args: { from: 'H1', to: 'P1' }, options: { sign: 'minus' }, description: 'H1 suppresses P1 (balancing influence)' },
    { args: { from: 'P1', to: 'R1' }, options: { sign: 'plus', gain: 'high' }, description: 'Strong same-direction influence' },
    { args: { from: 'P1', to: 'R1' }, options: exampleOptions({ sign: 'plus', update: true }), description: 'Ensure this signed edge exists (create or update in place)' },
  ],
  run({ args, options }) {
    return withStateLock(() => withDomainErrors(() => {
      const server = makeServer();
      // Atom existence beats missing --sign: unknown IDs are the first thing
      // to fix before any link can succeed.
      const atoms = server.getAtoms(options.sessionId);
      for (const endpoint of [args.from, args.to]) {
        if (!atoms[endpoint]) throw new Error(`Atom with ID ${endpoint} not found`);
      }
      if (options.sign === undefined) {
        throw new Error('missing required option --sign (use --sign plus, --sign minus, or --sign=-)');
      }
      const payload = {
        from: args.from,
        to: args.to,
        sign: normalizeCausalSign(options.sign),
        gain: options.gain,
        label: options.label,
      };
      if (options.update) {
        const { link, updated } = server.upsertCausalLink(payload, options.sessionId);
        saveServer(server);
        return {
          status: 'success',
          sessionId: options.sessionId ?? server.getActiveSessionId(),
          link: { ...link, createdIso: new Date(link.created).toISOString() },
          updated,
        };
      }
      const link = server.addCausalLink(payload, options.sessionId);
      saveServer(server);
      return {
        status: 'success',
        sessionId: options.sessionId ?? server.getActiveSessionId(),
        link: { ...link, createdIso: new Date(link.created).toISOString() },
      };
    }));
  },
});

sys.command('unlink', {
  description: 'Remove the causal link between two atoms.',
  args: z.object({
    from: z.string().describe('Cause atom ID'),
    to: z.string().describe('Effect atom ID'),
  }),
  options: z.object({
    sessionId: z.string().optional().describe('Session (default active)'),
  }),
  output: AnyOutput,
  examples: [{ args: { from: 'H1', to: 'P1' }, description: 'Remove the H1 -> P1 causal link' }],
  run({ args, options }) {
    return withStateLock(() => withDomainErrors(() => {
      const server = makeServer();
      const removed = server.removeCausalLink(args.from, args.to, options.sessionId);
      saveServer(server);
      return { status: 'success', sessionId: options.sessionId ?? server.getActiveSessionId(), removed: removed.id };
    }));
  },
});

sys.command('loops', {
  description: 'Enumerate feedback loops in the causal graph (bounded: max length 12, max 500 loops) and classify each as reinforcing or balancing, with control-theoretic roles (sensor/actuator/goal) and external disturbances. Refuted atoms are excluded. Read-only.',
  options: z.object({
    sessionId: z.string().optional().describe('Session (default active)'),
    kind: z.enum(['reinforcing', 'balancing', 'all']).default('all').describe('Filter by loop kind'),
    from: z.string().optional().describe('Analyze a graph file (aot export output or GraphData JSON with causalLinks) instead of session state'),
  }),
  output: AnyOutput,
  examples: [
    { description: 'List all feedback loops in the active session' },
    { options: { kind: 'reinforcing' as const }, description: 'Only compounding (reinforcing) loops' },
  ],
  run({ options }) {
    return withDomainErrors(() => {
      const { atoms, causalLinks, source } = atomsForInspection(options);
      const { loops, controlLoops, truncated } = analyzeLoops({ atoms, causalLinks });
      const controlByLoop = new Map(controlLoops.map(control => [control.loopId, control]));
      const filtered = options.kind === 'all' ? loops : loops.filter(loop => loop.kind === options.kind);
      return {
        source,
        causalLinkCount: causalLinks.length,
        loopCount: filtered.length,
        totalLoopCount: loops.length,
        truncated,
        loops: filtered.map(loop => ({ ...loop, control: controlByLoop.get(loop.id) })),
      };
    });
  },
});

sys.command('leverage', {
  description: 'Rank atoms by systemic leverage: loop participation, causal out-degree, and confidence-weighted loop dominance, with rationale codes. Read-only.',
  options: z.object({
    sessionId: z.string().optional().describe('Session (default active)'),
    from: z.string().optional().describe('Analyze a graph file (aot export output or GraphData JSON with causalLinks) instead of session state'),
    top: z.coerce.number().optional().describe('Return only the top N leverage points'),
  }),
  output: AnyOutput,
  examples: [
    { description: 'Rank all atoms by systemic leverage' },
    { options: exampleOptions({ top: 3 }), description: 'Only the three highest-leverage atoms' },
  ],
  run({ options }) {
    return withDomainErrors(() => {
      const { atoms, causalLinks, source } = atomsForInspection(options);
      const { loops, truncated } = enumerateLoops({ atoms, causalLinks });
      const leveragePoints = computeLeverage({ atoms, causalLinks }, loops);
      return {
        source,
        truncated,
        totalAtoms: Object.keys(atoms).length,
        leveragePoints: options.top !== undefined ? leveragePoints.slice(0, options.top) : leveragePoints,
      };
    });
  },
});

sys.command('simulate', {
  description: 'Propagate a hypothetical up/down perturbation at one atom through the signed causal graph (damped, loop-capped) and report per-atom direction, strength, and provenance (first-order / loop-mediated / emergent). Read-only.',
  args: z.object({ atomId: z.string().describe('Source atom ID to perturb') }),
  options: z.object({
    direction: z.enum(['up', 'down'], {
      error: 'Required option --direction must be "up" or "down"',
    }).describe('Perturbation direction at the source atom'),
    sessionId: z.string().optional().describe('Session (default active)'),
    from: z.string().optional().describe('Simulate over a graph file (aot export output or GraphData JSON with causalLinks) instead of session state'),
  }),
  output: AnyOutput,
  examples: [
    { args: { atomId: 'H1' }, options: { direction: 'up' as const }, description: 'What moves when H1 increases?' },
    { args: { atomId: 'P1' }, options: { direction: 'down' as const }, description: 'Downstream effect of P1 decreasing' },
  ],
  run({ args, options }) {
    return withDomainErrors(() => {
      const { atoms, causalLinks, source } = atomsForInspection(options);
      const result = simulate({ atoms, causalLinks }, args.atomId, options.direction);
      // SimulationResult deliberately has no truncated field; derive it from
      // enumeration so provenance can be read as best-effort when true.
      const { truncated } = enumerateLoops({ atoms, causalLinks });
      return { source, truncated, ...result };
    });
  },
});

sys.command('lint', {
  description: 'Systems lint over the causal graph: compounding reinforcing loops, sensorless balancing loops, loops contradicting verified conclusions, orphan/self/duplicate links, and truncated enumeration. Gate mode for CI: exit 1 on issues. Read-only.',
  options: z.object({
    sessionId: z.string().optional().describe('Session (default active)'),
    from: z.string().optional().describe('Lint a graph file (aot export output or GraphData JSON with causalLinks) instead of session state'),
    gate: z.boolean().optional().describe('Exit with code 1 when systems issues are found (CI gate mode)'),
    failOn: z.string().optional().describe('Comma-separated issue codes that trigger gate failure (default: all)'),
  }),
  output: AnyOutput,
  examples: [
    { description: 'Lint the active session causal graph' },
    { options: exampleOptions({ gate: true, failOn: 'REINFORCING_COMPOUNDING_RISK,LOOP_CONTRADICTS_CONCLUSION' }), description: 'CI gate: fail only on behavioral risks' },
  ],
  run({ options }) {
    return withDomainErrors(() => {
      const { atoms, causalLinks, source } = atomsForInspection(options);
      const analysis = analyzeSystems({ atoms, causalLinks });
      const counts: Record<string, number> = {};
      for (const issue of analysis.issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
      const failCodes = options.failOn ? new Set(parseDeps(options.failOn)) : null;
      const gateIssues = failCodes ? analysis.issues.filter(issue => failCodes.has(issue.code)) : analysis.issues;
      if (options.gate && gateIssues.length > 0) {
        process.exitCode = 1;
      }
      return {
        source,
        truncated: analysis.truncated,
        issues: analysis.issues,
        counts,
        ...(options.gate ? { gate: { failed: gateIssues.length > 0, failingIssueCount: gateIssues.length, failOn: failCodes ? [...failCodes] : 'all' } } : {}),
      };
    });
  },
});

cli.command(sys);

cli.command('set', {
  description: 'Update an existing atom: content, confidence, verification, polarity, evidence, or dependencies (cycle-checked). Archives the session when the update makes termination hold.',
  args: z.object({ atomId: z.string().describe('Atom ID') }),
  options: z.object({
    content: z.string().optional().describe('New content'),
    confidence: z.coerce.number().optional().describe('New confidence (0-1 or 0-100)'),
    verified: z.boolean().optional().describe('Set verification state'),
    polarity: z.enum(['supports', 'refutes']).optional().describe('Verification atoms only: evidence direction'),
    evidence: z.string().optional().describe('Comma-separated replacement evidence refs (paths, URLs)'),
    deps: z.string().optional().describe('Comma-separated replacement dependency IDs'),
    sessionId: z.string().optional().describe('Session (default active)'),
  }),
  alias: { confidence: 'c', deps: 'd' },
  output: AnyOutput,
  examples: [
    { args: { atomId: 'H1' }, options: exampleOptions({ confidence: 0.95, verified: true }), description: 'Mark hypothesis verified at 95%' },
    { args: { atomId: 'V1' }, options: exampleOptions({ polarity: 'refutes' as const, verified: true }), description: 'Record refuting evidence: dependencies get marked refuted, never verified' },
  ],
  run({ args, options }) {
    const changed = (['content', 'confidence', 'verified', 'polarity', 'evidence', 'deps'] as const)
      .filter(key => options[key] !== undefined);
    return withStateLock(() => withDomainErrors(() => {
      if (changed.length === 0) {
        throw new Error(`nothing to update on ${args.atomId}: no mutation flags were passed`);
      }
      const server = makeServer();
      const atom = server.updateAtom(args.atomId, {
        content: options.content,
        confidence: normalizeConfidence(options.confidence),
        isVerified: options.verified,
        polarity: options.polarity,
        evidence: options.evidence !== undefined ? parseDeps(options.evidence) : undefined,
        dependencies: options.deps !== undefined ? parseDeps(options.deps) : undefined,
      }, options.sessionId);
      // A set can push the session past its termination condition (e.g.
      // bumping a verified conclusion to >= 0.9); archive it exactly like
      // creation-time termination does, instead of leaving it un-gc-able.
      const termination = server.archiveIfTerminated(options.sessionId);
      saveServer(server);
      return {
        status: 'success',
        sessionId: options.sessionId ?? server.getActiveSessionId(),
        changed,
        atom,
        ...(termination.shouldTerminate ? { terminationStatus: { shouldTerminate: true, reason: termination.reason }, sessionArchived: termination.archived } : {}),
      };
    }));
  },
});

cli.command('rm', {
  description: 'Remove an atom. Refuses while dependents exist unless --force, which detaches them.',
  args: z.object({ atomId: z.string().describe('Atom ID') }),
  options: z.object({
    force: z.boolean().optional().describe('Detach dependents and remove anyway'),
    sessionId: z.string().optional().describe('Session (default active)'),
  }),
  output: AnyOutput,
  examples: [{ args: { atomId: 'R2' }, description: 'Remove a leaf atom' }],
  run({ args, options }) {
    return withStateLock(() => withDomainErrors(() => {
      const server = makeServer();
      const result = server.removeAtom(args.atomId, options.sessionId, options.force ?? false);
      saveServer(server);
      return { status: 'success', sessionId: options.sessionId ?? server.getActiveSessionId(), ...result };
    }));
  },
});

cli.command('gc', {
  description: 'Prune completed and empty sessions from persistent state (never the active session or "default"). Completed sessions with atoms are finished reasoning artifacts: deleting them requires --yes; without it, gc previews them and removes only empty sessions.',
  options: z.object({
    dryRun: z.boolean().optional().describe('Preview all removals without writing anything'),
    yes: z.boolean().optional().describe('Actually delete completed sessions that still contain atoms (irreversible)'),
    olderThanDays: z.coerce.number().optional().describe('Only prune sessions older than N days'),
    keepCompleted: z.boolean().optional().describe('Only prune empty sessions, keep completed ones'),
  }),
  output: AnyOutput,
  examples: [
    { options: exampleOptions({ dryRun: true }), description: 'Preview what would be pruned' },
    { options: exampleOptions({ yes: true, olderThanDays: 7 }), description: 'Delete week-old completed sessions, including their atoms' },
  ],
  run({ options }) {
    return withStateLock(() => {
      const server = makeServer();
      const state = server.exportState();
      const cutoff = options.olderThanDays !== undefined ? Date.now() - options.olderThanDays * 86_400_000 : undefined;
      const removed: Array<{ id: string; status: string; atomCount: number }> = [];
      const kept: Array<{ id: string; status: string; atomCount: number; reason: string }> = [];
      for (const [id, session] of Object.entries(state.sessions)) {
        if (id === state.activeSessionId || id === 'default') continue;
        if (cutoff !== undefined && session.createdAt > cutoff) continue;
        const atomCount = Object.keys(session.atoms).length;
        const empty = atomCount === 0;
        const prunable = empty || (!options.keepCompleted && session.status === 'completed');
        if (!prunable) continue;
        // Non-empty completed sessions are the OUTPUT of finished reasoning.
        // Data loss requires explicit consent.
        if (!empty && !options.yes && !options.dryRun) {
          kept.push({ id, status: session.status, atomCount, reason: 'contains atoms; pass --yes to delete (or --dry-run to preview)' });
          continue;
        }
        removed.push({ id, status: session.status, atomCount });
        if (!options.dryRun) delete state.sessions[id];
      }
      if (!options.dryRun && removed.length > 0) saveServer(server);
      return {
        status: 'success',
        dryRun: Boolean(options.dryRun),
        removedCount: removed.length,
        removed,
        ...(kept.length > 0 ? { keptCount: kept.length, kept } : {}),
        remaining: Object.keys(state.sessions).length,
      };
    });
  },
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

const cliArgv = process.argv.slice(2);
const formatHint = graphFormatMisuseHint(cliArgv);
if (formatHint) {
  process.stderr.write(`${formatHint}\n`);
  process.exit(1);
}

// Guard the bare-boolean-flag footgun (`aot set H1 --verified false` would
// otherwise set verified=true and drop "false" as a stray positional).
// Boolean flag names are derived from the invoked command's own options
// schema via the framework's command registry, so there is no drift.
const commandEntry = Cli.toCommands.get(cli as never)?.get(cliArgv[0] ?? '');
const commandBooleans = booleanOptionNames((commandEntry as { options?: unknown } | undefined)?.options);
const booleanHint = booleanFlagLiteralHint(cliArgv, commandBooleans);
if (booleanHint) {
  process.stderr.write(`${booleanHint}\n`);
  process.exit(1);
}

// `--sessionId`/`--atomId` passed to commands where they are POSITIONALS get
// a pointer instead of a bare "Unknown flag".
const argsShape = ((commandEntry as { args?: { shape?: Record<string, unknown> } } | undefined)?.args)?.shape;
const positionalHint = positionalFlagMisuseHint(cliArgv, argsShape ? Object.keys(argsShape) : []);
if (positionalHint) {
  process.stderr.write(`${positionalHint}\n`);
  process.exit(1);
}

// Make the help screen's own `--no-br`-style spellings actually parse: the
// framework treats `--no-X` as negation of X, which shadows flags whose real
// name starts with "no" (noBr, noBv, noBeads, ...). Rewrite them to the
// declared camelCase form before the framework sees argv.
process.argv = [...process.argv.slice(0, 2), ...rewriteNegatedBoolFlags(cliArgv, commandBooleans)];

cli.serve();
export default cli;
