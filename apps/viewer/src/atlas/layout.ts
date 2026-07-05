export interface GraphEdgeInput {
  id: string;
  from: string;
  to: string;
  label: string;
  count: number;
}

export interface GraphLayoutNode {
  id: string;
  layer: number;
  row: number;
  x: number;
  y: number;
}

export interface GraphLayoutEdge extends GraphEdgeInput {
  selfLoop: boolean;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  width: number;
  height: number;
  columnWidth: number;
  rowHeight: number;
}

export interface GraphLayoutOptions {
  columnWidth?: number;
  rowHeight?: number;
  margin?: number;
}

export const GRAPH_LAUNCH_NODE = "__launch__";

/**
 * Deterministic layered DAG layout: BFS-style longest-path layering from the
 * launch node (relaxation bounded by node count so cycles terminate), then
 * barycenter ordering within each layer with id tie-breaks.
 */
export function layoutAtlasGraph(nodeIds: string[], edges: GraphEdgeInput[], options: GraphLayoutOptions = {}): GraphLayout {
  const columnWidth = options.columnWidth ?? 220;
  const rowHeight = options.rowHeight ?? 150;
  const margin = options.margin ?? 40;

  const ids = [...new Set([...nodeIds, ...edges.flatMap((edge) => [edge.from, edge.to])])].sort();
  if (ids.length === 0) {
    return { nodes: [], edges: [], width: margin * 2, height: margin * 2, columnWidth, rowHeight };
  }

  const layers = new Map<string, number>();
  layers.set(GRAPH_LAUNCH_NODE, 0);
  const forwardEdges = edges.filter((edge) => edge.from !== edge.to);

  // Longest-path relaxation, bounded so cyclic maps still terminate.
  for (let pass = 0; pass < ids.length + 1; pass += 1) {
    let changed = false;
    for (const edge of forwardEdges) {
      const fromLayer = layers.get(edge.from);
      if (fromLayer === undefined) continue;
      const proposed = fromLayer + 1;
      const current = layers.get(edge.to);
      if ((current === undefined || proposed > current) && proposed <= ids.length) {
        layers.set(edge.to, proposed);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Nodes unreachable from launch sit one column after the deepest reached layer.
  const reachedMax = Math.max(0, ...[...layers.values()]);
  for (const id of ids) {
    if (!layers.has(id)) layers.set(id, id === GRAPH_LAUNCH_NODE ? 0 : reachedMax + 1);
  }

  const layerGroups = new Map<number, string[]>();
  for (const id of ids) {
    const layer = layers.get(id)!;
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

  const orderedLayers = [...layerGroups.keys()].sort((left, right) => left - right);
  const rowById = new Map<string, number>();

  for (const layer of orderedLayers) {
    const group = layerGroups.get(layer)!;
    const scored = group.map((id) => {
      const predecessors = forwardEdges
        .filter((edge) => edge.to === id)
        .map((edge) => rowById.get(edge.from))
        .filter((row): row is number => row !== undefined);
      const barycenter = predecessors.length > 0 ? predecessors.reduce((sum, row) => sum + row, 0) / predecessors.length : Number.MAX_SAFE_INTEGER;
      return { id, barycenter };
    });
    scored.sort((left, right) => left.barycenter - right.barycenter || left.id.localeCompare(right.id));
    scored.forEach((entry, index) => rowById.set(entry.id, index));
  }

  const layerIndexById = new Map<string, number>();
  orderedLayers.forEach((layer, index) => {
    for (const id of layerGroups.get(layer)!) layerIndexById.set(id, index);
  });

  const nodes: GraphLayoutNode[] = ids.map((id) => {
    const layer = layerIndexById.get(id)!;
    const row = rowById.get(id)!;
    return {
      id,
      layer,
      row,
      x: margin + layer * columnWidth,
      y: margin + row * rowHeight
    };
  });
  nodes.sort((left, right) => left.layer - right.layer || left.row - right.row || left.id.localeCompare(right.id));

  const maxRows = Math.max(...orderedLayers.map((layer) => layerGroups.get(layer)!.length));

  return {
    nodes,
    edges: edges.map((edge) => ({ ...edge, selfLoop: edge.from === edge.to })),
    width: margin * 2 + (orderedLayers.length - 1) * columnWidth + 170,
    height: margin * 2 + (maxRows - 1) * rowHeight + 120,
    columnWidth,
    rowHeight
  };
}
