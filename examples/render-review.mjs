// Render an alternative AoT review viewer: small graph in a left rail,
// stage-by-stage atom content as the main column, with the verifications
// stage visually in focus.
//
// Usage:
//   node examples/render-review.mjs <input.json> [output.html]
//
// <input.json> is the export from `atomcommands export` plus optional
// `kills: ["H1"]` / `confirms: ["H1"]` fields on verification atoms.
// If `output.html` is omitted, writes alongside the input as
// `<basename>-review.html`.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const STAGES = [
  { type: 'premise',      label: 'Premises',      blurb: 'Facts on the ground' },
  { type: 'reasoning',    label: 'Reasoning',     blurb: 'Connecting the premises' },
  { type: 'hypothesis',   label: 'Hypotheses',    blurb: 'Candidate options' },
  { type: 'verification', label: 'Verifications', blurb: 'Pressure-testing each H' },
  { type: 'conclusion',   label: 'Conclusion',    blurb: 'What survives' },
];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderAtom(node, links, allNodes, killSet, killedHs) {
  const conf = (node.confidence ?? 0.7);
  const confPct = Math.round(conf * 100);
  const deps = links.filter(l => l.target === node.id).map(l => l.source);
  const depsStr = deps.length ? deps.join(', ') : null;

  const isKillingV = killSet.has(node.id);
  const isKilledH = killedHs.has(node.id);

  // The H(s) this V kills (only meaningful if isKillingV)
  const killTargets = isKillingV
    ? links.filter(l => l.target === node.id).map(l => l.source).filter(s => allNodes.find(n => n.id === s && n.type === 'hypothesis'))
    : [];

  let killBadge = '';
  if (isKillingV) {
    killBadge = `<span class="kill-badge"><span class="kill-badge__arrow">×</span>kills <strong>${killTargets.join(', ')}</strong></span>`;
  } else if (isKilledH) {
    killBadge = `<span class="killed-badge">eliminated</span>`;
  }

  const stateClass = isKillingV ? ' atom--killing' : isKilledH ? ' atom--killed' : '';

  return `
    <article class="atom atom--${node.type}${stateClass}">
      <div class="atom__rail">
        <span class="atom__id">${escapeHtml(node.id)}</span>
        <div class="atom__conf-bar" aria-label="confidence ${confPct}%">
          <div class="atom__conf-fill" style="width:${confPct}%"></div>
        </div>
        <span class="atom__conf-text">${confPct}<span class="pct">%</span></span>
      </div>
      <div class="atom__body">
        <div class="atom__head">
          ${killBadge}
          ${depsStr ? `<span class="atom__deps">depends on ${escapeHtml(depsStr)}</span>` : ''}
        </div>
        <p class="atom__content">${escapeHtml(node.content)}</p>
      </div>
    </article>
  `;
}

function renderStage(stage, nodes, links, allNodes, killSet, killedHs) {
  const stageNodes = nodes.filter(n => n.type === stage.type);
  if (stageNodes.length === 0) return '';
  const isFocus = stage.type === 'verification';
  const isFinale = stage.type === 'conclusion';
  const atoms = stageNodes.map(n => renderAtom(n, links, allNodes, killSet, killedHs)).join('');
  const focusPill = isFocus
    ? '<span class="stage__pill stage__pill--focus">where the V kills the H</span>'
    : isFinale
      ? '<span class="stage__pill stage__pill--finale">what survives</span>'
      : '';

  const cls = `stage stage--${stage.type}${isFocus ? ' stage--focus' : ''}${isFinale ? ' stage--finale' : ''}`;
  return `
    <section class="${cls}">
      <header class="stage__header">
        <span class="stage__chip stage__chip--${stage.type}"></span>
        <h2 class="stage__title">${escapeHtml(stage.label)}</h2>
        <span class="stage__count">${stageNodes.length}</span>
        ${focusPill}
      </header>
      <div class="stage__atoms">${atoms}</div>
    </section>
  `;
}

function buildHtml(graph) {
  const { title, nodes, links } = graph;
  const verifiedCount = nodes.filter(n => n.type === 'verification').length;
  const totalAtoms = nodes.length;
  const avgConf = nodes.length ? Math.round((nodes.reduce((s, n) => s + (n.confidence ?? 0.7), 0) / nodes.length) * 100) : 0;
  const maxDepth = Math.max(...nodes.map(n => n.depth ?? 0));

  // Identify killing verifications via explicit `kills` field on V atoms.
  const killSet = new Set();
  const killedHs = new Set();
  for (const v of nodes.filter(n => n.type === 'verification')) {
    if (Array.isArray(v.kills) && v.kills.length > 0) {
      killSet.add(v.id);
      for (const h of v.kills) killedHs.add(h);
    }
  }

  const stagesHtml = STAGES.map(s => renderStage(s, nodes, links, nodes, killSet, killedHs)).join('');

  // Mini graph layout
  const tiers = [
    nodes.filter(n => n.type === 'premise'),
    nodes.filter(n => n.type === 'reasoning'),
    nodes.filter(n => n.type === 'hypothesis'),
    nodes.filter(n => n.type === 'verification'),
    nodes.filter(n => n.type === 'conclusion'),
  ];
  const W = 280, H = 320, padX = 22, padY = 24;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;
  const tierHeight = usableH / Math.max(1, tiers.filter(t => t.length).length - 1);
  const positions = new Map();
  let visibleTier = 0;
  tiers.forEach((tier) => {
    if (tier.length === 0) return;
    const y = padY + visibleTier * tierHeight;
    tier.forEach((n, ni) => {
      const x = padX + (usableW * (ni + 1)) / (tier.length + 1);
      positions.set(n.id, { x, y });
    });
    visibleTier++;
  });

  const linksSvg = links.map(l => {
    const a = positions.get(l.source), b = positions.get(l.target);
    if (!a || !b) return '';
    const isKill = killSet.has(l.target) && nodes.find(n => n.id === l.source && n.type === 'hypothesis');
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="link${isKill ? ' link--kill' : ''}"/>`;
  }).join('');

  const nodesSvg = nodes.map(n => {
    const p = positions.get(n.id);
    const isKilling = killSet.has(n.id);
    const isKilledH = killedHs.has(n.id);
    let cls = `node node--${n.type}`;
    if (isKilledH) cls += ' node--killed-h';
    if (isKilling) cls += ' node--killing';
    return `
      <g transform="translate(${p.x},${p.y})">
        <circle class="${cls}" r="11"/>
        <text class="node__label" text-anchor="middle" dy="0.32em">${escapeHtml(n.id)}</text>
      </g>
    `;
  }).join('');

  const titleParts = title.split('—').map(s => s.trim());
  const headlineTitle = titleParts[0] || title;
  const subtitle = titleParts[1] || '';

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
    --bg-elev-2: #161c27;
    --bg-focus: #0f1c24;
    --bg-finale: #0c1c18;
    --border: rgba(255, 255, 255, 0.07);
    --border-strong: rgba(255, 255, 255, 0.14);
    --border-focus: rgba(34, 211, 238, 0.45);
    --border-finale: rgba(52, 211, 153, 0.45);

    --fg: #eef0f3;
    --fg-secondary: #a8aeb8;
    --fg-muted: #6c727b;
    --fg-faint: #3a3f48;

    --premise: #94a3b8;
    --reasoning: #60a5fa;
    --hypothesis: #fbbf24;
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
    font-size: 14px;
    line-height: 1.55;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  /* TITLE BAR */
  .titlebar {
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .titlebar__left {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .titlebar__title {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg);
  }
  .titlebar__sep {
    color: var(--fg-faint);
    font-weight: 300;
  }
  .titlebar__pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(248, 113, 113, 0.10);
    color: var(--killed);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  .titlebar__pill::before {
    content: '×';
    font-weight: 700;
  }
  .titlebar__stats {
    margin-left: auto;
    display: flex;
    gap: 20px;
  }
  .titlebar__stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .titlebar__stat-value {
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .titlebar__stat-label {
    font-size: 10px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 4px;
  }

  /* LAYOUT */
  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    min-height: calc(100vh - 65px);
  }

  /* GRAPH PANEL */
  .graph-panel {
    border-right: 1px solid var(--border);
    padding: 24px 20px;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .graph-panel__heading {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-muted);
    margin-bottom: 10px;
  }
  .graph-svg {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .link {
    stroke: var(--fg-faint);
    stroke-width: 0.8;
    opacity: 0.5;
  }
  .link--kill {
    stroke: var(--killed);
    stroke-width: 1.2;
    opacity: 0.85;
    stroke-dasharray: 3 2;
  }
  .node--premise { fill: var(--premise); stroke: var(--premise); }
  .node--reasoning { fill: var(--reasoning); stroke: var(--reasoning); }
  .node--hypothesis { fill: var(--hypothesis); stroke: var(--hypothesis); }
  .node--verification { fill: var(--verification); stroke: var(--verification); }
  .node--conclusion { fill: var(--conclusion); stroke: var(--conclusion); }
  .node--killed-h { fill: rgba(248, 113, 113, 0.10); stroke: var(--killed); stroke-dasharray: 2 2; }
  .node--killing { stroke-width: 2.5; }
  .node__label {
    fill: var(--bg);
    font-family: var(--mono);
    font-size: 8px;
    font-weight: 700;
    pointer-events: none;
    letter-spacing: -0.03em;
  }
  .node--killed-h + .node__label,
  .node--killed-h .node__label { fill: var(--killed); }

  /* LEGEND */
  .legend {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 12px;
  }
  .legend__row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--fg-secondary);
  }
  .legend__chip {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .legend__chip--premise { background: var(--premise); }
  .legend__chip--reasoning { background: var(--reasoning); }
  .legend__chip--hypothesis { background: var(--hypothesis); }
  .legend__chip--verification { background: var(--verification); }
  .legend__chip--conclusion { background: var(--conclusion); }

  /* STAGES */
  .stages {
    padding: 24px 32px 48px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 880px;
  }

  .stage {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elev);
    overflow: hidden;
    transition: border-color 200ms cubic-bezier(0.25, 1, 0.5, 1);
  }
  .stage--focus {
    border-color: var(--border-focus);
    background: var(--bg-focus);
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.10);
  }
  .stage--finale {
    border-color: var(--border-finale);
    background: var(--bg-finale);
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.10);
  }

  .stage__header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .stage--focus .stage__header { border-color: rgba(34, 211, 238, 0.18); }
  .stage--finale .stage__header { border-color: rgba(52, 211, 153, 0.18); }

  .stage__chip {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .stage__chip--premise { background: var(--premise); }
  .stage__chip--reasoning { background: var(--reasoning); }
  .stage__chip--hypothesis { background: var(--hypothesis); }
  .stage__chip--verification { background: var(--verification); }
  .stage__chip--conclusion { background: var(--conclusion); }

  .stage__title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  .stage__count {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    color: var(--fg-muted);
    background: rgba(255, 255, 255, 0.05);
    padding: 2px 6px;
    border-radius: 3px;
  }
  .stage__pill {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .stage__pill--focus {
    color: var(--verification);
    background: rgba(34, 211, 238, 0.10);
  }
  .stage__pill--finale {
    color: var(--conclusion);
    background: rgba(52, 211, 153, 0.10);
  }

  .stage__atoms {
    display: flex;
    flex-direction: column;
  }

  /* ATOM */
  .atom {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    transition: background 150ms cubic-bezier(0.25, 1, 0.5, 1);
  }
  .atom:last-child { border-bottom: none; }
  .stage--focus .atom { border-color: rgba(34, 211, 238, 0.10); }
  .stage--finale .atom { border-color: rgba(52, 211, 153, 0.10); }

  /* Left rail: ID + confidence bar */
  .atom__rail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    padding-top: 1px;
  }
  .atom__id {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    letter-spacing: 0;
  }
  .atom--premise .atom__id { color: var(--premise); }
  .atom--reasoning .atom__id { color: var(--reasoning); }
  .atom--hypothesis .atom__id { color: var(--hypothesis); }
  .atom--verification .atom__id { color: var(--verification); }
  .atom--conclusion .atom__id { color: var(--conclusion); }

  .atom__conf-bar {
    width: 64px;
    height: 3px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
  }
  .atom__conf-fill {
    height: 100%;
    background: var(--fg-faint);
    transition: width 200ms;
  }
  .atom--premise .atom__conf-fill { background: var(--premise); opacity: 0.6; }
  .atom--reasoning .atom__conf-fill { background: var(--reasoning); opacity: 0.6; }
  .atom--hypothesis .atom__conf-fill { background: var(--hypothesis); opacity: 0.6; }
  .atom--verification .atom__conf-fill { background: var(--verification); opacity: 0.7; }
  .atom--conclusion .atom__conf-fill { background: var(--conclusion); opacity: 0.7; }
  .atom--killing .atom__conf-fill { background: var(--killed); opacity: 0.85; }

  .atom__conf-text {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: var(--fg-secondary);
    letter-spacing: -0.02em;
  }
  .atom__conf-text .pct {
    color: var(--fg-muted);
    margin-left: 1px;
  }

  /* Body: head + content */
  .atom__body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .atom__head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-height: 18px;
  }
  .atom__deps {
    color: var(--fg-faint);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0;
  }
  .atom__content {
    color: var(--fg);
    font-size: 13px;
    line-height: 1.6;
    max-width: 68ch;
  }

  /* KILL markers */
  .kill-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--killed);
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 600;
    background: rgba(248, 113, 113, 0.13);
    padding: 3px 8px 3px 7px;
    border-radius: 3px;
    letter-spacing: 0.02em;
  }
  .kill-badge__arrow {
    font-size: 13px;
    line-height: 0.8;
    margin-top: -1px;
    font-weight: 700;
  }
  .kill-badge strong {
    color: #fca5a5;
    font-weight: 700;
    margin-left: 1px;
  }

  .killed-badge {
    color: var(--killed);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(248, 113, 113, 0.08);
    padding: 2px 6px;
    border-radius: 3px;
    opacity: 0.85;
  }

  /* killing V atom: red left bar */
  .atom--killing {
    background: rgba(248, 113, 113, 0.04);
    box-shadow: inset 2px 0 0 var(--killed);
  }
  /* killed H atom: dimmed content + strikethrough hint */
  .atom--killed {
    opacity: 0.55;
  }
  .atom--killed .atom__content {
    color: var(--fg-secondary);
  }

  /* Conclusion emphasis */
  .stage--finale .atom__content {
    font-size: 14px;
    line-height: 1.6;
    color: var(--fg);
    font-weight: 450;
  }
  .stage--finale .atom__id {
    background: rgba(52, 211, 153, 0.10);
  }
</style>
</head>
<body>

<header class="titlebar">
  <div class="titlebar__left">
    <h1 class="titlebar__title">${escapeHtml(headlineTitle)}</h1>
    ${subtitle ? `<span class="titlebar__sep">·</span><span class="titlebar__pill">${escapeHtml(subtitle)}</span>` : ''}
  </div>
  <div class="titlebar__stats">
    <div class="titlebar__stat"><span class="titlebar__stat-value">${avgConf}<span style="color: var(--fg-muted); font-size: 10px;">%</span></span><span class="titlebar__stat-label">avg conf</span></div>
    <div class="titlebar__stat"><span class="titlebar__stat-value">${totalAtoms}</span><span class="titlebar__stat-label">atoms</span></div>
    <div class="titlebar__stat"><span class="titlebar__stat-value">${verifiedCount}</span><span class="titlebar__stat-label">verifications</span></div>
    <div class="titlebar__stat"><span class="titlebar__stat-value">${maxDepth}</span><span class="titlebar__stat-label">depth</span></div>
  </div>
</header>

<div class="layout">
  <aside class="graph-panel">
    <div>
      <div class="graph-panel__heading">graph</div>
      <svg class="graph-svg" viewBox="0 0 ${W} ${H}" width="100%">
        ${linksSvg}
        ${nodesSvg}
      </svg>
    </div>

    <div>
      <div class="graph-panel__heading">atom types</div>
      <div class="legend">
        <div class="legend__row"><span class="legend__chip legend__chip--premise"></span>premise</div>
        <div class="legend__row"><span class="legend__chip legend__chip--reasoning"></span>reasoning</div>
        <div class="legend__row"><span class="legend__chip legend__chip--hypothesis"></span>hypothesis</div>
        <div class="legend__row"><span class="legend__chip legend__chip--verification"></span>verification</div>
        <div class="legend__row"><span class="legend__chip legend__chip--conclusion"></span>conclusion</div>
      </div>
    </div>

    <div>
      <div class="graph-panel__heading">key</div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px; color: var(--fg-secondary);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-block; width: 16px; height: 2px; background: var(--killed); border-radius: 1px;"></span>
          kill link
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; border: 2px dashed var(--killed); background: rgba(248,113,113,0.10);"></span>
          eliminated
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--verification); border: 2px solid var(--verification); box-shadow: 0 0 0 1px rgba(255,255,255,0.2);"></span>
          killing V
        </div>
      </div>
    </div>
  </aside>

  <main class="stages">
    ${stagesHtml}
  </main>
</div>

</body>
</html>`;
}

const [, , inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error('Usage: node render-review.mjs <input.json> [output.html]');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = outputArg
  ? resolve(outputArg)
  : join(dirname(inputPath), basename(inputPath, '.json') + '-review.html');

const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
writeFileSync(outputPath, buildHtml(data));
console.log(`wrote ${outputPath}`);
