export interface MapPosition {
  x: number
  y: number
}

export interface MapState {
  positions: Record<string, MapPosition>
  collapsed: string[]
}

const PREFIX = 'knotebook.map.'

export function loadMapState(key: string): MapState {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return { positions: {}, collapsed: [] }
    const value = JSON.parse(raw) as Partial<MapState>
    const positions: Record<string, MapPosition> = {}
    if (value.positions && typeof value.positions === 'object') {
      for (const [id, position] of Object.entries(value.positions)) {
        if (
          position &&
          typeof position.x === 'number' &&
          typeof position.y === 'number' &&
          Number.isFinite(position.x) &&
          Number.isFinite(position.y)
        ) {
          positions[id] = { x: position.x, y: position.y }
        }
      }
    }
    const collapsed = Array.isArray(value.collapsed)
      ? value.collapsed.filter((id): id is string => typeof id === 'string')
      : []
    return { positions, collapsed }
  } catch {
    return { positions: {}, collapsed: [] }
  }
}

export function saveMapState(key: string, state: MapState): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(state))
  } catch {
    // Layout state is best-effort.
  }
}