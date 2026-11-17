const KNOT_RE = /^===\s*([A-Za-z_][A-Za-z0-9_]*)\s*===\s*$/
const STITCH_RE = /^=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/
const ANY_KNOT_RE = /^===\s*[A-Za-z_][A-Za-z0-9_]*\s*===\s*$/m
const ANY_STITCH_RE = /^=\s*[A-Za-z_][A-Za-z0-9_]*\s*$/m

export interface KnotRange {
  startLine: number
  endLine: number
}

export function knotRange(source: string, knot: string): KnotRange | null {
  const lines = source.split('\n')
  const headerName = (line: string) => {
    const match = KNOT_RE.exec(line)
    return match ? match[1] : null
  }

  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (headerName(lines[index]) === knot) {
      start = index
      break
    }
  }
  if (start < 0) return null

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headerName(lines[index])) {
      end = index
      break
    }
  }
  return { startLine: start, endLine: end }
}

export function sliceKnot(source: string, knot: string): string | null {
  const range = knotRange(source, knot)
  if (!range) return null
  return source
    .split('\n')
    .slice(range.startLine, range.endLine)
    .join('\n')
    .trimEnd()
}

function stitchRange(
  source: string,
  knot: string,
  stitch: string,
): KnotRange | null {
  const range = knotRange(source, knot)
  if (!range) return null
  const lines = source.split('\n')
  let start = -1
  for (let index = range.startLine + 1; index < range.endLine; index += 1) {
    const match = STITCH_RE.exec(lines[index])
    if (match && match[1] === stitch) {
      start = index
      break
    }
  }
  if (start < 0) return null

  let end = range.endLine
  for (let index = start + 1; index < range.endLine; index += 1) {
    if (STITCH_RE.test(lines[index])) {
      end = index
      break
    }
  }
  return { startLine: start, endLine: end }
}

export function sliceStitch(
  source: string,
  knot: string,
  stitch: string,
): string | null {
  const range = stitchRange(source, knot, stitch)
  if (!range) return null
  return source
    .split('\n')
    .slice(range.startLine, range.endLine)
    .join('\n')
    .trimEnd()
}

export function sliceBlock(source: string, id: string): string | null {
  const [knot, stitch] = id.split('.')
  if (!knot) return null
  if (stitch) return sliceStitch(source, knot, stitch)
  return sliceKnot(source, knot)
}

export function replaceKnot(
  source: string,
  knot: string,
  block: string,
): string | null {
  const range = knotRange(source, knot)
  if (!range) return null

  const text = block.trim()
  if (!text) return null

  let normalized: string | null
  if (ANY_KNOT_RE.test(text)) {
    normalized = sliceKnot(text, knot)
    if (!normalized) return null
  } else {
    normalized = `=== ${knot} ===\n${text}`
  }

  const lines = source.split('\n')
  const replacement = normalized.split('\n')
  const tail = lines.slice(range.endLine)
  if (
    tail.length > 0 &&
    replacement[replacement.length - 1].trim() !== ''
  ) {
    replacement.push('')
  }

  const joined = [
    ...lines.slice(0, range.startLine),
    ...replacement,
    ...tail,
  ].join('\n')
  return source.endsWith('\n') && !joined.endsWith('\n')
    ? `${joined}\n`
    : joined
}

export function replaceStitch(
  source: string,
  knot: string,
  stitch: string,
  block: string,
): string | null {
  const range = stitchRange(source, knot, stitch)
  if (!range) return null

  const text = block.trim()
  if (!text) return null

  let normalized: string | null
  if (ANY_STITCH_RE.test(text) || ANY_KNOT_RE.test(text)) {
    normalized = sliceStitch(text, knot, stitch)
    if (!normalized) return null
  } else {
    normalized = `= ${stitch}\n${text}`
  }

  const lines = source.split('\n')
  const replacement = normalized.split('\n')
  const tail = lines.slice(range.endLine)
  if (
    tail.length > 0 &&
    replacement[replacement.length - 1].trim() !== ''
  ) {
    replacement.push('')
  }

  const joined = [
    ...lines.slice(0, range.startLine),
    ...replacement,
    ...tail,
  ].join('\n')
  return source.endsWith('\n') && !joined.endsWith('\n')
    ? `${joined}\n`
    : joined
}

export function replaceBlock(
  source: string,
  id: string,
  block: string,
): string | null {
  const [knot, stitch] = id.split('.')
  if (!knot) return null
  if (stitch) return replaceStitch(source, knot, stitch, block)
  return replaceKnot(source, knot, block)
}

export function mergeKnotEdits(
  source: string,
  edits: Record<string, string>,
  allowed: string[],
): { source: string; error: string | null } {
  let merged = source
  for (const [knot, block] of Object.entries(edits)) {
    if (!allowed.includes(knot)) {
      return {
        source: merged,
        error: `The model returned an unknown knot "${knot}".`,
      }
    }
    const next = replaceKnot(merged, knot, block)
    if (!next) {
      return {
        source: merged,
        error: `The model's revision did not include the knot "${knot}".`,
      }
    }
    merged = next
  }
  return { source: merged, error: null }
}
