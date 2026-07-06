import { CausalLink, GraphData, GraphNode } from './types.js';

export type RenderFormat = 'tree' | 'mermaid' | 'dot' | 'canvas';

const TYPE_LETTER: Record<string, string> = {
  premise: 'P',
  reasoning: 'R',
  hypothesis: 'H',
  verification: 'V',
  conclusion: 'C',
};

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// ---------------------------------------------------------------------------
// Causal (systems) layer rendering — shared preprocessing + per-format edges.
// The dependency-tree/DAG body of every renderer is unchanged; causal edges
// are appended so output is byte-identical when a graph has no causal links.
// ---------------------------------------------------------------------------

/**
 * Normalize a graph's causal links for rendering: drop links with either
 * endpoint missing from the node set (silently), keep self-loops, and sort
 * deterministically (from, to, id). Absent/empty → [] so today's output is
 * unchanged.
 */
function normalizeCausalLinksForRender(graph: GraphData): CausalLink[] {
  const ids = new Set(graph.nodes.map(node => node.id));
  return (graph.causalLinks ?? [])
    .filter(link => ids.has(link.from) && ids.has(link.to))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id));
}

/**
 * EDGE_LABEL composition (single rule, all formats): `{sign}{/gain if
 * low|high}{ + ' ' + label if present}`, whitespace-collapsed and truncated
 * at 40 chars. Minus is ASCII `-` (CausalSign). med/undefined gain adds no
 * suffix.
 */
function causalEdgeLabel(link: CausalLink): string {
  const gainSuffix = link.gain === 'low' || link.gain === 'high' ? `/${link.gain}` : '';
  const label = (link.label ?? '').replace(/\s+/g, ' ').trim();
  const composed = label ? `${link.sign}${gainSuffix} ${label}` : `${link.sign}${gainSuffix}`;
  return truncate(composed, 40);
}

/** Mermaid edge-label escapes. Kept separate from mermaidEscape (node labels). */
function mermaidEdgeLabelEscape(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/\s+/g, ' ');
}

/** DOT label escapes: backslash first, then quote (order matters). */
function dotLabelEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nodeLabel(node: GraphNode, max = 60): string {
  const verified = node.isVerified ? ' ✓' : '';
  return `[${TYPE_LETTER[node.type] ?? '?'}] ${node.id}${verified} (${Math.round(node.confidence * 100)}%) ${truncate(node.content, max)}`;
}

export function renderTree(graph: GraphData): string {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const link of graph.links) {
    const list = children.get(link.source) ?? [];
    list.push(link.target);
    children.set(link.source, list);
    hasParent.add(link.target);
  }
  const roots = graph.nodes.filter(node => !hasParent.has(node.id));

  const lines: string[] = [graph.title, ''];
  const visited = new Set<string>();
  const render = (id: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const node = byId.get(id);
    if (!node) return;
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
    if (visited.has(id)) {
      lines.push(`${prefix}${connector}${id} (see above)`);
      return;
    }
    visited.add(id);
    lines.push(`${prefix}${connector}${nodeLabel(node)}`);
    const kids = children.get(id) ?? [];
    const childPrefix = isRoot ? prefix : prefix + (isLast ? '    ' : '│   ');
    kids.forEach((kid, index) => render(kid, childPrefix, index === kids.length - 1, false));
  };
  roots.forEach(root => render(root.id, '', true, true));

  const causal = normalizeCausalLinksForRender(graph);
  if (causal.length > 0) {
    lines.push('', 'Causal links:');
    for (const link of causal) {
      const gainSuffix = link.gain === 'low' || link.gain === 'high' ? `/${link.gain}` : '';
      const label = (link.label ?? '').replace(/\s+/g, ' ').trim();
      lines.push(`  ${link.from} --(${link.sign}${gainSuffix})--> ${link.to}${label ? `  ${label}` : ''}`);
    }
  }
  return lines.join('\n');
}

function mermaidEscape(text: string): string {
  return text.replace(/"/g, '#quot;');
}

export function renderMermaid(graph: GraphData): string {
  const lines = ['graph TD'];
  for (const node of graph.nodes) {
    lines.push(`  ${node.id}["${mermaidEscape(nodeLabel(node, 40))}"]`);
  }
  for (const link of graph.links) {
    const label = link.relation && link.relation !== 'depends_on' ? `|${link.relation}|` : '';
    lines.push(`  ${link.source} -->${label} ${link.target}`);
  }
  for (const link of normalizeCausalLinksForRender(graph)) {
    lines.push(`  ${link.from} -.->|${mermaidEdgeLabelEscape(causalEdgeLabel(link))}| ${link.to}`);
  }
  const verified = graph.nodes.filter(node => node.isVerified).map(node => node.id);
  if (verified.length > 0) {
    lines.push('  classDef verified stroke:#2e7d32,stroke-width:2px;');
    lines.push(`  class ${verified.join(',')} verified;`);
  }
  return lines.join('\n');
}

export function renderDot(graph: GraphData): string {
  const lines = ['digraph aot {', '  rankdir=TB;', '  node [shape=box, fontsize=10];'];
  for (const node of graph.nodes) {
    const color = node.isVerified ? ', color="darkgreen"' : '';
    lines.push(`  "${node.id}" [label="${nodeLabel(node, 40).replace(/"/g, '\\"')}"${color}];`);
  }
  for (const link of graph.links) {
    const label = link.relation && link.relation !== 'depends_on' ? ` [label="${link.relation}"]` : '';
    lines.push(`  "${link.source}" -> "${link.target}"${label};`);
  }
  for (const link of normalizeCausalLinksForRender(graph)) {
    lines.push(`  "${link.from}" -> "${link.to}" [style=dashed, label="${dotLabelEscape(causalEdgeLabel(link))}", color="#9467bd"];`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Obsidian JSON Canvas (https://jsoncanvas.org), laid out in depth columns. */
export function renderCanvas(graph: GraphData): string {
  const COLUMN_WIDTH = 420;
  const ROW_HEIGHT = 160;
  const NODE_WIDTH = 360;
  const NODE_HEIGHT = 120;
  const TYPE_COLOR: Record<string, string> = {
    premise: '4',      // green
    reasoning: '5',    // cyan
    hypothesis: '3',   // yellow
    verification: '6', // purple
    conclusion: '1',   // red
  };

  const rowByDepth = new Map<number, number>();
  const nodes = graph.nodes.map(node => {
    const depth = node.depth ?? 0;
    const row = rowByDepth.get(depth) ?? 0;
    rowByDepth.set(depth, row + 1);
    return {
      id: node.id,
      type: 'text',
      text: `**${node.id}** (${node.type}, ${Math.round(node.confidence * 100)}%${node.isVerified ? ', verified' : ''})\n\n${node.content}`,
      x: depth * COLUMN_WIDTH,
      y: row * ROW_HEIGHT,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      color: TYPE_COLOR[node.type],
    };
  });
  const edges: Array<Record<string, unknown>> = graph.links.map((link, index) => ({
    id: `edge-${index}`,
    fromNode: link.source,
    fromSide: 'right',
    toNode: link.target,
    toSide: 'left',
    ...(link.relation && link.relation !== 'depends_on' ? { label: link.relation } : {}),
  }));
  // Causal edges: bottom→top routing keeps them visually orthogonal to the
  // dep right→left flow. `label` is always present (sign at minimum).
  normalizeCausalLinksForRender(graph).forEach((link, index) => {
    edges.push({
      id: `causal-edge-${index}`,
      fromNode: link.from,
      fromSide: 'bottom',
      toNode: link.to,
      toSide: 'top',
      color: '2',
      label: causalEdgeLabel(link),
    });
  });
  return JSON.stringify({ nodes, edges }, null, 2);
}

export function renderGraph(graph: GraphData, format: RenderFormat): string {
  switch (format) {
    case 'mermaid': return renderMermaid(graph);
    case 'dot': return renderDot(graph);
    case 'canvas': return renderCanvas(graph);
    default: return renderTree(graph);
  }
}
