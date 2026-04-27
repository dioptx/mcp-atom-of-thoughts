// Focus viewer: just the Verifications + Conclusion stages of a trace,
// full-bleed. A single-frame summary of what the trace caught and what survived.
//
// Usage:
//   node examples/render-focus.mjs <input.json> [output.html]
//
// Same input shape as render-review.mjs: an `atomcommands export` graph,
// with optional `kills` / `confirms` fields on verification atoms.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildHtml(graph) {
  const { title, nodes, links } = graph;

  // Use explicit `kills` field on V atoms.
  const killSet = new Set();
  for (const v of nodes.filter(n => n.type === 'verification')) {
    if (Array.isArray(v.kills) && v.kills.length > 0) killSet.add(v.id);
  }

  const verifications = nodes.filter(n => n.type === 'verification');
  const conclusionAtom = nodes.find(n => n.type === 'conclusion');

  const titleParts = title.split('—').map(s => s.trim());
  const headlineTitle = titleParts[0] || title;
  const subtitle = titleParts[1] || '';

  function renderV(v) {
    const isKilling = killSet.has(v.id);
    const conf = Math.round((v.confidence ?? 0.7) * 100);
    const targets = isKilling
      ? (v.kills || [])
      : (v.confirms || links.filter(l => l.target === v.id).map(l => l.source).filter(s => nodes.find(n => n.id === s && n.type === 'hypothesis')));
    const killBadge = isKilling
      ? `<div class="kill-banner"><span class="kill-banner__x">×</span> KILLS <strong>${targets.join(', ')}</strong></div>`
      : `<div class="confirm-banner">✓ confirms ${targets.join(', ')}</div>`;
    return `
      <article class="atom atom--verification${isKilling ? ' atom--killing' : ''}">
        <div class="atom__top">
          <span class="atom__id">${escapeHtml(v.id)}</span>
          <span class="atom__type">VERIFICATION</span>
          <span class="atom__conf-text">${conf}%</span>
        </div>
        ${killBadge}
        <p class="atom__content">${escapeHtml(v.content)}</p>
      </article>
    `;
  }

  function renderC(c) {
    if (!c) return '';
    const conf = Math.round((c.confidence ?? 0.7) * 100);
    return `
      <article class="atom atom--conclusion">
        <div class="atom__top">
          <span class="atom__id">${escapeHtml(c.id)}</span>
          <span class="atom__type">CONCLUSION</span>
          <span class="atom__conf-text">${conf}%</span>
        </div>
        <div class="conclusion-banner">WHAT SURVIVES</div>
        <p class="atom__content atom__content--big">${escapeHtml(c.content)}</p>
      </article>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0e16;
    --bg-elev: #11161f;
    --bg-focus: #0f1c24;
    --bg-finale: #0c1c18;
    --border: rgba(255, 255, 255, 0.07);
    --border-focus: rgba(34, 211, 238, 0.45);
    --border-finale: rgba(52, 211, 153, 0.45);

    --fg: #eef0f3;
    --fg-secondary: #a8aeb8;
    --fg-muted: #6c727b;
    --fg-faint: #3a3f48;

    --verification: #22d3ee;
    --conclusion: #34d399;
    --killed: #f87171;

    --mono: 'SF Mono', 'Menlo', 'JetBrains Mono', monospace;
    --sans: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--sans);
    line-height: 1.5;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    padding: 48px 56px;
  }

  .header {
    margin-bottom: 32px;
    display: flex;
    align-items: baseline;
    gap: 20px;
  }
  .header__title {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .header__sep { color: var(--fg-faint); }
  .header__pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 5px;
    background: rgba(248, 113, 113, 0.12);
    color: var(--killed);
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 500;
  }
  .header__pill::before { content: '×'; font-weight: 700; font-size: 16px; }

  .stage-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.10em;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stage-label__chip {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .stage-label__chip--v { background: var(--verification); }
  .stage-label__chip--c { background: var(--conclusion); }
  .stage-label__hint {
    color: var(--fg-faint);
    font-size: 11px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-left: auto;
  }

  .stack {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
    margin-bottom: 36px;
  }

  .atom {
    border-radius: 10px;
    padding: 24px 28px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
  }

  .atom--verification {
    background: var(--bg-focus);
    border-color: var(--border-focus);
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.12);
  }
  .atom--killing {
    border-color: var(--killed);
    box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.20);
  }
  .atom--conclusion {
    background: var(--bg-finale);
    border-color: var(--border-finale);
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.18);
  }

  .atom__top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .atom__id {
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
  }
  .atom--verification .atom__id { color: var(--verification); }
  .atom--conclusion .atom__id { color: var(--conclusion); background: rgba(52, 211, 153, 0.10); }

  .atom__type {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--fg-muted);
    letter-spacing: 0.08em;
  }
  .atom__conf-text {
    margin-left: auto;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    color: var(--fg-secondary);
  }

  .kill-banner {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 5px;
    background: rgba(248, 113, 113, 0.13);
    color: var(--killed);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 14px;
    letter-spacing: 0.04em;
  }
  .kill-banner__x {
    font-size: 18px;
    line-height: 0.8;
    font-weight: 700;
  }
  .kill-banner strong {
    color: #fca5a5;
    font-weight: 700;
    margin-left: 2px;
  }

  .confirm-banner {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 4px;
    background: rgba(34, 211, 238, 0.10);
    color: var(--verification);
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 14px;
  }

  .conclusion-banner {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 4px;
    background: rgba(52, 211, 153, 0.13);
    color: var(--conclusion);
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 14px;
    letter-spacing: 0.06em;
  }

  .atom__content {
    color: var(--fg);
    font-size: 18px;
    line-height: 1.55;
    max-width: 88ch;
  }
  .atom__content--big {
    font-size: 20px;
    font-weight: 450;
    line-height: 1.55;
  }
</style>
</head>
<body>

<header class="header">
  <h1 class="header__title">${escapeHtml(headlineTitle)}</h1>
  ${subtitle ? `<span class="header__sep">·</span><span class="header__pill">${escapeHtml(subtitle)}</span>` : ''}
</header>

<div class="stage-label">
  <span class="stage-label__chip stage-label__chip--v"></span>
  Verifications
  <span class="stage-label__hint">where the V kills the H</span>
</div>
<div class="stack">
  ${verifications.map(renderV).join('')}
</div>

<div class="stage-label">
  <span class="stage-label__chip stage-label__chip--c"></span>
  Conclusion
  <span class="stage-label__hint">what survives</span>
</div>
<div class="stack">
  ${renderC(conclusionAtom)}
</div>

</body>
</html>`;
}

const [, , inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error('Usage: node render-focus.mjs <input.json> [output.html]');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = outputArg
  ? resolve(outputArg)
  : join(dirname(inputPath), basename(inputPath, '.json') + '-focus.html');

const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
writeFileSync(outputPath, buildHtml(data));
console.log(`wrote ${outputPath}`);
