import { AtomData, AtomType, GraphData, GraphNode, GraphLink } from './types.js';

const TYPE_DEPTH: Record<AtomType, number> = {
  premise: 0,
  reasoning: 1,
  hypothesis: 2,
  verification: 3,
  conclusion: 4,
};

export function exportGraph(
  atoms: Record<string, AtomData>,
  atomOrder: string[],
  title?: string
): GraphData {
  const nodes: GraphNode[] = atomOrder
    .filter(id => atoms[id] !== undefined)
    .map(id => {
      const atom = atoms[id];
      return {
        id: atom.atomId,
        type: atom.atomType,
        content: atom.content,
        confidence: atom.confidence,
        depth: atom.depth ?? TYPE_DEPTH[atom.atomType] ?? 0,
        isVerified: atom.isVerified || undefined,
        polarity: atom.polarity,
        isRefuted: atom.isRefuted || undefined,
        evidence: atom.evidence,
      };
    });

  const links: GraphLink[] = [];
  for (const id of atomOrder) {
    const atom = atoms[id];
    if (!atom) continue;
    for (const dep of atom.dependencies) {
      if (atoms[dep]) {
        links.push({ source: dep, target: id });
      }
    }
  }

  return {
    title: title || 'AoT Plan Visualization',
    nodes,
    links,
  };
}

/**
 * Inverse of exportGraph: rebuild an atoms map (+ insertion order) from
 * exported GraphData, making exports re-importable and letting analyze/graph
 * run over a file instead of persistent state.
 */
export function graphDataToAtoms(graph: GraphData): { atoms: Record<string, AtomData>; atomOrder: string[] } {
  const atoms: Record<string, AtomData> = {};
  const atomOrder: string[] = [];
  for (const node of graph.nodes ?? []) {
    if (!node.id || !node.type) continue;
    atoms[node.id] = {
      atomId: node.id,
      content: node.content ?? node.title ?? '',
      atomType: node.type,
      dependencies: [],
      confidence: typeof node.confidence === 'number' ? node.confidence : 0.7,
      created: Date.now(),
      isVerified: node.isVerified === true,
      depth: node.depth,
      polarity: node.polarity,
      isRefuted: node.isRefuted === true ? true : undefined,
      evidence: node.evidence,
    };
    atomOrder.push(node.id);
  }
  for (const link of graph.links ?? []) {
    // exportGraph emits source=dependency, target=dependent.
    const dependent = atoms[link.target];
    if (dependent && atoms[link.source] && !dependent.dependencies.includes(link.source)) {
      dependent.dependencies.push(link.source);
    }
  }
  return { atoms, atomOrder };
}
