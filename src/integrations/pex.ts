import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { commandErrorPayload, runCommand, firstJson } from './shell-json.js';

export interface PexOptions {
  topic?: string;
  k?: number;
  layers?: string[];
  pipeline?: boolean;
  recursive?: boolean;
  sourcegraph?: boolean;
  collection?: string;
  command?: string;
}

export interface PexCallResult {
  name: string;
  command: string[];
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

export interface PexBundle {
  target: string;
  pexTarget: string;
  topic: string;
  calls: PexCallResult[];
  atoms: Array<{
    tool: 'AoT-full';
    atomId: string;
    atomType: 'premise' | 'reasoning' | 'verification' | 'conclusion';
    content: string;
    dependencies: string[];
    confidence: number;
    isVerified: boolean;
    sessionId?: string;
  }>;
}

function pexCommand(options: PexOptions = {}): string {
  if (options.command ?? process.env.AOT_PEX_BIN) return options.command ?? process.env.AOT_PEX_BIN ?? 'pex';
  const fallback = path.join(os.homedir(), '.local/bin/pex');
  return fs.existsSync(fallback) ? fallback : 'pex';
}

export function pexCommandAvailable(options: PexOptions = {}): boolean {
  const result = runCommand(pexCommand(options), ['--help']);
  return !result.combined.includes('command not found') && !result.combined.includes('No such file') && (result.status === 0 || result.combined.includes('pex —'));
}

export function normalizePexTarget(target: string): string {
  const ap = target.match(/^AP(\d{2})([AB])(\d{2})$/i);
  if (ap) return `20${ap[1]}${ap[2].toUpperCase()}${ap[3]}`;
  return target;
}

export function pexSourcegraphArgs(pexTarget: string): string[] | null {
  const m = pexTarget.match(/^(20\d{2})([AB])(\d{2})$/i);
  if (!m) return null;
  return ['sourcegraph', `${m[1]}${m[2].toUpperCase()}`, '--focus', pexTarget, '--json'];
}

function callPex(name: string, args: string[], options: PexOptions = {}): PexCallResult {
  const command = pexCommand(options);
  const result = runCommand(command, args);
  const combined = result.combined.trim();
  if (result.status !== 0) {
    return { name, command: [command, ...args], ok: false, error: commandErrorPayload(result) };
  }
  try {
    return { name, command: [command, ...args], ok: true, data: firstJson(combined) };
  } catch {
    return { name, command: [command, ...args], ok: true, data: { text: combined } };
  }
}

function compact(value: unknown, max = 1600): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeAtomPrefix(target: string): string {
  return target.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24) || 'PEX';
}

export function buildPexAtoms(bundle: Omit<PexBundle, 'atoms'>, sessionId?: string): PexBundle['atoms'] {
  const prefix = safeAtomPrefix(bundle.pexTarget);
  const callsByName = new Map(bundle.calls.map(call => [call.name, call]));
  const scope = callsByName.get('scope');
  const brief = callsByName.get('brief');
  const evidence = callsByName.get('evidence');
  const sourcegraph = callsByName.get('sourcegraph');
  const layers = bundle.calls.filter(call => call.name.startsWith('layers:'));
  const atoms: PexBundle['atoms'] = [];

  atoms.push({
    tool: 'AoT-full',
    atomId: `${prefix}-PEX-SCOPE`,
    atomType: 'premise',
    content: `PEX scope for ${bundle.pexTarget}: ${compact(scope?.data ?? scope?.error ?? 'not run')}`,
    dependencies: [],
    confidence: scope?.ok ? 0.86 : 0.45,
    isVerified: Boolean(scope?.ok),
    sessionId,
  });
  atoms.push({
    tool: 'AoT-full',
    atomId: `${prefix}-PEX-BRIEF`,
    atomType: 'reasoning',
    content: `PEX pipeline brief for topic "${bundle.topic}": ${compact(brief?.data ?? brief?.error ?? 'not run')}`,
    dependencies: [`${prefix}-PEX-SCOPE`],
    confidence: brief?.ok ? 0.82 : 0.45,
    isVerified: Boolean(brief?.ok),
    sessionId,
  });
  atoms.push({
    tool: 'AoT-full',
    atomId: `${prefix}-PEX-EVIDENCE`,
    atomType: 'verification',
    content: `PEX evidence and layer retrieval: evidence=${compact(evidence?.data ?? evidence?.error ?? 'not run')}; layers=${compact(layers.map(l => ({ name: l.name, ok: l.ok, data: l.data, error: l.error })), 1800)}`,
    dependencies: [`${prefix}-PEX-BRIEF`],
    confidence: evidence?.ok || layers.some(l => l.ok) ? 0.78 : 0.4,
    isVerified: Boolean(evidence?.ok || layers.some(l => l.ok)),
    sessionId,
  });
  if (sourcegraph) {
    atoms.push({
      tool: 'AoT-full',
      atomId: `${prefix}-PEX-PROVENANCE`,
      atomType: 'verification',
      content: `PEX sourcegraph provenance for ${bundle.pexTarget}: ${compact(sourcegraph.data ?? sourcegraph.error ?? 'not run')}`,
      dependencies: [`${prefix}-PEX-SCOPE`],
      confidence: sourcegraph.ok ? 0.76 : 0.4,
      isVerified: Boolean(sourcegraph.ok),
      sessionId,
    });
  }
  atoms.push({
    tool: 'AoT-full',
    atomId: `${prefix}-PEX-SYNTHESIS`,
    atomType: 'conclusion',
    content: `Synthesis instruction for ${bundle.pexTarget}: ground the AoT answer in examiner domains from scope/brief, corroborate with evidence/layers/sourcegraph, and explicitly encode common-error traps before final generation.`,
    dependencies: atoms.filter(atom => atom.atomId !== `${prefix}-PEX-SYNTHESIS`).map(atom => atom.atomId),
    confidence: 0.8,
    isVerified: true,
    sessionId,
  });
  return atoms;
}

export function runPexBundle(target: string, options: PexOptions = {}, sessionId?: string): PexBundle {
  const pexTarget = normalizePexTarget(target);
  const topic = options.topic ?? pexTarget;
  const base = options.collection ? ['--collection', options.collection] : [];
  const calls: PexCallResult[] = [];

  calls.push(callPex('scope', [...base, 'scope', pexTarget, '--siblings', '--prereq', '--json'], options));
  calls.push(callPex('examiner', [...base, 'examiner', pexTarget, '--json'], options));
  calls.push(callPex('brief', [
    ...base, 'brief', pexTarget,
    '--topic', topic,
    ...(options.pipeline !== false ? ['--pipeline'] : []),
    '--layers',
    '--json',
  ], options));
  calls.push(callPex('evidence', [...base, 'evidence', topic, '--k', String(options.k ?? 8), '--json'], options));

  for (const layer of options.layers ?? ['reports', 'texts', 'ontology']) {
    calls.push(callPex(`layers:${layer}`, [...base, 'layers', 'search', topic, '--layer', layer, '--json', ...(options.recursive ? ['--recursive'] : [])], options));
  }

  if (options.sourcegraph ?? true) {
    const args = pexSourcegraphArgs(pexTarget);
    if (args) calls.push(callPex('sourcegraph', args, options));
  }

  const bundle = { target, pexTarget, topic, calls };
  return { ...bundle, atoms: buildPexAtoms(bundle, sessionId) };
}
