import { describe, it, expect } from 'vitest';
import { renderDetail } from '../src/tui-frames.js';
import { flattenTree } from '../src/tui-render.js';
import { TuiState, defaultSettings } from '../src/tui-types.js';
import { AtomData } from '../src/types.js';

function makeAtom(id: string, type: AtomData['atomType'], extra: Partial<AtomData> = {}): AtomData {
  return {
    atomId: id,
    content: `content of ${id}`,
    atomType: type,
    dependencies: [],
    confidence: 0.9,
    created: 0,
    isVerified: false,
    ...extra,
  };
}

function makeState(atoms: AtomData[]): TuiState {
  const order = atoms.map(a => a.atomId);
  const map: Record<string, AtomData> = {};
  for (const a of atoms) map[a.atomId] = a;
  return {
    atoms: map,
    order,
    termination: null,
    mode: 'fast',
    maxDepth: 3,
    lastEventAt: null,
    decompositions: new Set(),
    feedback: {},
    selectedIdx: 0,
    uiMode: 'main',
    settingsIdx: 0,
    noteBuffer: '',
    paused: false,
    velocityBuckets: [],
    flash: null,
    settings: defaultSettings('/tmp'),
  };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('tui-frames: renderDetail', () => {
  it('renders a kills badge when V atom has kills field', () => {
    const v = makeAtom('V1', 'verification', { kills: ['H2'] });
    const state = makeState([v]);
    const rows = flattenTree(state);
    const lines = renderDetail(state, rows, 100).map(stripAnsi);
    expect(lines.some(l => l.includes('kills') && l.includes('H2'))).toBe(true);
  });

  it('renders a confirms badge when V atom has confirms field', () => {
    const v = makeAtom('V2', 'verification', { confirms: ['H3'] });
    const state = makeState([v]);
    const rows = flattenTree(state);
    const lines = renderDetail(state, rows, 100).map(stripAnsi);
    expect(lines.some(l => l.includes('confirms') && l.includes('H3'))).toBe(true);
  });

  it('renders both badges when both fields are present', () => {
    const v = makeAtom('V3', 'verification', { kills: ['H1'], confirms: ['H2', 'H3'] });
    const state = makeState([v]);
    const rows = flattenTree(state);
    const lines = renderDetail(state, rows, 100).map(stripAnsi);
    expect(lines.some(l => l.includes('kills') && l.includes('H1'))).toBe(true);
    expect(lines.some(l => l.includes('confirms') && l.includes('H2, H3'))).toBe(true);
  });

  it('renders no badges when neither field is present', () => {
    const v = makeAtom('V1', 'verification');
    const state = makeState([v]);
    const rows = flattenTree(state);
    const lines = renderDetail(state, rows, 100).map(stripAnsi);
    expect(lines.some(l => l.includes('kills'))).toBe(false);
    expect(lines.some(l => l.includes('confirms'))).toBe(false);
  });

  it('does not render badges for empty kills/confirms arrays', () => {
    const v = makeAtom('V1', 'verification', { kills: [], confirms: [] });
    const state = makeState([v]);
    const rows = flattenTree(state);
    const lines = renderDetail(state, rows, 100).map(stripAnsi);
    expect(lines.some(l => l.includes('kills'))).toBe(false);
    expect(lines.some(l => l.includes('confirms'))).toBe(false);
  });
});
