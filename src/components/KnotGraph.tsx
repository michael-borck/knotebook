import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import dagre from 'dagre'
import { tagValue, type Graph } from '../lib/graph'
import { computeGraphView } from '../lib/graphView'
import {
  loadMapState,
  saveMapState,
  type MapPosition,
} from '../lib/mapState'
import type { KnotSelection } from '../lib/types'
import '@xyflow/react/dist/style.css'

export interface KnotNodeData extends Record<string, unknown> {
  label: string
  file: string
  line: number
  words: number
  kind: 'knot' | 'stitch'
  parent?: string
  entry: boolean
  missing: boolean
  deadEnd: boolean
  unreachable: boolean
  covered: boolean
  hasChildren: boolean
  collapsed: boolean
  selected: boolean
  note: string | null
  group: string | null
  onToggle?: (id: string) => void
}

const GROUP_COLORS = [
  '#c084fc',
  '#60a5fa',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  '#22d3ee',
  '#f472b6',
]

function groupColor(name: string): string {
  let hash = 0
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length]
}

const NODE_WIDTH = 176
const NODE_HEIGHT = 58
const NODE_TYPES = { knot: KnotNode }

function KnotNode({ id, data }: NodeProps) {
  const node = data as KnotNodeData
  const className = [
    'knot-card',
    node.kind === 'stitch' ? 'stitch' : '',
    node.missing ? 'missing' : '',
    node.deadEnd ? 'dead-end' : '',
    node.unreachable ? 'unreachable' : '',
    node.entry ? 'entry' : '',
    node.selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const group = node.group
  const groupColorValue = group ? groupColor(group) : null
  const meta = node.missing
    ? 'missing target'
    : node.deadEnd
      ? 'dead end'
      : node.unreachable
        ? 'unreachable'
        : node.kind === 'stitch'
          ? `${node.parent ?? 'stitch'} · ${node.words} words`
          : `${node.file} · ${node.words} words`

  const metaWithGroup = group ? `${meta} · ${group}` : meta

  return (
    <div
      className={className}
      style={
        groupColorValue
          ? { borderLeftColor: groupColorValue, borderLeftWidth: 3 }
          : undefined
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
      />
      <div className="knot-title-row">
        {node.covered && <span className="knot-dot" />}
        <span className="knot-title">{node.label}</span>
        {node.note && (
          <span className="knot-note" title={node.note}>
            note
          </span>
        )}
        {node.hasChildren && (
          <button
            type="button"
            className="knot-toggle nodrag"
            aria-label={`${node.collapsed ? 'Expand' : 'Collapse'} ${node.label}`}
            aria-expanded={!node.collapsed}
            onClick={(event) => {
              event.stopPropagation()
              node.onToggle?.(id)
            }}
          >
            {node.collapsed ? '+' : '−'}
          </button>
        )}
      </div>
      <div className="knot-meta">{metaWithGroup}</div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
      />
    </div>
  )
}

interface KnotGraphProps {
  graph: Graph
  visited: Set<string>
  selectedId: string | null
  stateKey: string
  onSelect: (node: KnotSelection) => void
  onResetCoverage?: () => void
}

export default function KnotGraph({
  graph,
  visited,
  selectedId,
  stateKey,
  onSelect,
  onResetCoverage,
}: KnotGraphProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(loadMapState(stateKey).collapsed),
  )
  const [positions, setPositions] = useState<Record<string, MapPosition>>(
    () => loadMapState(stateKey).positions,
  )
  const flowRef = useRef<ReactFlowInstance<Node<KnotNodeData>, Edge> | null>(
    null,
  )

  useEffect(() => {
    saveMapState(stateKey, {
      positions,
      collapsed: [...collapsed],
    })
  }, [stateKey, positions, collapsed])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void flowRef.current?.fitView({ padding: 0.2 })
    }, 60)
    return () => window.clearTimeout(handle)
  }, [selectedId])

  const { visibleNodes, visibleEdges, cycleEdges } = useMemo(
    () => computeGraphView(graph, collapsed),
    [graph, collapsed],
  )

  const { nodes, edges } = useMemo(() => {
    const layout = new dagre.graphlib.Graph()
    layout.setGraph({
      rankdir: 'LR',
      nodesep: 36,
      ranksep: 80,
      marginx: 24,
      marginy: 24,
    })
    layout.setDefaultEdgeLabel(() => ({}))

    for (const node of visibleNodes) {
      layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    }
    for (const edge of visibleEdges) {
      if (
        edge.source !== edge.target &&
        !cycleEdges.has(edge.id)
      ) {
        layout.setEdge(edge.source, edge.target)
      }
    }
    dagre.layout(layout)

    const nodes: Node<KnotNodeData>[] = visibleNodes.map((node) => {
      const position = positions[node.id] ?? layout.node(node.id)
      const note = tagValue(node.tags, 'note')
      const group =
        tagValue(node.tags, 'group') ?? tagValue(node.tags, 'chapter')
      return {
        id: node.id,
        type: 'knot',
        position: {
          x: (position?.x ?? 0) - NODE_WIDTH / 2,
          y: (position?.y ?? 0) - NODE_HEIGHT / 2,
        },
        data: {
          label: node.label,
          file: node.file,
          line: node.line,
          words: node.words,
          kind: node.kind,
          parent: node.parent,
          entry: node.entry,
          missing: node.missing,
          deadEnd: node.deadEnd,
          unreachable: node.unreachable,
          covered: visited.has(node.id),
          hasChildren: graph.edges.some((edge) => edge.source === node.id),
          collapsed: collapsed.has(node.id),
          selected: node.id === selectedId,
          note,
          group,
          onToggle: (id: string) => {
            setCollapsed((previous) => {
              const next = new Set(previous)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          },
        },
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      }
    })

    const edges: Edge[] = visibleEdges.map((edge) => {
      const cycle = cycleEdges.has(edge.id)
      const highlighted =
        selectedId === edge.source || selectedId === edge.target
      const color = highlighted ? '#c084fc' : cycle ? '#f59e0b' : '#aab3c5'
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 18,
          height: 18,
        },
        style: {
          stroke: color,
          strokeWidth: highlighted ? 3.2 : 2.4,
          strokeDasharray: cycle ? '6 4' : undefined,
        },
      }
    })

    return { nodes, edges }
  }, [
    visibleNodes,
    visibleEdges,
    cycleEdges,
    collapsed,
    positions,
    visited,
    selectedId,
    graph.edges,
  ])

  const realNodes = graph.nodes.filter((node) => !node.missing)
  const coveredCount = realNodes.filter((node) => visited.has(node.id)).length

  if (graph.nodes.length === 0) {
    return (
      <div className="graph-empty">
        No knots yet. Add <code>=== knot_name ===</code> headers to see the map.
      </div>
    )
  }

  return (
    <div className="graph-wrap">
      <div className="graph-legend">
        <span>
          <i className="lg entry" /> entry
        </span>
        <span>
          <i className="lg stitch" /> stitch
        </span>
        <span>
          <i className="lg covered" /> covered
        </span>
        <span>
          <i className="lg dead" /> dead end
        </span>
        <span>
          <i className="lg unreachable" /> unreachable
        </span>
        <span>
          <i className="lg missing" /> missing
        </span>
        <span>
          <i className="lg loop" /> loop
        </span>
        <span className="legend-count">
          {coveredCount}/{realNodes.length} covered
        </span>
        <button
          type="button"
          className="legend-reset"
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </button>
        <button
          type="button"
          className="legend-reset"
          onClick={() =>
            setCollapsed(
              new Set(
                graph.nodes
                  .filter((node) =>
                    graph.edges.some((edge) => edge.source === node.id),
                  )
                  .map((node) => node.id),
              ),
            )
          }
        >
          Collapse all
        </button>
        <button
          type="button"
          className="legend-reset"
          onClick={() => {
            setPositions({})
            window.setTimeout(() => {
              void flowRef.current?.fitView({ padding: 0.2 })
            }, 60)
          }}
        >
          Reset layout
        </button>
        {onResetCoverage && (
          <button
            type="button"
            className="legend-reset"
            onClick={onResetCoverage}
          >
            Reset
          </button>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        minZoom={0.2}
        nodesConnectable={false}
        nodesDraggable
        nodesFocusable
        aria-label="Knot map"
        onInit={(instance) => {
          flowRef.current = instance
        }}
        onNodeClick={(event, node) => {
          if ((event.target as HTMLElement).closest('.knot-toggle')) return
          const data = node.data as KnotNodeData
          if (data.line > 0) {
            onSelect({
              id: node.id,
              file: data.file,
              line: data.line,
              kind: data.kind,
              note: data.note,
              group: data.group,
            })
          }
        }}
        onNodeDragStop={(_, node) => {
          setPositions((previous) => ({
            ...previous,
            [node.id]: { x: node.position.x, y: node.position.y },
          }))
        }}
      >
        <Background color="#232633" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor="#2a2d3a"
          maskColor="rgba(16,17,23,0.85)"
        />
      </ReactFlow>
    </div>
  )
}