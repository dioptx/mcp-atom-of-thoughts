import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AotEvent, defaultEventsPath } from './events.js';
import { TuiState, defaultSettings } from './tui-types.js';
import { renderHeader, renderLegend, renderTreeBlock, renderDetail, renderProcessBar, renderFooter } from './tui-frames.js';
import { renderHelp, renderSettings, renderNotePrompt, settingsKeyHandler } from './tui-overlays.js';
import { rule, flattenTree } from './tui-render.js';
import { submitFeedback, recordFeedback, clearFeedback } from './tui-feedback.js';
import { DEMO_EVENTS, DEMO_DELAY_MS } from './tui-demo.js';

function emptyState(feedbackDir: string): TuiState {
  return {
    atoms: {},
    order: [],
    termination: null,
    mode: 'both',
    maxDepth: 5,
    lastEventAt: null,
    decompositions: new Set(),
    feedback: {},
    selectedIdx: 0,
    uiMode: 'main',
    settingsIdx: 0,
    noteBuffer: '',
    paused: false,
    velocityBuckets: new Array(24).fill(0),
    flash: null,
    settings: defaultSettings(feedbackDir),
  };
}

function applyEvent(state: TuiState, ev: AotEvent): void {
  state.lastEventAt = ev.t;
  // bucket velocity (~1 sec per bucket)
  state.velocityBuckets.push(0);
  if (state.velocityBuckets.length > 60) state.velocityBuckets.shift();
  state.velocityBuckets[state.velocityBuckets.length - 1]++;

  switch (ev.kind) {
    case 'session_start':
      state.atoms = {};
      state.order = [];
      state.termination = null;
      state.mode = ev.mode;
      state.maxDepth = ev.maxDepth;
      state.decompositions.clear();
      state.selectedIdx = 0;
      break;
    case 'atom_added':
      state.atoms[ev.atom.atomId] = { ...ev.atom };
      if (!state.order.includes(ev.atom.atomId)) state.order.push(ev.atom.atomId);
      if (state.settings.autoScroll) {
        const rows = flattenTree(state);
        const idx = rows.findIndex(r => r.atomId === ev.atom.atomId);
        if (idx >= 0) state.selectedIdx = idx;
      }
      break;
    case 'atom_verified':
      if (state.atoms[ev.atomId]) {
        state.atoms[ev.atomId].isVerified = true;
        state.atoms[ev.atomId].confidence = ev.confidence;
      }
      break;
    case 'decomposition_started':
      state.decompositions.add(ev.decompositionId);
      break;
    case 'decomposition_completed':
      state.decompositions.delete(ev.decompositionId);
      break;
    case 'termination':
      state.termination = ev.reason;
      break;
  }
}

function clearScreen(): void { process.stdout.write('\x1B[2J\x1B[H\x1B[?25l'); }
function showCursor(): void { process.stdout.write('\x1B[?25h'); }

function flash(state: TuiState, text: string, ms: number = 1500): void {
  state.flash = { text, until: Date.now() + ms };
}

function render(state: TuiState, eventsPath: string): void {
  const columns = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  clearScreen();
  const out: string[] = [];
  out.push(renderHeader(state, columns));
  out.push(rule(columns));
  out.push(renderLegend(state));
  out.push('');

  const detailHeight = 4;
  const reservedBottom = detailHeight + 4;
  const treeHeight = Math.max(6, rows - 6 - reservedBottom);
  const { lines: treeLines, rows: flat } = renderTreeBlock(state, columns, treeHeight);
  for (const l of treeLines) out.push(l);
  out.push(rule(columns));
  for (const l of renderDetail(state, flat, columns)) out.push(l);
  out.push(rule(columns));
  out.push(renderProcessBar(state, columns));
  out.push(renderFooter(state, eventsPath, columns));

  // overlays
  if (state.uiMode === 'help') {
    overlay(out, renderHelp(columns), columns, rows);
  } else if (state.uiMode === 'settings') {
    overlay(out, renderSettings(state, columns), columns, rows);
  } else if (state.uiMode === 'note') {
    overlay(out, renderNotePrompt(state, columns), columns, rows);
  }

  // pad to terminal height
  while (out.length < rows) out.push('');
  process.stdout.write(out.slice(0, rows).join('\n'));
}

function overlay(base: string[], panel: string[], columns: number, rows: number): void {
  const top = Math.max(2, Math.floor((rows - panel.length) / 2));
  for (let i = 0; i < panel.length; i++) {
    const line = panel[i];
    const idx = top + i;
    if (idx < base.length) {
      const left = Math.max(2, Math.floor((columns - stripVisible(line)) / 2));
      base[idx] = ' '.repeat(left) + line;
    }
  }
}

function stripVisible(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '').length;
}

function moveSelection(state: TuiState, delta: number): void {
  const rows = flattenTree(state);
  if (rows.length === 0) return;
  state.selectedIdx = Math.max(0, Math.min(rows.length - 1, state.selectedIdx + delta));
}

function selectedAtomId(state: TuiState): string | null {
  const rows = flattenTree(state);
  const sel = rows[Math.min(state.selectedIdx, rows.length - 1)];
  return sel?.atomId ?? null;
}

function handleMainKey(state: TuiState, key: string, eventsPath: string): boolean {
  if (key === 'q' || key === '\x03') { return true; }
  if (key === 'j' || key === '\x1B[B') { moveSelection(state, 1); return false; }
  if (key === 'k' || key === '\x1B[A') { moveSelection(state, -1); return false; }
  if (key === 'a') {
    const id = selectedAtomId(state);
    if (id) { recordFeedback(state, id, { verdict: 'accepted', at: Date.now() }); flash(state, `accepted ${id}`); }
    return false;
  }
  if (key === 'r') {
    const id = selectedAtomId(state);
    if (id) {
      state.uiMode = 'note';
      state.noteBuffer = '';
    }
    return false;
  }
  if (key === 'n') {
    state.uiMode = 'note';
    state.noteBuffer = '';
    return false;
  }
  if (key === '*') {
    const id = selectedAtomId(state);
    if (id) { recordFeedback(state, id, { verdict: 'starred', at: Date.now() }); flash(state, `starred ${id}`); }
    return false;
  }
  if (key === 'u') {
    const id = selectedAtomId(state);
    if (id) { clearFeedback(state, id); flash(state, `cleared ${id}`); }
    return false;
  }
  if (key === 's') {
    const result = submitFeedback(state);
    flash(state, `verdict ${result.status} written — ask the LLM to check_approval`, 4500);
    state.uiMode = 'submitted';
    setTimeout(() => { if (state.uiMode === 'submitted') state.uiMode = 'main'; render(state, eventsPath); }, 1200);
    return false;
  }
  if (key === ' ') { state.paused = !state.paused; return false; }
  if (key === 'R') { state.atoms = {}; state.order = []; state.feedback = {}; state.selectedIdx = 0; state.termination = null; flash(state, 'reset'); return false; }
  if (key === 't') { state.uiMode = 'settings'; return false; }
  if (key === '?') { state.uiMode = 'help'; return false; }
  return false;
}

function handleNoteKey(state: TuiState, key: string): void {
  if (key === '\x1B') { state.uiMode = 'main'; state.noteBuffer = ''; return; }
  if (key === '\r' || key === '\n') {
    const id = selectedAtomId(state);
    if (id) {
      recordFeedback(state, id, { verdict: 'rejected', note: state.noteBuffer || 'rejected via TUI', at: Date.now() });
      flash(state, `rejected ${id}`);
    }
    state.uiMode = 'main';
    state.noteBuffer = '';
    return;
  }
  if (key === '\x7F' || key === '\b') { state.noteBuffer = state.noteBuffer.slice(0, -1); return; }
  if (key.length === 1 && key >= ' ' && key <= '~') state.noteBuffer += key;
}

function tailFile(filePath: string, onLine: (line: string) => void): { stop: () => void } {
  let pos = 0;
  let buf = '';
  let stopped = false;

  function flush(): void {
    if (stopped) return;
    try {
      const stats = fs.statSync(filePath);
      if (stats.size < pos) pos = 0;
      if (stats.size === pos) return;
      const fd = fs.openSync(filePath, 'r');
      const len = stats.size - pos;
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, pos);
      fs.closeSync(fd);
      pos = stats.size;
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const p of parts) if (p.trim()) onLine(p);
    } catch { /* file may not exist yet */ }
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.closeSync(fs.openSync(filePath, 'a'));
  } catch { /* ignore */ }

  flush();
  const watcher = fs.watch(filePath, { persistent: true }, () => flush());
  const interval = setInterval(flush, 500);
  return {
    stop: () => {
      stopped = true;
      try { watcher.close(); } catch { /* ignore */ }
      clearInterval(interval);
    },
  };
}

function setupKeys(onKey: (key: string) => void): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => onKey(typeof key === 'string' ? key : key.toString()));
}

async function runDemo(feedbackDir: string, opts: { instant?: boolean } = {}): Promise<void> {
  const state = emptyState(feedbackDir);
  const eventsPath = '<demo>';
  let quit = false;
  process.on('SIGINT', () => { quit = true; });
  setupKeys((k) => {
    if (state.uiMode === 'help' || state.uiMode === 'settings') {
      if (k === '\x1B' || k === 'q' || k === '?' || k === 't') { state.uiMode = 'main'; render(state, eventsPath); return; }
      if (state.uiMode === 'settings') { settingsKeyHandler(state, k); render(state, eventsPath); return; }
      state.uiMode = 'main';
      render(state, eventsPath);
      return;
    }
    if (state.uiMode === 'note') { handleNoteKey(state, k); render(state, eventsPath); return; }
    if (handleMainKey(state, k, eventsPath)) { quit = true; return; }
    render(state, eventsPath);
  });

  if (opts.instant) {
    // Populate the entire tree synchronously so the recording can focus on
    // user interaction (feedback / settings / help) without a 7s warm-up.
    for (const ev of DEMO_EVENTS) applyEvent(state, ev);
    render(state, eventsPath);
  } else {
    for (const ev of DEMO_EVENTS) {
      if (quit) break;
      applyEvent(state, ev);
      render(state, eventsPath);
      await new Promise(r => setTimeout(r, DEMO_DELAY_MS[ev.kind] ?? 500));
    }
  }

  // Hold so the recording (or human viewer) has time to read / interact.
  for (let i = 0; i < 300 && !quit; i++) {
    await new Promise(r => setTimeout(r, 100));
    render(state, eventsPath);
  }
  showCursor();
  clearScreen();
  process.exit(0);
}

function runWatch(eventsPath: string, feedbackDir: string): void {
  const state = emptyState(feedbackDir);
  const tail = tailFile(eventsPath, (line) => {
    if (state.paused) return;
    try {
      const ev: AotEvent = JSON.parse(line);
      applyEvent(state, ev);
      render(state, eventsPath);
    } catch { /* malformed line */ }
  });

  setupKeys((k) => {
    if (state.uiMode === 'help' || state.uiMode === 'submitted') {
      if (k === '\x1B' || k === 'q' || k === '?') state.uiMode = 'main';
      else state.uiMode = 'main';
      render(state, eventsPath);
      return;
    }
    if (state.uiMode === 'settings') {
      if (k === '\x1B' || k === 't' || k === 'q') { state.uiMode = 'main'; render(state, eventsPath); return; }
      settingsKeyHandler(state, k);
      render(state, eventsPath);
      return;
    }
    if (state.uiMode === 'note') {
      handleNoteKey(state, k);
      render(state, eventsPath);
      return;
    }
    if (handleMainKey(state, k, eventsPath)) {
      tail.stop();
      showCursor();
      clearScreen();
      process.exit(0);
    }
    render(state, eventsPath);
  });

  render(state, eventsPath);
  process.on('SIGINT', () => { tail.stop(); showCursor(); clearScreen(); process.exit(0); });
  process.on('SIGTERM', () => { tail.stop(); showCursor(); clearScreen(); process.exit(0); });

  // tick to age the velocity bucket
  setInterval(() => {
    state.velocityBuckets.push(0);
    if (state.velocityBuckets.length > 60) state.velocityBuckets.shift();
    if (state.flash && Date.now() > state.flash.until) state.flash = null;
    render(state, eventsPath);
  }, 1000);
}

export function main(argv: string[]): void {
  const args = argv.slice(3); // skip node, script, 'tui'
  let demo = false;
  let demoInstant = false;
  let watchPath: string | null = null;
  let feedbackDir = path.join(os.homedir(), 'Downloads');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--demo') demo = true;
    else if (args[i] === '--demo-instant') { demo = true; demoInstant = true; }
    else if (args[i] === '--watch') watchPath = args[++i] ?? null;
    else if (args[i] === '--feedback-dir') feedbackDir = args[++i] ?? feedbackDir;
  }

  if (demo) { runDemo(feedbackDir, { instant: demoInstant }); return; }
  const resolved = watchPath ?? defaultEventsPath(path.join(os.tmpdir(), 'aot-diagrams'));
  runWatch(resolved, feedbackDir);
}
