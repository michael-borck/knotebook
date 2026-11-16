interface ParsedVersion {
  core: number[]
  prerelease: string[]
}

function parseVersion(value: string): ParsedVersion | null {
  const [core, ...rest] = value.trim().split('-')
  const parts = core.split(/[.+]/)
  if (parts.length === 0 || !parts.every((part) => /^\d+$/.test(part))) {
    return null
  }
  return {
    core: parts.map((part) => Number.parseInt(part, 10)),
    prerelease: rest.join('-').split('.').filter(Boolean),
  }
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) {
    return a.trim().localeCompare(b.trim())
  }

  const length = Math.max(left.core.length, right.core.length)
  for (let index = 0; index < length; index += 1) {
    const l = left.core[index] ?? 0
    const r = right.core[index] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const preLength = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < preLength; index += 1) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNum = /^\d+$/.test(l)
    const rNum = /^\d+$/.test(r)
    if (lNum && rNum) {
      const diff = Number.parseInt(l, 10) - Number.parseInt(r, 10)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (lNum) {
      return -1
    } else if (rNum) {
      return 1
    } else {
      const diff = l.localeCompare(r)
      if (diff !== 0) return diff < 0 ? -1 : 1
    }
  }
  return 0
}
