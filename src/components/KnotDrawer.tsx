import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue, KnotSelection } from '../lib/types'
import { replaceBlock, sliceBlock } from '../lib/inkSource'

interface KnotDrawerProps {
  knot: KnotSelection
  source: string
  validate: (candidate: string) => Issue[]
  onApply: (draft: string) => boolean
  onClose: () => void
  onOpenInText: () => void
}

export default function KnotDrawer({
  knot,
  source,
  validate,
  onApply,
  onClose,
  onOpenInText,
}: KnotDrawerProps) {
  const [draft, setDraft] = useState(() => sliceBlock(source, knot.id) ?? '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const candidate = useMemo(
    () => replaceBlock(source, knot.id, draft) ?? source,
    [source, knot.id, draft],
  )
  const issues = useMemo(() => validate(candidate), [candidate, validate])
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const changed = candidate !== source

  const apply = () => {
    onApply(draft)
  }

  return (
    <aside
      className="knot-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={`Edit ${knot.id}`}
    >
      <div className="knot-drawer-head">
        <div>
          <strong>{knot.id}</strong>
          <span className="knot-drawer-meta">
            {knot.file}:{knot.line} · {knot.kind}
          </span>
        </div>
        <button
          type="button"
          className="knot-close"
          onClick={onClose}
          aria-label="Close knot editor"
        >
          ×
        </button>
      </div>

      <p className="knot-drawer-note">
        Editing this knot only. The map stays in place.
      </p>

      <textarea
        ref={textareaRef}
        className="knot-editor"
        value={draft}
        spellCheck={false}
        aria-label={`Ink source for ${knot.id}`}
        onChange={(event) => setDraft(event.target.value)}
      />

      <div className="knot-drawer-status">
        {errors.length > 0 && (
          <span className="knot-error">
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="knot-warning">
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        )}
        {changed && <span className="knot-status">Unsaved changes</span>}
      </div>

      {issues.length > 0 && (
        <ul className="knot-issues">
          {issues.slice(0, 8).map((issue, index) => (
            <li key={index} className={issue.severity}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="knot-drawer-actions">
        <button
          type="button"
          className="knot-apply"
          onClick={apply}
          disabled={!changed}
        >
          Apply
        </button>
        <button type="button" className="knot-secondary" onClick={onOpenInText}>
          Open in text
        </button>
        <button type="button" className="knot-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  )
}