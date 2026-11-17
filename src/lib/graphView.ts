import type { Graph, GraphEdge, GraphNode } from './graph'

export interface GraphView {
  roots: string[]
  visibleIds: Set<string>
  visibleNodes: GraphNode[]
  visibleEdges: GraphEdge[]
  cycleEdges: Set<string>
}

export function computeGraphView(
  graph: Graph,
  collapsed: Set<string>,
): GraphView {
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge.target)
    outgoing.set(edge.source, list)
  }

  const reachable = new Set<string>()
  const walk = (id: string) => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const next of outgoing.get(id) ?? []) walk(next)
  }
  for (const node of graph.nodes) {
    if (node.entry) walk(node.id)
  }

  const roots = graph.nodes
    .filter((node) => node.entry || !reachable.has(node.id))
    .map((node) => node.id)

  const visible = new Set<string>()
  const visit = (id: string) => {
    if (visible.has(id)) return
    visible.add(id)
    if (collapsed.has(id)) return
    for (const next of outgoing.get(id) ?? []) visit(next)
  }
  for (const root of roots) visit(root)

  const visibleNodes = graph.nodes.filter((node) => visible.has(node.id))
  const visibleEdges = graph.edges.filter(
    (edge) => visible.has(edge.source) && visible.has(edge.target),
  )

  const cycleEdges = new Set<string>()
  const state = new Map<string, number>()
  const visitCycle = (id: string) => {
    state.set(id, 1)
    for (const edge of visibleEdges) {
      if (edge.source !== id) continue
      const targetState = state.get(edge.target) ?? 0
      if (targetState === 1) cycleEdges.add(edge.id)
      else if (targetState === 0) visitCycle(edge.target)
    }
    state.set(id, 2)
  }
  for (const node of visibleNodes) {
    if (!state.get(node.id)) visitCycle(node.id)
  }

  return {
    roots,
    visibleIds: visible,
    visibleNodes,
    visibleEdges,
    cycleEdges,
  }
}