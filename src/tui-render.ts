import chalk, { ChalkInstance } from 'chalk';
import { AtomData, AtomType } from './types.js';
import { TuiState, TuiSettings } from './tui-types.js';

type Painter = ChalkInstance;

const VIBRANT: Record<AtomType, Painter> = {
  premise: chalk.hex('#9ca3af'),
  reasoning: chalk.hex('#60a5fa'),
  hypothesis: chalk.hex('#facc15'),
  verification: chalk.hex('#22d3ee'),
  conclusion: chalk.hex('#4ade80'),
};

const SOFT: Record<AtomType, Painter> = {
  premise: chalk.hex('#cbd5e1'),
  reasoning: chalk.hex('#93c5fd'),
  hypothesis: chalk.hex('#fde68a'),
  verification: chalk.hex('#a5f3fc'),
  conclusion: chalk.hex('#bbf7d0'),
};

const MONO: Record<AtomType, Painter> = {
  premise: chalk.gray,
  reasoning: chalk.white,
  hypothesis: chalk.bold,
  verification: chalk.dim,
  conclusion: chalk.bold.white,
};

export function colorForType(theme: TuiSettings['theme']): Record<AtomType, Painter> {
  if (theme === 'soft') return SOFT;
  if (theme === 'mono') return MONO;
  return VIBRANT;
}

export const TYPE_GLYPH: Record<AtomType, string> = {
  premise: 'P',
  reasoning: 'R',
  hypothesis: 'H',
  verification: 'V',
  conclusion: 'C',
};

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function bar(confidence: number, width: number = 10): string {
  const filled = Math.round(clamp(confidence, 0, 1) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

export function rule(columns: number, ch: string = '─'): string {
  return chalk.dim(ch.repeat(columns));
}

export function buildChildrenIndex(atoms: Record<string, AtomData>): Record<string, string[]> {
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(atoms)) children[id] = [];
  for (const atom of Object.values(atoms)) {
    for (const dep of atom.dependencies) {
      if (children[dep]) children[dep].push(atom.atomId);
    }
  }
  return children;
}

export function findRoots(atoms: Record<string, AtomData>, order: string[]): string[] {
  return order.filter(id => atoms[id] && atoms[id].dependencies.length === 0);
}

export interface FlatRow {
  atomId: string;
  prefix: string;
  branch: string;
  isLast: boolean;
  isRoot: boolean;
}

export function flattenTree(state: TuiState): FlatRow[] {
  const rows: FlatRow[] = [];
  const children = buildChildrenIndex(state.atoms);
  const roots = findRoots(state.atoms, state.order);
  const visited = new Set<string>();

  function walk(id: string, prefix: string, isLast: boolean, isRoot: boolean): void {
    if (visited.has(id)) return;
    const atom = state.atoms[id];
    if (!atom) return;
    if (atom.confidence < state.settings.threshold) return;
    visited.add(id);
    const branch = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
    rows.push({ atomId: id, prefix, branch, isLast, isRoot });
    const kids = (children[id] || []).slice().sort((a, b) => state.order.indexOf(a) - state.order.indexOf(b));
    kids.forEach((child, i) => {
      const childPrefix = prefix + (isRoot ? '' : (isLast ? '   ' : '│  '));
      walk(child, childPrefix, i === kids.length - 1, false);
    });
  }

  roots.forEach((root, i) => walk(root, '', i === roots.length - 1, true));
  for (const id of state.order) {
    if (!visited.has(id) && state.atoms[id]) walk(id, '', true, true);
  }
  return rows;
}
