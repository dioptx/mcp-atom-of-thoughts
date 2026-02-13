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
