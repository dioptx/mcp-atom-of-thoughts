import chalk from 'chalk';
import { AtomData } from './types.js';
import { TuiState } from './tui-types.js';
import {
  colorForType, TYPE_GLYPH, bar, rule, truncate, stripAnsi, flattenTree, FlatRow,
} from './tui-render.js';

const SPARK = ' ▁▂▃▄▅▆▇█';

function spark(buckets: number[], maxLen: number = 24): string {
  const tail = buckets.slice(-maxLen);
  const max = Math.max(1, ...tail);
  return tail.map(v => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join('');
}

function pad(left: string, right: string, columns: number): string {
  const space = Math.max(1, columns - stripAnsi(left).length - stripAnsi(right).length);
  return `${left}${' '.repeat(space)}${right}`;
}

export function renderHeader(state: TuiState, columns: number): string {
  const ttl = chalk.bold.hex('#60a5fa')(' Atom of Thoughts ');
  const stats = chalk.dim(` atoms=${state.order.length} mode=${state.mode} maxDepth=${state.maxDepth}`);
  const status = state.termination
    ? chalk.green(`● ${state.termination}`)
    : state.paused
      ? chalk.yellow('● paused')
      : (state.decompositions.size > 0 ? chalk.yellow('● decomposing') : chalk.cyan('● reasoning'));
  return pad(`${ttl}${stats}`, `${status} `, columns);
}

export function renderLegend(state: TuiState): string {
  const c = colorForType(state.settings.theme);
  return chalk.dim(
    [
      c.premise('● premise'),
      c.reasoning('● reasoning'),
      c.hypothesis('● hypothesis'),
      c.verification('● verification'),
      c.conclusion('● conclusion'),
    ].join('  ')
  );
}

function feedbackGlyph(state: TuiState, atomId: string): string {
  const fb = state.feedback[atomId];
  if (!fb) return '  ';
  if (fb.verdict === 'accepted') return chalk.green(' ✓');
  if (fb.verdict === 'rejected') return chalk.red(' ✗');
  if (fb.verdict === 'starred') return chalk.yellow(' ★');
  return '  ';
}

function renderRow(state: TuiState, row: FlatRow, isSelected: boolean, columns: number): string {
  const atom = state.atoms[row.atomId];
  const color = colorForType(state.settings.theme)[atom.atomType];
  const glyph = TYPE_GLYPH[atom.atomType];
  const label = color.bold(`${glyph}·${atom.atomId}`);
  const verifiedMark = atom.isVerified ? chalk.green('✓') : ' ';
  const fbMark = feedbackGlyph(state, atom.atomId);
  const conf = `${(atom.confidence * 100).toFixed(0)}%`.padStart(4);
  const confColor = atom.confidence >= 0.85 ? chalk.green : atom.confidence >= 0.7 ? chalk.yellow : chalk.gray;
  const meta = `${chalk.dim(bar(atom.confidence))} ${confColor(conf)} ${verifiedMark}${fbMark}`;
  const cursor = isSelected ? chalk.cyanBright('▸') : ' ';
  const head = `${cursor} ${row.prefix}${row.branch}`;
  const headLen = stripAnsi(head + label + meta).length + 4;
  const room = Math.max(15, columns - headLen);
  const deps = (state.settings.showDeps && atom.dependencies.length > 0)
    ? chalk.dim(` ←${atom.dependencies.join(',')}`)
    : '';
  const content = chalk.white(truncate(atom.content, Math.max(8, room - stripAnsi(deps).length)));
  const line = `${head}${label}  ${content}${deps}  ${meta}`;
  return isSelected ? chalk.bgHex('#1e293b')(line) : line;
}

export function renderTreeBlock(state: TuiState, columns: number, height: number): { lines: string[]; rows: FlatRow[] } {
  const rows = flattenTree(state);
  const lines: string[] = [];
  // viewport: keep selection in view
  const start = Math.max(0, Math.min(rows.length - height, state.selectedIdx - Math.floor(height / 2)));
  const end = Math.min(rows.length, start + height);
  for (let i = start; i < end; i++) {
    lines.push(renderRow(state, rows[i], i === state.selectedIdx, columns));
  }
  while (lines.length < height) lines.push('');
  return { lines, rows };
}

export function renderDetail(state: TuiState, rows: FlatRow[], columns: number): string[] {
  if (rows.length === 0) {
    return [chalk.dim(' (no atoms yet — start a reasoning session in your LLM client)')];
  }
  const sel = rows[Math.min(state.selectedIdx, rows.length - 1)];
  if (!sel) return [chalk.dim(' (no selection)')];
  const atom = state.atoms[sel.atomId];
  if (!atom) return [chalk.dim(' (atom missing)')];
  const c = colorForType(state.settings.theme)[atom.atomType];
  const head = `${c.bold(atom.atomType.toUpperCase())} ${chalk.bold(atom.atomId)}` +
    chalk.dim(`  depth ${atom.depth ?? 0}/${state.maxDepth}  conf ${(atom.confidence * 100).toFixed(0)}%`) +
    (atom.isVerified ? chalk.green(' ✓ verified') : '');
  const fb = state.feedback[atom.atomId];
  const fbLine = fb
    ? (fb.verdict === 'accepted' ? chalk.green('  feedback: accepted')
      : fb.verdict === 'rejected' ? chalk.red(`  feedback: rejected${fb.note ? ' — ' + fb.note : ''}`)
      : chalk.yellow('  feedback: starred'))
    : chalk.dim('  feedback: (none)');
  const deps = atom.dependencies.length > 0
    ? chalk.dim('  deps: ') + atom.dependencies.join(', ')
    : chalk.dim('  deps: (none)');
  const text = chalk.white(truncate(atom.content, Math.max(20, columns - 4)));
  const lines = [head, ` ${text}`, deps, fbLine];
  // Surface optional V-kills-H / V-confirms-H badges when present. Only V atoms
  // carry these in practice, but render whatever is on the atom regardless.
  if (atom.kills && atom.kills.length > 0) {
    lines.push(chalk.red('  × kills: ') + atom.kills.join(', '));
  }
  if (atom.confirms && atom.confirms.length > 0) {
    lines.push(chalk.green('  ✓ confirms: ') + atom.confirms.join(', '));
  }
  return lines;
}

export function renderProcessBar(state: TuiState, columns: number): string {
  const accepted = Object.values(state.feedback).filter(f => f.verdict === 'accepted').length;
  const rejected = Object.values(state.feedback).filter(f => f.verdict === 'rejected').length;
  const left = chalk.dim(' events ') + chalk.cyan(spark(state.velocityBuckets));
  const right =
    chalk.green(`✓ ${accepted}`) + '  ' +
    chalk.red(`✗ ${rejected}`) + '  ' +
    chalk.dim(`thr ${state.settings.threshold.toFixed(2)} `);
  return pad(left, right, columns);
}

export function renderFooter(state: TuiState, eventsPath: string, columns: number): string {
  const keys = chalk.dim('j/k move · a accept · r reject · n note · t settings · s submit · ? help · q quit');
  const flash = state.flash && Date.now() < state.flash.until ? chalk.bgGreen.black(` ${state.flash.text} `) + '  ' : '';
  const src = chalk.dim(`watching ${truncate(eventsPath, Math.max(20, columns - stripAnsi(keys).length - stripAnsi(flash).length - 4))}`);
  return pad(`${flash}${src}`, keys, columns);
}
