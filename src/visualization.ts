import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { GraphData } from './types.js';
import { getD3Script } from './d3-bundle.js';

export function generateVisualizationHtml(data: GraphData): string {
  const dataScript = `<script>window.AOT_DATA = ${JSON.stringify(data)};</script>`;
  let html = TEMPLATE.replace('</head>', `${dataScript}\n</head>`);
  const d3Source = getD3Script();
  if (d3Source) {
    html = html.replace(/\s*<!-- D3_INLINE -->/, () => `\n    <script>${d3Source}<\/script>`);
  }
  return html;
}

export function writeVisualization(html: string, outputDir?: string, name?: string, defaultOutputDir?: string): string {
  const dir = outputDir || defaultOutputDir || path.join(os.tmpdir(), 'aot-diagrams');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = name ? `${name}-${timestamp}.html` : `aot-review-${timestamp}.html`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, html, 'utf-8');
  return filepath;
}

export function openInBrowser(filepath: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open "${filepath}"`);
    } else if (platform === 'linux') {
      execSync(`xdg-open "${filepath}"`);
    } else if (platform === 'win32') {
      execSync(`start "" "${filepath}"`);
    }
  } catch {
    // Non-fatal: browser open is best-effort
  }
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AoT Plan Review</title>
    <!-- D3_INLINE -->
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f1a;
            min-height: 100vh;
            color: #fff;
            overflow: hidden;
        }
        .bg-gradient {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background:
                radial-gradient(ellipse at 20% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 80%, rgba(34, 197, 94, 0.1) 0%, transparent 50%),
                radial-gradient(ellipse at 50% 50%, rgba(14, 165, 233, 0.08) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
        }
        .header {
            position: relative; z-index: 10;
            padding: 16px 24px;
            background: rgba(15, 15, 26, 0.8);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex; justify-content: space-between; align-items: center;
        }
        .header h1 {
            font-size: 20px; font-weight: 600;
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .header .meta {
            display: flex; gap: 20px; font-size: 12px; color: #6b7280;
        }
        .header .meta span { display: flex; align-items: center; gap: 6px; }
        .header .meta .dot { width: 6px; height: 6px; border-radius: 50%; }
        .header .status-badge {
            padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
            display: flex; align-items: center; gap: 6px;
        }
        .header .status-badge.pending { background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }
        .header .status-badge.approved { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .container { display: flex; height: calc(100vh - 60px); position: relative; z-index: 1; }
        .sidebar {
            width: 380px;
            background: rgba(15, 15, 26, 0.6);
            backdrop-filter: blur(20px);
            padding: 20px;
            overflow-y: auto;
            border-right: 1px solid rgba(255,255,255,0.06);
            display: flex;
            flex-direction: column;
        }
        .section { margin-bottom: 20px; }
        .section-title {
            font-size: 10px; font-weight: 600; color: #6b7280;
            letter-spacing: 1.5px; margin-bottom: 12px; text-transform: uppercase;
            display: flex; justify-content: space-between; align-items: center;
        }
        .progress-bar { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-bottom: 16px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #22d3ee); border-radius: 2px; transition: width 0.3s ease; }
        .legend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .legend-item {
            display: flex; align-items: center; padding: 8px 10px;
            background: rgba(255,255,255,0.03); border-radius: 8px; font-size: 12px;
            border: 1px solid rgba(255,255,255,0.04);
        }
        .legend-icon {
            width: 24px; height: 24px; border-radius: 6px; margin-right: 8px;
            display: flex; align-items: center; justify-content: center; font-size: 11px;
        }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .stat-card {
            background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04);
            border-radius: 10px; padding: 14px;
        }
        .stat-value {
            font-size: 24px; font-weight: 700;
            background: linear-gradient(135deg, #4ade80 0%, #22d3ee 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .stat-label { font-size: 11px; color: #6b7280; margin-top: 4px; }
        .phase-card {
            background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
            border-radius: 12px; margin-bottom: 12px; overflow: hidden; transition: all 0.2s ease;
        }
        .phase-card:hover { border-color: rgba(255,255,255,0.12); }
        .phase-card.approved { border-color: rgba(34, 197, 94, 0.3); background: rgba(34, 197, 94, 0.05); }
        .phase-card.rejected { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05); }
        .phase-header { padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .phase-header:hover { background: rgba(255,255,255,0.02); }
        .phase-info { display: flex; align-items: center; gap: 10px; }
        .phase-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }
        .phase-title { font-size: 14px; font-weight: 600; color: #fff; }
        .phase-count { font-size: 11px; color: #6b7280; margin-top: 2px; }
        .phase-actions { display: flex; gap: 6px; }
        .btn { padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 4px; }
        .btn-approve { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
        .btn-approve:hover { background: rgba(34, 197, 94, 0.3); }
        .btn-reject { background: rgba(239, 68, 68, 0.2); color: #f87171; }
        .btn-reject:hover { background: rgba(239, 68, 68, 0.3); }
        .btn-expand { background: rgba(255,255,255,0.1); color: #9ca3af; padding: 6px 8px; }
        .btn-expand:hover { background: rgba(255,255,255,0.15); }
        .phase-summary { display: none; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.02); }
        .phase-card.expanded .phase-summary { display: block; }
        .phase-summary-title { font-size: 10px; font-weight: 600; color: #6b7280; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
        .phase-summary-content { font-size: 12px; color: #d1d5db; line-height: 1.6; }
        .phase-summary-bullets { list-style: none; padding: 0; margin: 0; }
        .phase-summary-bullets li { position: relative; padding-left: 16px; margin-bottom: 6px; font-size: 12px; color: #d1d5db; line-height: 1.5; }
        .phase-summary-bullets li::before { content: '\\2022'; position: absolute; left: 0; color: var(--phase-color, #6b7280); font-weight: bold; }
        .phase-summary-stats { display: flex; gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.04); }
        .phase-stat { display: flex; flex-direction: column; align-items: center; flex: 1; }
        .phase-stat-value { font-size: 18px; font-weight: 700; color: #fff; }
        .phase-stat-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
        .phase-toggle-details { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.04); cursor: pointer; font-size: 11px; color: #9ca3af; }
        .phase-toggle-details:hover { color: #fff; }
        .node-list { display: none; padding: 0 16px 14px 16px; border-top: 1px solid rgba(255,255,255,0.04); }
        .phase-card.expanded.show-details .node-list { display: block; }
        .node-item { padding: 10px 12px; margin-top: 8px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); transition: all 0.15s ease; }
        .node-item:hover { background: rgba(255,255,255,0.04); }
        .node-item.approved { border-color: rgba(34, 197, 94, 0.3); }
        .node-item.rejected { border-color: rgba(239, 68, 68, 0.3); }
        .node-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
        .node-id { font-size: 12px; font-weight: 700; color: #fff; }
        .node-confidence { font-size: 10px; color: #6b7280; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }
        .node-content-text { font-size: 12px; color: #d1d5db; line-height: 1.5; margin-bottom: 8px; }
        .node-actions { display: flex; gap: 6px; }
        .node-actions .btn { padding: 4px 10px; font-size: 10px; }
        .feedback-container { margin-top: 10px; display: none; }
        .feedback-container.active { display: block; }
        .feedback-label { font-size: 10px; color: #f87171; margin-bottom: 6px; font-weight: 600; }
        .feedback-input { width: 100%; padding: 10px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: #fff; font-size: 12px; resize: vertical; min-height: 60px; font-family: inherit; }
        .feedback-input:focus { outline: none; border-color: rgba(239, 68, 68, 0.5); }
        .feedback-input::placeholder { color: #6b7280; }
        .sidebar-footer { margin-top: auto; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06); }
        .action-btn { width: 100%; padding: 14px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; border: none; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .action-btn.primary { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #fff; }
        .action-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3); }
        .action-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        .action-btn.secondary { background: rgba(255,255,255,0.1); color: #fff; margin-top: 10px; }
        .action-btn.secondary:hover { background: rgba(255,255,255,0.15); }
        .action-hint { font-size: 11px; color: #6b7280; text-align: center; margin-top: 12px; }
        .graph-container { flex: 1; position: relative; }
        #graph { width: 100%; height: 100%; }
        .tooltip {
            position: absolute; padding: 16px 20px;
            background: rgba(15, 15, 26, 0.98); backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.15); border-radius: 12px;
            pointer-events: none; opacity: 0; transition: opacity 0.2s;
            max-width: 400px; min-width: 320px; z-index: 1000;
            box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        }
        .tooltip.visible { opacity: 1; }
        .tooltip-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .tooltip-id { font-weight: 700; font-size: 16px; background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .tooltip-type { font-size: 10px; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
        .tooltip-content { font-size: 14px; color: #fff; line-height: 1.6; margin-bottom: 14px; font-weight: 500; }
        .tooltip-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px; margin-bottom: 12px; }
        .tooltip-meta-item { font-size: 11px; }
        .tooltip-meta-item .label { color: #6b7280; margin-bottom: 2px; }
        .tooltip-meta-item .value { color: #fff; font-weight: 600; }
        .tooltip-confidence-bar { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-top: 8px; }
        .tooltip-confidence-fill { height: 100%; border-radius: 3px; }
        .tooltip-deps { font-size: 11px; color: #9ca3af; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); }
        .tooltip-deps strong { color: #fff; }
        .tooltip-deps .dep-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .tooltip-deps .dep-tag { background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 10px; font-size: 10px; }
        .tooltip-status { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; }
        .tooltip-status.verified { background: rgba(34,197,94,0.2); color: #4ade80; }
        .tooltip-status.unverified { background: rgba(234,179,8,0.2); color: #facc15; }
        .tooltip-status.low-conf { background: rgba(239,68,68,0.2); color: #f87171; }
        .controls { position: absolute; bottom: 20px; right: 20px; display: flex; gap: 8px; }
        .control-btn { width: 40px; height: 40px; border: none; background: rgba(255,255,255,0.08); backdrop-filter: blur(10px); color: #fff; border-radius: 10px; cursor: pointer; font-size: 18px; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.06); }
        .control-btn:hover { background: rgba(255,255,255,0.15); transform: translateY(-2px); }
        .link { fill: none; stroke-width: 2px; opacity: 0.4; transition: all 0.3s; }
        .link.highlighted { opacity: 1; stroke-width: 3px; }
        .link.dimmed { opacity: 0.1; }
        .node { cursor: pointer; }
        .node-bg { transition: all 0.3s; }
        .node:hover .node-bg { filter: brightness(1.2); }
        .node.selected .node-bg { filter: brightness(1.3); }
        .node.dimmed { opacity: 0.2; }
        .node.approved .node-bg { stroke: #4ade80 !important; stroke-width: 3px; }
        .node.rejected .node-bg { stroke: #f87171 !important; stroke-width: 3px; }
        .node-glow { opacity: 0; transition: opacity 0.3s; }
        .node:hover .node-glow, .node.selected .node-glow { opacity: 0.6; }
        .node-content { font-size: 11px; font-weight: 500; fill: #fff; text-anchor: middle; pointer-events: none; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
        .node-content tspan { font-size: 11px; }
        .confidence-ring { fill: none; stroke-width: 3px; opacity: 0.8; }
        .confidence-ring-bg { fill: none; stroke: rgba(255,255,255,0.1); stroke-width: 3px; }
        .node-confidence-label { font-size: 11px; font-weight: 600; fill: rgba(255,255,255,0.8); text-anchor: middle; pointer-events: none; }
        .sequence-badge { font-size: 9px; font-weight: 700; fill: #fff; text-anchor: middle; }
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 2000; display: none; align-items: center; justify-content: center; }
        .modal-overlay.active { display: flex; }
        .modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; }
        .modal h2 { font-size: 18px; margin-bottom: 16px; color: #4ade80; }
        .modal pre { background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; font-size: 11px; overflow-x: auto; max-height: 300px; margin-bottom: 16px; }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    </style>
</head>
<body>
    <div class="bg-gradient"></div>
    <div class="header">
        <h1 id="title">AoT Plan Review</h1>
        <div class="meta">
            <span><div class="dot" style="background: #22c55e;"></div> <span id="stat-conclusions">0</span> Conclusions</span>
            <span><div class="dot" style="background: #3b82f6;"></div> <span id="stat-total">0</span> Atoms</span>
            <span id="timestamp"></span>
        </div>
        <div class="status-badge pending" id="status-badge"><span>Pending Review</span></div>
    </div>
    <div class="container">
        <div class="sidebar">
            <div class="section">
                <div class="section-title">Statistics</div>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value" id="stat-confidence">0%</div><div class="stat-label">Avg Confidence</div></div>
                    <div class="stat-card"><div class="stat-value" id="stat-depth">0</div><div class="stat-label">Max Depth</div></div>
                    <div class="stat-card"><div class="stat-value" id="stat-branches">0</div><div class="stat-label">Branch Points</div></div>
                    <div class="stat-card"><div class="stat-value" id="stat-verified">0</div><div class="stat-label">Verified</div></div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">Atom Types</div>
                <div class="legend-grid">
                    <div class="legend-item"><div class="legend-icon" style="background: rgba(107,114,128,0.3); color: #9ca3af;">P</div><span>Premise</span></div>
                    <div class="legend-item"><div class="legend-icon" style="background: rgba(59,130,246,0.3); color: #60a5fa;">R</div><span>Reasoning</span></div>
                    <div class="legend-item"><div class="legend-icon" style="background: rgba(234,179,8,0.3); color: #facc15;">H</div><span>Hypothesis</span></div>
                    <div class="legend-item"><div class="legend-icon" style="background: rgba(6,182,212,0.3); color: #22d3ee;">V</div><span>Verification</span></div>
                    <div class="legend-item" style="grid-column: span 2;"><div class="legend-icon" style="background: rgba(34,197,94,0.3); color: #4ade80;">C</div><span>Conclusion</span></div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">
                    <span>Review Phases</span>
                    <span id="approval-count">0/0 approved</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width: 0%"></div></div>
                <div id="phase-list"></div>
            </div>
            <div class="sidebar-footer">
                <button class="action-btn primary" id="approve-btn" disabled><span>Approve & Continue</span></button>
                <button class="action-btn secondary" id="export-btn"><span>Export Review</span></button>
                <div class="action-hint">All phases must be approved to continue</div>
            </div>
        </div>
        <div class="graph-container">
            <svg id="graph"></svg>
            <div class="tooltip" id="tooltip">
                <div class="tooltip-header">
                    <span class="tooltip-id">P1</span>
                    <span class="tooltip-type">premise</span>
                </div>
                <div class="tooltip-content">Content goes here</div>
                <div class="tooltip-meta">
                    <div class="tooltip-meta-item"><div class="label">Confidence</div><div class="value conf-value">95%</div></div>
                    <div class="tooltip-meta-item"><div class="label">Depth Level</div><div class="value depth-value">0</div></div>
                </div>
                <div class="tooltip-confidence-bar"><div class="tooltip-confidence-fill"></div></div>
                <div class="tooltip-deps"><strong>Dependencies:</strong><div class="dep-list"></div></div>
                <div class="tooltip-status"></div>
            </div>
            <div class="controls">
                <button class="control-btn" onclick="zoomIn()" title="Zoom In">+</button>
                <button class="control-btn" onclick="zoomOut()" title="Zoom Out">-</button>
                <button class="control-btn" onclick="resetZoom()" title="Reset View">R</button>
                <button class="control-btn" onclick="fitToScreen()" title="Fit to Screen">F</button>
            </div>
        </div>
    </div>
    <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
            <h2>Review Export</h2>
            <pre id="export-content"></pre>
            <div class="modal-actions">
                <button class="btn" style="background: rgba(255,255,255,0.1); color: #fff;" onclick="closeModal()">Close</button>
                <button class="btn" style="background: rgba(59,130,246,0.3); color: #60a5fa;" onclick="copyToClipboard()">Copy to Clipboard</button>
                <button class="btn btn-approve" onclick="closeModal(); submitReviewDirectly();">Submit to Claude</button>
            </div>
        </div>
    </div>
    <script>
        const colors = {
            premise: { main: '#6b7280', light: '#9ca3af', glow: 'rgba(107,114,128,0.5)' },
            reasoning: { main: '#3b82f6', light: '#60a5fa', glow: 'rgba(59,130,246,0.5)' },
            hypothesis: { main: '#eab308', light: '#facc15', glow: 'rgba(234,179,8,0.5)' },
            verification: { main: '#06b6d4', light: '#22d3ee', glow: 'rgba(6,182,212,0.5)' },
            conclusion: { main: '#22c55e', light: '#4ade80', glow: 'rgba(34,197,94,0.5)' }
        };
        const phaseConfig = {
            premise: { name: 'Premises', icon: 'P', order: 1 },
            reasoning: { name: 'Reasoning', icon: 'R', order: 2 },
            hypothesis: { name: 'Hypotheses', icon: 'H', order: 3 },
            verification: { name: 'Verification', icon: 'V', order: 4 },
            conclusion: { name: 'Conclusions', icon: 'C', order: 5 }
        };
        const typeLabels = { premise: 'PREMISE', reasoning: 'REASONING', hypothesis: 'HYPOTHESIS', verification: 'VERIFICATION', conclusion: 'CONCLUSION' };
        const TYPE_DEPTH = { premise: 0, reasoning: 1, hypothesis: 2, verification: 3, conclusion: 4 };

        const sampleData = {
            "title": "AoT Plan Review - Sample",
            "nodes": [
                {"id": "P1", "type": "premise", "content": "User needs feature X", "confidence": 0.95, "depth": 0},
                {"id": "R1", "type": "reasoning", "content": "Analysis shows approach A is best", "confidence": 0.85, "depth": 1},
                {"id": "H1", "type": "hypothesis", "content": "Implement using strategy Alpha", "confidence": 0.82, "depth": 2},
                {"id": "V1", "type": "verification", "content": "Strategy validated", "confidence": 0.90, "depth": 3, "isVerified": true},
                {"id": "C1", "type": "conclusion", "content": "Proceed with Alpha", "confidence": 0.92, "depth": 4}
            ],
            "links": [{"source": "P1", "target": "R1"}, {"source": "R1", "target": "H1"}, {"source": "H1", "target": "V1"}, {"source": "V1", "target": "C1"}]
        };

        function normalizeNode(node) {
            if (node.atomType && !node.type) node.type = node.atomType;
            if (node.type) node.type = node.type.toLowerCase();
            else {
                const id = (node.id || '').toUpperCase();
                if (id.startsWith('P')) node.type = 'premise';
                else if (id.startsWith('R')) node.type = 'reasoning';
                else if (id.startsWith('H')) node.type = 'hypothesis';
                else if (id.startsWith('V')) node.type = 'verification';
                else if (id.startsWith('C')) node.type = 'conclusion';
                else node.type = 'reasoning';
            }
            if (node.depth === undefined) node.depth = TYPE_DEPTH[node.type] || 1;
            if (node.confidence === undefined) node.confidence = 0.8;
            if (!node.content) node.content = node.statement || node.description || 'No content';
            return node;
        }

        let graphData = window.AOT_DATA || sampleData;
        if (graphData.nodes) graphData.nodes = graphData.nodes.map(normalizeNode);

        const dependencyMap = {};
        graphData.links.forEach(l => {
            const target = typeof l.target === 'object' ? l.target.id : l.target;
            const source = typeof l.source === 'object' ? l.source.id : l.source;
            if (!dependencyMap[target]) dependencyMap[target] = [];
            dependencyMap[target].push(source);
        });

        const nodes = graphData.nodes;
        const links = graphData.links;
        const totalAtoms = nodes.length;
        const avgConfidence = nodes.reduce((sum, n) => sum + n.confidence, 0) / totalAtoms;
        const maxDepth = Math.max(...nodes.map(n => n.depth));
        const conclusions = nodes.filter(n => n.type === 'conclusion').length;
        const verified = nodes.filter(n => n.confidence >= 0.85).length;
        const outgoingCounts = {};
        links.forEach(l => { const src = typeof l.source === 'object' ? l.source.id : l.source; outgoingCounts[src] = (outgoingCounts[src] || 0) + 1; });
        const branchPoints = Object.values(outgoingCounts).filter(c => c > 1).length;

        document.getElementById('title').textContent = graphData.title || 'AoT Plan Visualization';
        document.getElementById('timestamp').textContent = new Date().toLocaleString();
        document.getElementById('stat-total').textContent = totalAtoms;
        document.getElementById('stat-confidence').textContent = (avgConfidence * 100).toFixed(0) + '%';
        document.getElementById('stat-depth').textContent = maxDepth;
        document.getElementById('stat-branches').textContent = branchPoints;
        document.getElementById('stat-conclusions').textContent = conclusions;
        document.getElementById('stat-verified').textContent = verified;

        const approvalState = { phases: {}, nodes: {}, feedback: {} };
        function initApprovalState() {
            const phases = {};
            graphData.nodes.forEach(node => {
                if (!phases[node.type]) phases[node.type] = [];
                phases[node.type].push(node.id);
                approvalState.nodes[node.id] = null;
            });
            Object.keys(phases).forEach(type => { approvalState.phases[type] = null; });
            return phases;
        }
        const nodesByPhase = initApprovalState();

        function generatePhaseSummary(type, nodeIds) {
            const pnodes = nodeIds.map(id => graphData.nodes.find(n => n.id === id));
            const avgConf = pnodes.reduce((acc, n) => acc + n.confidence, 0) / pnodes.length;
            const descriptions = { premise: 'Foundational facts and constraints', reasoning: 'Logical deductions from premises', hypothesis: 'Proposed solutions being considered', verification: 'Tests and validations', conclusion: 'Final verified decisions' };
            return { description: descriptions[type] || '', avgConfidence: avgConf, nodes: pnodes, bulletPoints: pnodes.map(n => n.content.length > 80 ? n.content.substring(0, 77) + '...' : n.content) };
        }

        function buildApprovalSidebar() {
            const phaseList = document.getElementById('phase-list');
            phaseList.innerHTML = '';
            const sortedPhases = Object.entries(nodesByPhase).sort((a, b) => phaseConfig[a[0]].order - phaseConfig[b[0]].order);
            sortedPhases.forEach(([type, nodeIds]) => {
                const config = phaseConfig[type];
                const color = colors[type];
                const summary = generatePhaseSummary(type, nodeIds);
                const card = document.createElement('div');
                card.className = 'phase-card';
                card.id = 'phase-' + type;
                card.innerHTML =
                    '<div class="phase-header" onclick="togglePhase(\\'' + type + '\\')">' +
                        '<div class="phase-info">' +
                            '<div class="phase-icon" style="background: ' + color.main + '; color: #fff;">' + config.icon + '</div>' +
                            '<div><div class="phase-title">' + config.name + '</div><div class="phase-count">' + nodeIds.length + ' atom' + (nodeIds.length > 1 ? 's' : '') + '</div></div>' +
                        '</div>' +
                        '<div class="phase-actions">' +
                            '<button class="btn btn-approve" onclick="approvePhase(\\'' + type + '\\', event)">OK</button>' +
                            '<button class="btn btn-reject" onclick="rejectPhase(\\'' + type + '\\', event)">X</button>' +
                            '<button class="btn btn-expand">V</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="phase-summary" style="--phase-color: ' + color.main + '">' +
                        '<div class="phase-summary-title">Summary</div>' +
                        '<div class="phase-summary-content">' + summary.description + '</div>' +
                        '<ul class="phase-summary-bullets">' + summary.bulletPoints.map(function(bp) { return '<li>' + bp + '</li>'; }).join('') + '</ul>' +
                        '<div class="phase-summary-stats">' +
                            '<div class="phase-stat"><span class="phase-stat-value">' + nodeIds.length + '</span><span class="phase-stat-label">Atoms</span></div>' +
                            '<div class="phase-stat"><span class="phase-stat-value" style="color: ' + color.light + '">' + (summary.avgConfidence * 100).toFixed(0) + '%</span><span class="phase-stat-label">Avg Conf</span></div>' +
                        '</div>' +
                        '<div class="phase-toggle-details" onclick="togglePhaseDetails(\\'' + type + '\\', event)"><span class="details-icon">></span><span>Show individual atoms</span></div>' +
                    '</div>' +
                    '<div class="node-list">' +
                        nodeIds.map(function(nodeId) {
                            var node = graphData.nodes.find(function(n) { return n.id === nodeId; });
                            return '<div class="node-item" id="node-item-' + nodeId + '">' +
                                '<div class="node-header"><span class="node-id">' + nodeId + '</span><span class="node-confidence">' + (node.confidence * 100).toFixed(0) + '%</span></div>' +
                                '<div class="node-content-text">' + node.content + '</div>' +
                                '<div class="node-actions"><button class="btn btn-approve" onclick="approveNode(\\'' + nodeId + '\\', event)">Approve</button><button class="btn btn-reject" onclick="rejectNode(\\'' + nodeId + '\\', event)">Reject</button></div>' +
                                '<div class="feedback-container" id="feedback-' + nodeId + '"><div class="feedback-label">What needs to change?</div><textarea class="feedback-input" placeholder="Explain what is wrong..." onchange="updateFeedback(\\'' + nodeId + '\\', this.value)"></textarea></div>' +
                            '</div>';
                        }).join('') +
                    '</div>';
                phaseList.appendChild(card);
            });
        }

        function togglePhaseDetails(type, event) { event.stopPropagation(); var card = document.getElementById('phase-' + type); card.classList.toggle('show-details'); var icon = card.querySelector('.details-icon'); var text = card.querySelector('.phase-toggle-details span:last-child'); if (card.classList.contains('show-details')) { icon.textContent = 'v'; text.textContent = 'Hide individual atoms'; } else { icon.textContent = '>'; text.textContent = 'Show individual atoms'; } }
        function togglePhase(type) { var card = document.getElementById('phase-' + type); card.classList.toggle('expanded'); card.querySelector('.btn-expand').textContent = card.classList.contains('expanded') ? '^' : 'V'; }
        function approvePhase(type, event) { event.stopPropagation(); approvalState.phases[type] = true; nodesByPhase[type].forEach(function(nodeId) { approvalState.nodes[nodeId] = true; delete approvalState.feedback[nodeId]; }); updateUI(); }
        function rejectPhase(type, event) { event.stopPropagation(); approvalState.phases[type] = false; nodesByPhase[type].forEach(function(nodeId) { approvalState.nodes[nodeId] = false; }); document.getElementById('phase-' + type).classList.add('expanded'); updateUI(); }
        function approveNode(nodeId, event) { event.stopPropagation(); approvalState.nodes[nodeId] = true; delete approvalState.feedback[nodeId]; recalculatePhaseStatus(nodeId); updateUI(); }
        function rejectNode(nodeId, event) { event.stopPropagation(); approvalState.nodes[nodeId] = false; recalculatePhaseStatus(nodeId); updateUI(); }
        function updateFeedback(nodeId, feedback) { approvalState.feedback[nodeId] = feedback; }
        function recalculatePhaseStatus(nodeId) { var node = graphData.nodes.find(function(n) { return n.id === nodeId; }); var type = node.type; var nodeIds = nodesByPhase[type]; var allApproved = nodeIds.every(function(id) { return approvalState.nodes[id] === true; }); var anyRejected = nodeIds.some(function(id) { return approvalState.nodes[id] === false; }); if (allApproved) approvalState.phases[type] = true; else if (anyRejected) approvalState.phases[type] = false; else approvalState.phases[type] = null; }

        function updateUI() {
            Object.entries(approvalState.phases).forEach(function(entry) { var type = entry[0]; var status = entry[1]; var card = document.getElementById('phase-' + type); card.classList.remove('approved', 'rejected'); if (status === true) card.classList.add('approved'); if (status === false) card.classList.add('rejected'); });
            Object.entries(approvalState.nodes).forEach(function(entry) {
                var nodeId = entry[0]; var status = entry[1];
                var item = document.getElementById('node-item-' + nodeId);
                var feedbackEl = document.getElementById('feedback-' + nodeId);
                if (item) { item.classList.remove('approved', 'rejected'); if (status === true) item.classList.add('approved'); if (status === false) item.classList.add('rejected'); }
                if (feedbackEl) feedbackEl.classList.toggle('active', status === false);
                var graphNode = d3.select('#graph-node-' + nodeId);
                graphNode.classed('approved', status === true).classed('rejected', status === false);
            });
            var total = Object.keys(approvalState.nodes).length;
            var approved = Object.values(approvalState.nodes).filter(function(s) { return s === true; }).length;
            document.getElementById('approval-count').textContent = approved + '/' + total + ' approved';
            document.getElementById('progress-fill').style.width = ((approved / total) * 100) + '%';
            var allApproved = Object.values(approvalState.phases).every(function(s) { return s === true; });
            document.getElementById('approve-btn').disabled = !allApproved;
            var badge = document.getElementById('status-badge');
            if (allApproved) { badge.className = 'status-badge approved'; badge.innerHTML = '<span>All Approved</span>'; }
            else { badge.className = 'status-badge pending'; badge.innerHTML = '<span>Pending Review</span>'; }
        }

        function exportReview() { document.getElementById('export-content').textContent = JSON.stringify(buildFullApprovalResult(), null, 2); document.getElementById('modal-overlay').classList.add('active'); }
        function submitReviewDirectly() { var result = buildFullApprovalResult(); triggerApprovalDownload(result); showSuccessMessage(result.status === 'APPROVED' ? 'All phases approved!' : 'Review submitted with feedback.'); }
        function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }
        function copyToClipboard() { navigator.clipboard.writeText(document.getElementById('export-content').textContent).then(function() { alert('Copied!'); }); }
        function approveAndContinue() { var result = buildFullApprovalResult(); result.status = 'APPROVED'; triggerApprovalDownload(result); showSuccessMessage('All phases approved!'); }

        function buildFullApprovalResult() {
            var result = { status: Object.values(approvalState.phases).every(function(s) { return s === true; }) ? 'APPROVED' : 'NEEDS_REVISION', timestamp: new Date().toISOString(), title: graphData.title, phases: {}, rejections: [], approvedNodes: [], originalData: graphData };
            Object.entries(approvalState.phases).forEach(function(entry) { var type = entry[0]; var status = entry[1]; result.phases[type] = status === true ? 'approved' : status === false ? 'rejected' : 'pending'; });
            Object.entries(approvalState.nodes).forEach(function(entry) { var nodeId = entry[0]; var status = entry[1]; if (status === false) result.rejections.push({ nodeId: nodeId, node: graphData.nodes.find(function(n) { return n.id === nodeId; }), feedback: approvalState.feedback[nodeId] || 'No feedback' }); else if (status === true) result.approvedNodes.push(nodeId); });
            return result;
        }
        function triggerApprovalDownload(result) { var blob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aot-approval-' + Date.now() + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); navigator.clipboard.writeText(JSON.stringify(result, null, 2)).catch(function() {}); }
        function showSuccessMessage(message) { var overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:3000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;'; overlay.innerHTML = '<div style="font-size:64px;">OK</div><div style="font-size:24px;font-weight:600;color:#4ade80;">' + message + '</div><div style="font-size:14px;color:#9ca3af;">You can close this window.</div>'; document.body.appendChild(overlay); }

        document.getElementById('approve-btn').addEventListener('click', approveAndContinue);
        document.getElementById('export-btn').addEventListener('click', exportReview);
        buildApprovalSidebar();

        var container = document.querySelector('.graph-container');
        var width = container.clientWidth, height = container.clientHeight;
        var svg = d3.select('#graph').attr('width', width).attr('height', height);
        var defs = svg.append('defs');
        Object.entries(colors).forEach(function(entry) { var type = entry[0]; var color = entry[1]; var g = defs.append('linearGradient').attr('id', 'gradient-' + type).attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%'); g.append('stop').attr('offset', '0%').attr('stop-color', color.light); g.append('stop').attr('offset', '100%').attr('stop-color', color.main); });
        var glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%'); glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur'); var glowMerge = glow.append('feMerge'); glowMerge.append('feMergeNode').attr('in', 'coloredBlur'); glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');
        defs.append('marker').attr('id', 'arrowhead').attr('viewBox', '-0 -5 10 10').attr('refX', 8).attr('refY', 0).attr('orient', 'auto').attr('markerWidth', 8).attr('markerHeight', 8).append('path').attr('d', 'M 0,-4 L 8,0 L 0,4').attr('fill', 'rgba(255,255,255,0.4)');
        defs.append('marker').attr('id', 'arrowhead-highlight').attr('viewBox', '-0 -5 10 10').attr('refX', 8).attr('refY', 0).attr('orient', 'auto').attr('markerWidth', 8).attr('markerHeight', 8).append('path').attr('d', 'M 0,-4 L 8,0 L 0,4').attr('fill', '#4ade80');

        var zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', function(event) { g.attr('transform', event.transform); });
        svg.call(zoom);
        var g = svg.append('g');
        var getRadius = function(d) { return 45 + d.confidence * 15; };
        function wrapText(text, maxWidth) { var words = text.split(/\\s+/); var lines = []; var currentLine = ''; words.forEach(function(word) { var testLine = currentLine ? currentLine + ' ' + word : word; if (testLine.length > maxWidth) { if (currentLine) lines.push(currentLine); currentLine = word; } else { currentLine = testLine; } }); if (currentLine) lines.push(currentLine); if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].substring(0, lines[2].length - 3) + '...'; } return lines; }

        var simulation = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(180).strength(0.8)).force('charge', d3.forceManyBody().strength(-800)).force('center', d3.forceCenter(width / 2, height / 2)).force('y', d3.forceY(function(d) { return 100 + d.depth * 160; }).strength(1.2)).force('x', d3.forceX(width / 2).strength(0.08)).force('collision', d3.forceCollide().radius(function(d) { return getRadius(d) + 30; }));
        var link = g.append('g').attr('class', 'links').selectAll('path').data(links).join('path').attr('class', 'link').attr('stroke', 'rgba(255,255,255,0.3)').attr('marker-end', 'url(#arrowhead)');
        var node = g.append('g').attr('class', 'nodes').selectAll('g').data(nodes).join('g').attr('class', 'node').attr('id', function(d) { return 'graph-node-' + d.id; }).call(d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended)).on('click', selectNode).on('mouseenter', showTooltip).on('mousemove', moveTooltip).on('mouseleave', hideTooltip);
        node.append('circle').attr('class', 'node-glow').attr('r', function(d) { return getRadius(d) + 20; }).attr('fill', function(d) { return colors[d.type].glow; }).attr('filter', 'url(#glow)');
        node.append('circle').attr('class', 'confidence-ring-bg').attr('r', function(d) { return getRadius(d) + 8; });
        node.append('circle').attr('class', 'confidence-ring').attr('r', function(d) { return getRadius(d) + 8; }).attr('stroke', function(d) { return colors[d.type].light; }).attr('stroke-dasharray', function(d) { var c = 2 * Math.PI * (getRadius(d) + 8); return (c * d.confidence) + ' ' + c; }).attr('transform', 'rotate(-90)');
        node.append('circle').attr('class', 'node-bg').attr('r', function(d) { return getRadius(d); }).attr('fill', function(d) { return 'url(#gradient-' + d.type + ')'; }).attr('stroke', function(d) { return colors[d.type].light; }).attr('stroke-width', 2);
        node.each(function(d) { var n = d3.select(this); var r = getRadius(d); var lines = wrapText(d.content, Math.floor(r / 4)); var lh = 13; var sy = -((lines.length - 1) * lh) / 2; var t = n.append('text').attr('class', 'node-content').attr('y', sy); lines.forEach(function(line, i) { t.append('tspan').attr('x', 0).attr('dy', i === 0 ? 0 : lh).text(line); }); });
        node.append('text').attr('class', 'node-confidence-label').attr('dy', function(d) { return getRadius(d) + 22; }).text(function(d) { return (d.confidence * 100).toFixed(0) + '%'; });
        node.filter(function(d) { return d.type === 'verification'; }).append('text').attr('class', 'status-icon').attr('y', function(d) { return -getRadius(d) - 12; }).text(function(d) { return d.isVerified || d.confidence >= 0.8 ? 'OK' : '?'; }).attr('fill', function(d) { return d.isVerified || d.confidence >= 0.8 ? '#4ade80' : '#facc15'; }).style('text-anchor', 'middle').style('font-size', '14px');
        node.append('circle').attr('cx', function(d) { return getRadius(d) * 0.7; }).attr('cy', function(d) { return -getRadius(d) * 0.7; }).attr('r', 12).attr('fill', function(d) { return colors[d.type].main; }).attr('stroke', '#fff').attr('stroke-width', 1.5);
        node.append('text').attr('class', 'sequence-badge').attr('x', function(d) { return getRadius(d) * 0.7; }).attr('y', function(d) { return -getRadius(d) * 0.7 + 4; }).text(function(d) { return d.id; });

        simulation.on('tick', function() {
            link.attr('d', function(d) { var sr = getRadius(d.source), tr = getRadius(d.target); var dx = d.target.x - d.source.x, dy = d.target.y - d.source.y; var dist = Math.sqrt(dx * dx + dy * dy); var sx = d.source.x + (dx / dist) * sr, sy = d.source.y + (dy / dist) * sr; var tx = d.target.x - (dx / dist) * (tr + 14), ty = d.target.y - (dy / dist) * (tr + 14); var mx = (sx + tx) / 2, my = (sy + ty) / 2; var offset = Math.min(35, dist * 0.12); var px = -(ty - sy) / dist * offset, py = (tx - sx) / dist * offset; return 'M' + sx + ',' + sy + ' Q' + (mx + px) + ',' + (my + py) + ' ' + tx + ',' + ty; });
            node.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
        });
        function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
        function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
        function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

        var selectedNode = null;
        function selectNode(event, d) {
            event.stopPropagation();
            selectedNode = d;
            node.classed('selected', function(n) { return n.id === d.id; }).classed('dimmed', function(n) { return !isConnected(d, n); });
            link.classed('highlighted', function(l) { return l.source.id === d.id || l.target.id === d.id; }).classed('dimmed', function(l) { return l.source.id !== d.id && l.target.id !== d.id; });
            link.attr('marker-end', function(l) { return (l.source.id === d.id || l.target.id === d.id) ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)'; });
            var item = document.getElementById('node-item-' + d.id);
            if (item) { var card = item.closest('.phase-card'); if (!card.classList.contains('expanded')) card.classList.add('expanded'); item.scrollIntoView({ behavior: 'smooth', block: 'center' }); item.style.background = 'rgba(99, 102, 241, 0.2)'; setTimeout(function() { item.style.background = ''; }, 1000); }
        }
        function isConnected(a, b) { return a.id === b.id || links.some(function(l) { return (l.source.id === a.id && l.target.id === b.id) || (l.source.id === b.id && l.target.id === a.id); }); }
        svg.on('click', function() { selectedNode = null; node.classed('selected', false).classed('dimmed', false); link.classed('highlighted', false).classed('dimmed', false); link.attr('marker-end', 'url(#arrowhead)'); });

        function showTooltip(event, d) {
            var tt = document.getElementById('tooltip');
            tt.querySelector('.tooltip-id').textContent = d.id + ' - ' + typeLabels[d.type];
            tt.querySelector('.tooltip-type').textContent = d.type;
            tt.querySelector('.tooltip-type').style.background = colors[d.type].main;
            tt.querySelector('.tooltip-content').textContent = d.content;
            tt.querySelector('.conf-value').textContent = (d.confidence * 100).toFixed(0) + '%';
            tt.querySelector('.depth-value').textContent = 'Level ' + d.depth;
            var confFill = tt.querySelector('.tooltip-confidence-fill');
            confFill.style.width = (d.confidence * 100) + '%';
            confFill.style.background = 'linear-gradient(90deg, ' + colors[d.type].main + ', ' + colors[d.type].light + ')';
            var deps = dependencyMap[d.id] || [];
            var depList = tt.querySelector('.dep-list');
            depList.innerHTML = '';
            if (deps.length === 0) { depList.innerHTML = '<span class="dep-tag">None (root)</span>'; }
            else { deps.forEach(function(dep) { var depNode = nodes.find(function(n) { return n.id === dep; }); var tag = document.createElement('span'); tag.className = 'dep-tag'; tag.style.borderLeft = '3px solid ' + colors[depNode ? depNode.type : 'premise'].main; tag.textContent = dep; depList.appendChild(tag); }); }
            var status = tt.querySelector('.tooltip-status');
            if (d.confidence >= 0.9) { status.className = 'tooltip-status verified'; status.innerHTML = 'High confidence - ready to proceed'; }
            else if (d.confidence >= 0.7) { status.className = 'tooltip-status unverified'; status.innerHTML = 'Moderate confidence - review recommended'; }
            else { status.className = 'tooltip-status low-conf'; status.innerHTML = 'Low confidence - needs validation'; }
            if (d.type === 'verification') { var isVerified = d.isVerified || d.confidence >= 0.8; status.innerHTML = isVerified ? 'Verification passed' : 'Verification pending'; status.className = isVerified ? 'tooltip-status verified' : 'tooltip-status low-conf'; }
            if (d.type === 'conclusion') { status.innerHTML = d.confidence >= 0.9 ? 'Final decision - high confidence' : 'Proposed - ' + (d.confidence * 100).toFixed(0) + '%'; }
            tt.classList.add('visible');
        }
        function moveTooltip(event) { var tt = document.getElementById('tooltip'); var x = event.clientX + 20, y = event.clientY + 20; var rect = tt.getBoundingClientRect(); if (x + rect.width > window.innerWidth - 20) x = event.clientX - rect.width - 20; if (y + rect.height > window.innerHeight - 20) y = event.clientY - rect.height - 20; tt.style.left = x + 'px'; tt.style.top = y + 'px'; }
        function hideTooltip() { document.getElementById('tooltip').classList.remove('visible'); }
        function zoomIn() { svg.transition().duration(300).call(zoom.scaleBy, 1.4); }
        function zoomOut() { svg.transition().duration(300).call(zoom.scaleBy, 0.7); }
        function resetZoom() { svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity); }
        function fitToScreen() { setTimeout(function() { var bounds = g.node().getBBox(); var padding = 80; var scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height, 1.5); var tx = (width - bounds.width * scale) / 2 - bounds.x * scale; var ty = (height - bounds.height * scale) / 2 - bounds.y * scale; svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)); }, 100); }
        setTimeout(fitToScreen, 1500);
        window.addEventListener('resize', function() { var nw = container.clientWidth, nh = container.clientHeight; svg.attr('width', nw).attr('height', nh); simulation.force('center', d3.forceCenter(nw / 2, nh / 2)); simulation.alpha(0.3).restart(); });
    <\/script>
</body>
</html>`;
