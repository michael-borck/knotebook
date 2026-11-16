export interface StoryChoice {
  text: string
  target: string | null
}

export interface StoryPassage {
  id: string
  knot: string
  stitch?: string
  lines: string[]
  choices: StoryChoice[]
  diverts: string[]
  tags: string[]
}

export interface StoryVariable {
  name: string
  value: string
}

export interface StoryAssignment {
  name: string
  op: '=' | '+=' | '-='
  value: string
  passage: string
}

export interface StoryModel {
  title: string
  passages: StoryPassage[]
  variables: StoryVariable[]
  assignments: StoryAssignment[]
  entry: string | null
}

const KNOT_RE = /^===\s*([A-Za-z_][A-Za-z0-9_]*)\s*===\s*$/
const STITCH_RE = /^=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/
const VAR_RE = /^VAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/
const ASSIGN_RE =
  /^~\s*(?:temp\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|=)\s*(.+?)\s*$/
const CHOICE_RE = /^([*+])\s*(.*)$/
const DIVERT_RE = /->\s*([A-Za-z_][A-Za-z0-9_.]*)/

function normalizePath(input: string): string {
  const parts = input.replace(/\\/g, '/').split('/')
  const output: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      output.pop()
      continue
    }
    output.push(part)
  }
  return output.join('/')
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

function resolveIncludes(
  rootFile: string,
  files: Record<string, string>,
): string {
  const seen = new Set<string>()
  const visit = (file: string): string => {
    const key = normalizePath(file)
    if (seen.has(key)) return ''
    seen.add(key)
    const text = files[key]
    if (text == null) return ''
    const output: string[] = []
    for (const line of text.split('\n')) {
      const include = /^\s*INCLUDE\s+(.+?)\s*$/.exec(line)
      if (include) {
        const target = normalizePath(
          joinPath(dirname(key), include[1].trim()),
        )
        output.push(visit(target))
      } else {
        output.push(line)
      }
    }
    return output.join('\n')
  }
  return visit(rootFile)
}

function titleFromSource(source: string): string {
  const match = source.match(/^#\s*title:\s*(.+)$/im)
  return match ? match[1].trim() : 'Untitled Story'
}

function parseChoice(text: string): StoryChoice {
  let target: string | null = null
  const divert = DIVERT_RE.exec(text)
  if (divert) {
    target = divert[1]
    text = text.slice(0, divert.index)
  }
  text = text.trim()
  if (text.startsWith('[')) {
    const close = text.indexOf(']')
    if (close > 0) text = text.slice(1, close)
  }
  text = text.replace(/#.*$/, '').trim()
  return { text, target }
}

function splitTags(line: string): string[] {
  const match = /^#\s*(.+?)\s*$/.exec(line)
  if (!match) return []
  return [match[1].trim()]
}

export function buildStoryModel(
  source: string,
  files?: Record<string, string>,
  rootFile?: string,
): StoryModel {
  const text =
    files && rootFile ? resolveIncludes(rootFile, files) : source
  const lines = text.split('\n')
  const passages: StoryPassage[] = []
  const variables: StoryVariable[] = []
  const assignments: StoryAssignment[] = []
  let current: StoryPassage | null = null
  let inChoiceBody = false

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    const indented = /^\s+/.test(raw)

    if (!trimmed) {
      if (inChoiceBody) continue
      continue
    }

    const knotMatch = KNOT_RE.exec(trimmed)
    if (knotMatch) {
      current = {
        id: knotMatch[1],
        knot: knotMatch[1],
        lines: [],
        choices: [],
        diverts: [],
        tags: [],
      }
      passages.push(current)
      inChoiceBody = false
      continue
    }

    const stitchMatch = STITCH_RE.exec(trimmed)
    if (stitchMatch) {
      if (!current) continue
      const stitch = stitchMatch[1]
      current = {
        id: `${current.knot}.${stitch}`,
        knot: current.knot,
        stitch,
        lines: [],
        choices: [],
        diverts: [],
        tags: [],
      }
      passages.push(current)
      inChoiceBody = false
      continue
    }

    const choiceMatch = CHOICE_RE.exec(trimmed)
    if (choiceMatch && current) {
      const choice = parseChoice(choiceMatch[2])
      if (!choice.target) {
        for (let next = index + 1; next < lines.length; next += 1) {
          const nextLine = lines[next].trim()
          if (!nextLine) continue
          if (
            KNOT_RE.test(nextLine) ||
            STITCH_RE.test(nextLine) ||
            CHOICE_RE.test(nextLine)
          ) {
            break
          }
          const divert = DIVERT_RE.exec(nextLine)
          if (divert) {
            choice.target = divert[1]
            break
          }
        }
      }
      current.choices.push(choice)
      inChoiceBody = true
      continue
    }

    if (inChoiceBody) {
      if (indented) {
        const divert = DIVERT_RE.exec(trimmed)
        if (divert) {
          const last = current?.choices[current.choices.length - 1]
          if (last && !last.target) last.target = divert[1]
        }
        continue
      }
      inChoiceBody = false
    }

    if (trimmed.startsWith('VAR ')) {
      const variable = VAR_RE.exec(trimmed)
      if (variable) {
        variables.push({ name: variable[1], value: variable[2] })
      }
      continue
    }

    if (trimmed.startsWith('CONST ')) continue

    const assignment = ASSIGN_RE.exec(trimmed)
    if (assignment && current) {
      assignments.push({
        name: assignment[1],
        op: assignment[2] as StoryAssignment['op'],
        value: assignment[3],
        passage: current.id,
      })
      continue
    }

    if (trimmed.startsWith('->')) {
      const divert = DIVERT_RE.exec(trimmed)
      if (divert && current) current.diverts.push(divert[1])
      continue
    }

    if (trimmed.startsWith('#')) {
      if (current) current.tags.push(...splitTags(trimmed))
      continue
    }

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('INCLUDE ') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('+') ||
      trimmed.startsWith('=')
    ) {
      continue
    }

    if (current) {
      const prose = trimmed.replace(/#.*$/, '').trim()
      if (prose) current.lines.push(prose)
    }
  }

  return {
    title: titleFromSource(text),
    passages,
    variables,
    assignments,
    entry: passages[0]?.id ?? null,
  }
}

export function buildTwee(model: StoryModel): string {
  const lines: string[] = [':: StoryTitle', model.title, '']
  if (model.variables.length > 0) {
    lines.push(':: StoryInit')
    for (const variable of model.variables) {
      lines.push(`<<set $${variable.name} to ${variable.value}>>`)
    }
    lines.push('')
  }

  for (const passage of model.passages) {
    const tags = passage.tags.length > 0 ? ` [${passage.tags.join(' ')}]` : ''
    lines.push(`:: ${passage.id}${tags}`)
    lines.push(...passage.lines)
    for (const assignment of model.assignments.filter(
      (item) => item.passage === passage.id,
    )) {
      if (assignment.op === '=') {
        lines.push(`<<set $${assignment.name} to ${assignment.value}>>`)
      } else {
        const operator = assignment.op === '+=' ? '+' : '-'
        lines.push(
          `<<set $${assignment.name} to $${assignment.name} ${operator} ${assignment.value}>>`,
        )
      }
    }
    for (const choice of passage.choices) {
      const label = choice.text || 'Continue'
      lines.push(
        choice.target
          ? `[[${label}->${choice.target}]]`
          : `[[${label}]]`,
      )
    }
    for (const divert of passage.diverts) {
      if (divert === 'END' || divert === 'DONE') continue
      lines.push(`[[->${divert}]]`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function choiceScriptLabel(id: string): string {
  return id.replace(/\./g, '_')
}

export function buildChoiceScript(model: StoryModel): string {
  const lines: string[] = [`*title ${model.title}`]
  for (const variable of model.variables) {
    lines.push(`*create ${variable.name} ${variable.value}`)
  }

  for (const passage of model.passages) {
    lines.push('')
    lines.push(`*label ${choiceScriptLabel(passage.id)}`)
    if (passage.tags.length > 0) {
      lines.push(`*comment ${passage.tags.join(' ')}`)
    }
    lines.push(...passage.lines)
    for (const assignment of model.assignments.filter(
      (item) => item.passage === passage.id,
    )) {
      const operator =
        assignment.op === '=' ? '' : ` ${assignment.op === '+=' ? '+' : '-'}`
      lines.push(
        `*set ${assignment.name}${operator} ${assignment.value}`,
      )
    }

    if (passage.choices.length > 0) {
      lines.push('*choice')
      for (const choice of passage.choices) {
        lines.push(`  # ${choice.text || 'Continue'}`)
        if (choice.target && choice.target !== 'END' && choice.target !== 'DONE') {
          lines.push(`    *goto ${choiceScriptLabel(choice.target)}`)
        } else {
          lines.push('    *finish')
        }
      }
      continue
    }

    const target = passage.diverts.find(
      (item) => item !== 'END' && item !== 'DONE',
    )
    if (target) {
      lines.push(`*goto ${choiceScriptLabel(target)}`)
    } else {
      lines.push('*finish')
    }
  }

  return lines.join('\n')
}