import chalk from 'chalk';
import { TuiState, TuiSettings } from './tui-types.js';
import { stripAnsi } from './tui-render.js';

function box(title: string, lines: string[], width: number): string[] {
  const inner = Math.max(20, width - 4);
  const top = chalk.dim(`╭─ ${chalk.bold.white(title)} ` + '─'.repeat(Math.max(0, inner - title.length - 2)) + '╮');
  const bot = chalk.dim('╰' + '─'.repeat(inner + 2) + '╯');
  const middle = lines.map(l => {
    const len = stripAnsi(l).length;
    const pad = ' '.repeat(Math.max(0, inner - len));
    return chalk.dim('│ ') + l + pad + chalk.dim(' │');
  });
  return [top, ...middle, bot];
}

export function renderHelp(columns: number): string[] {
  const items: [string, string][] = [
    ['j/k or ↑/↓', 'move selection'],
    ['enter', 'expand atom (full content)'],
    ['a', 'accept atom'],
    ['r', 'reject atom (prompts for note)'],
    ['n', 'add note to selected atom'],
    ['*', 'star (highlight as critical)'],
    ['u', 'clear feedback on selected atom'],
    ['s', 'submit verdict to LLM'],
    ['space', 'pause / resume event stream'],
    ['R', 'reset local view'],
    ['t', 'open settings'],
    ['?', 'this help'],
    ['q / Ctrl+C', 'quit'],
  ];
  const lines = items.map(([k, d]) => `  ${chalk.cyan(k.padEnd(14))}${chalk.white(d)}`);
  lines.push('');
  lines.push(chalk.dim('  Feedback flows to the LLM via the check_approval MCP tool.'));
  lines.push(chalk.dim('  Press any key to close.'));
  return box('Atom of Thoughts · Keys', lines, Math.min(columns, 64));
}

const SETTING_LABELS: { key: keyof TuiSettings; label: string; render: (s: TuiSettings) => string }[] = [
  {
    key: 'threshold',
    label: 'Confidence threshold',
    render: (s) => {
      const slots = 10;
      const filled = Math.round(s.threshold * slots);
      return chalk.cyan('━'.repeat(filled)) + chalk.dim('─'.repeat(slots - filled)) + '  ' + chalk.bold(s.threshold.toFixed(2));
    },
  },
  { key: 'autoScroll', label: 'Auto-scroll on new atom', render: (s) => s.autoScroll ? chalk.green('[✓] on') : chalk.dim('[ ] off') },
  { key: 'compact', label: 'Compact tree', render: (s) => s.compact ? chalk.green('[✓] on') : chalk.dim('[ ] off') },
  { key: 'showDeps', label: 'Show dependency arrows', render: (s) => s.showDeps ? chalk.green('[✓] on') : chalk.dim('[ ] off') },
  { key: 'sound', label: 'Sound on conclusion', render: (s) => s.sound ? chalk.green('[✓] on') : chalk.dim('[ ] off') },
  { key: 'theme', label: 'Color theme', render: (s) => chalk.dim('◀ ') + chalk.bold(s.theme.padEnd(7)) + chalk.dim(' ▶') },
  { key: 'feedbackDir', label: 'Feedback dir', render: (s) => chalk.dim(s.feedbackDir) },
];

export function renderSettings(state: TuiState, columns: number): string[] {
  const lines = SETTING_LABELS.map((row, i) => {
    const sel = i === state.settingsIdx;
    const cursor = sel ? chalk.cyanBright('▸ ') : '  ';
    const label = (sel ? chalk.bold.white : chalk.white)(row.label.padEnd(28));
    const value = row.render(state.settings);
    return `${cursor}${label}${value}`;
  });
  lines.push('');
  lines.push(chalk.dim('  ↑↓ pick · ←→ adjust · enter toggle · esc close'));
  return box('Settings', lines, Math.min(columns, 72));
}

export function renderNotePrompt(state: TuiState, columns: number): string[] {
  const w = Math.min(columns, 72);
  const lines = [
    chalk.white('  Reason for rejection (or note):'),
    '',
    chalk.cyan('  > ') + chalk.white(state.noteBuffer) + chalk.bgWhite(' '),
    '',
    chalk.dim('  enter accept · esc cancel'),
  ];
  return box('Add note', lines, w);
}

export function settingsKeyHandler(state: TuiState, key: string): boolean {
  // returns true if key consumed
  const idx = state.settingsIdx;
  const setting = SETTING_LABELS[idx];
  if (!setting) return false;
  if (key === 'k' || key === '\x1B[A') {
    state.settingsIdx = (idx - 1 + SETTING_LABELS.length) % SETTING_LABELS.length;
    return true;
  }
  if (key === 'j' || key === '\x1B[B') {
    state.settingsIdx = (idx + 1) % SETTING_LABELS.length;
    return true;
  }
  if (setting.key === 'threshold') {
    if (key === 'h' || key === '\x1B[D') { state.settings.threshold = Math.max(0, +(state.settings.threshold - 0.05).toFixed(2)); return true; }
    if (key === 'l' || key === '\x1B[C') { state.settings.threshold = Math.min(1, +(state.settings.threshold + 0.05).toFixed(2)); return true; }
  } else if (setting.key === 'theme') {
    const themes: TuiSettings['theme'][] = ['vibrant', 'soft', 'mono'];
    const cur = themes.indexOf(state.settings.theme);
    if (key === 'h' || key === '\x1B[D') { state.settings.theme = themes[(cur - 1 + themes.length) % themes.length]; return true; }
    if (key === 'l' || key === '\x1B[C') { state.settings.theme = themes[(cur + 1) % themes.length]; return true; }
  } else if (setting.key === 'feedbackDir') {
    // not editable in this minimal version
  } else if (key === '\r' || key === ' ' || key === 'h' || key === 'l' || key === '\x1B[D' || key === '\x1B[C') {
    const k = setting.key;
    if (k === 'autoScroll' || k === 'compact' || k === 'showDeps' || k === 'sound') {
      state.settings[k] = !state.settings[k];
      return true;
    }
  }
  return false;
}
