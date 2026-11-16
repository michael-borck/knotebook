import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines, type Change } from 'diff'
import type { StoryBible } from '../lib/bible'
import type { Issue } from '../lib/types'
import {
  PROVIDER_DEFAULTS,
  extractJsonEdits,
  extractPartialInk,
  generateInk,
  generateWithRetry,
  clearLegacyApiKey,
  loadAiSettings,
  saveAiSettings,
  takeLegacyApiKey,
  type AiProvider,
  type AiSettings,
} from '../lib/ai'
import { loadApiKey, saveApiKey } from '../lib/secrets'
import {
  clearSnapshots,
  loadSnapshots,
  saveSnapshot,
  type Snapshot,
} from '../lib/snapshots'
import { mergeKnotEdits, replaceKnot, sliceKnot } from '../lib/inkSource'

interface AiPanelProps {
  source: string
  bible: StoryBible
  snapshotKey: string
  issues: Issue[]
  knots: string[]
  validate: (source: string) => Issue[]
  onApply: (source: string) => void
}

type Status = 'idle' | 'running' | 'ready' | 'error'

function joinKnots(value: string, names: string[]): string {
  return names
    .map((knot) => sliceKnot(value, knot) ?? '')
    .filter(Boolean)
    .join('\n\n')
}

export default function AiPanel({
  source,
  bible,
  snapshotKey,
  issues,
  knots,
  validate,
  onApply,
}: AiPanelProps) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings())
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [instruction, setInstruction] = useState('')
  const [scope, setScope] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<string | null>(null)
  const [proposalScope, setProposalScope] = useState('')
  const [proposalKnots, setProposalKnots] = useState<string[]>([])
  const [selectedKnots, setSelectedKnots] = useState<string[]>([])
  const [streamText, setStreamText] = useState('')
  const [streamScope, setStreamScope] = useState('')
  const [streamKnots, setStreamKnots] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>(() =>
    loadSnapshots(snapshotKey),
  )
  const [saved, setSaved] = useState(false)
  const [keyWarning, setKeyWarning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const running = status === 'running'

  useEffect(() => {
    setSnapshots(loadSnapshots(snapshotKey))
    setProposal(null)
    setProposalScope('')
    setProposalKnots([])
    setStreamText('')
    setStreamScope('')
    setStreamKnots([])
    setStatus('idle')
    setError(null)
    setAttempt(0)
    setRetryNote(null)
  }, [snapshotKey])

  useEffect(() => {
    if (scope && !knots.includes(scope)) setScope('')
  }, [knots, scope])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const legacy = takeLegacyApiKey()
      if (legacy) {
        if (await saveApiKey(legacy)) {
          clearLegacyApiKey()
        } else {
          setKeyWarning(true)
        }
      }
      const stored = legacy || (await loadApiKey())
      if (!cancelled && stored) {
        setSettings((previous) => ({ ...previous, apiKey: stored }))
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  const activeKnots = useMemo(
    () => selectedKnots.filter((knot) => knots.includes(knot)),
    [selectedKnots, knots],
  )

  const scopedSource = useMemo(() => {
    if (proposalKnots.length > 0) return joinKnots(source, proposalKnots)
    return proposalScope ? (sliceKnot(source, proposalScope) ?? source) : source
  }, [source, proposalScope, proposalKnots])
  const scopedProposal = useMemo(() => {
    if (proposal == null) return null
    if (proposalKnots.length > 0) return joinKnots(proposal, proposalKnots)
    return proposalScope
      ? (sliceKnot(proposal, proposalScope) ?? proposal)
      : proposal
  }, [proposal, proposalScope, proposalKnots])
  const diff = useMemo(
    () => (scopedProposal == null ? [] : diffLines(scopedSource, scopedProposal)),
    [scopedSource, scopedProposal],
  )
  const liveSource = useMemo(() => {
    if (streamKnots.length > 0) return joinKnots(source, streamKnots)
    return streamScope ? (sliceKnot(source, streamScope) ?? source) : source
  }, [source, streamScope, streamKnots])
  const liveInk = useMemo(
    () =>
      streamKnots.length === 0 ? extractPartialInk(streamText) : null,
    [streamText, streamKnots],
  )
  const liveDiff = useMemo(
    () => (running && liveInk ? diffLines(liveSource, liveInk) : []),
    [running, liveSource, liveInk],
  )
  const errors = issues.filter((issue) => issue.severity === 'error')

  const updateSettings = (patch: Partial<AiSettings>) => {
    setSaved(false)
    setSettings((previous) => ({ ...previous, ...patch }))
  }

  const chooseProvider = (provider: AiProvider) => {
    const defaults = PROVIDER_DEFAULTS[provider]
    setSaved(false)
    setSettings((previous) => ({
      ...previous,
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    }))
  }

  const persistSettings = async () => {
    const stored = await saveApiKey(settings.apiKey)
    setKeyWarning(!stored && settings.apiKey.trim().length > 0)
    saveAiSettings(settings)
    setSaved(true)
  }

  const saveSettings = () => {
    void persistSettings()
  }

  const runWith = async (
    task: string,
    effectiveScope: string,
    effectiveKnots: string[] = [],
  ) => {
    if (status === 'running') return
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      setError('Set a base URL and model in the provider settings.')
      setStatus('error')
      return
    }
    const multi = effectiveScope === '' && effectiveKnots.length > 0
    const single = effectiveScope !== ''
    const storedKey = await saveApiKey(settings.apiKey)
    setKeyWarning(!storedKey && settings.apiKey.trim().length > 0)
    saveAiSettings(settings)
    setSaved(true)
    setStatus('running')
    setError(null)
    setProposal(null)
    setProposalScope('')
    setProposalKnots([])
    setStreamText('')
    setStreamScope(effectiveScope)
    setStreamKnots(multi ? effectiveKnots : [])
    setAttempt(0)
    setRetryNote(null)
    const scopedTask = multi
      ? [
          `Revise ONLY these knots: ${effectiveKnots.join(', ')}. Return a JSON object mapping each knot name to its full revised ink source, including the === knot === header. Do not change other knots.`,
          '',
          task || 'Improve these knots while preserving the story.',
        ].join('\n')
      : single
        ? [
            `Revise ONLY the knot "${effectiveScope}". Return only that knot, including the === ${effectiveScope} === header, in a single ink code block. Do not change other knots.`,
            '',
            task || 'Improve this knot while preserving the story.',
          ].join('\n')
        : task
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await generateWithRetry(source, scopedTask, {
        maxAttempts: 3,
        scopedKnot: single ? effectiveScope : undefined,
        scopedKnots: multi ? effectiveKnots : undefined,
        generate: async (candidate, feedback) => {
          const candidateSource = single
            ? (sliceKnot(candidate, effectiveScope) ?? candidate)
            : candidate
          const raw = await generateInk({
            settings,
            bible,
            source: candidateSource,
            instruction: feedback,
            context:
              single || multi
                ? `The story also contains these knots: ${knots.join(', ')}. ${
                    single
                      ? 'Only the selected knot is shown below; do not return the others.'
                      : 'Only the selected knots are shown below; return only those knots.'
                  }`
                : undefined,
            mode: multi ? 'json' : 'ink',
            onDelta: (text) => {
              if (!controller.signal.aborted) setStreamText(text)
            },
            signal: controller.signal,
          })
          if (!single && !multi) return raw
          if (single) {
            const merged = replaceKnot(candidate, effectiveScope, raw)
            if (!merged) {
              throw new Error(
                `The model's revision did not include the knot "${effectiveScope}".`,
              )
            }
            return merged
          }
          const edits = extractJsonEdits(raw)
          if (!edits) {
            throw new Error('The model did not return a JSON object.')
          }
          const mergedEdits = mergeKnotEdits(candidate, edits, effectiveKnots)
          if (mergedEdits.error) {
            throw new Error(mergedEdits.error)
          }
          return mergedEdits.source
        },
        validate,
        onAttempt: (nextAttempt) => {
          setAttempt(nextAttempt)
          setStatus('running')
          setStreamText('')
          setRetryNote(nextAttempt > 1 ? `Attempt ${nextAttempt} of 3` : null)
        },
        signal: controller.signal,
      })
      setProposal(result.source)
      setProposalScope(single ? effectiveScope : '')
      setProposalKnots(multi ? effectiveKnots : [])
      setStreamText('')
      setStreamScope('')
      setStreamKnots([])
      setStatus('ready')
      setRetryNote(
        result.errors.length > 0
          ? `Still ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} after ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}.`
          : null,
      )
    } catch (err) {
      setStreamText('')
      setStreamScope('')
      setStreamKnots([])
      if (controller.signal.aborted) {
        setStatus('idle')
        setRetryNote(null)
        return
      }
      setStatus('error')
      setError(err instanceof Error ? err.message : 'AI request failed.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const run = (task: string) =>
    runWith(
      task,
      scope === '*' ? '' : scope,
      scope === '*' ? activeKnots : [],
    )

  const apply = () => {
    if (!proposal) return
    setSnapshots(saveSnapshot(snapshotKey, source, 'Before AI edit'))
    onApply(proposal)
    setProposal(null)
    setProposalScope('')
    setProposalKnots([])
    setStreamText('')
    setStreamScope('')
    setStreamKnots([])
    setStatus('idle')
    setError(null)
    setAttempt(0)
    setRetryNote(null)
  }

  const discard = () => {
    setProposal(null)
    setProposalScope('')
    setProposalKnots([])
    setStreamText('')
    setStreamScope('')
    setStreamKnots([])
    setStatus('idle')
    setError(null)
    setAttempt(0)
    setRetryNote(null)
  }

  const restore = (snapshot: Snapshot) => {
    setSnapshots(saveSnapshot(snapshotKey, source, 'Before restore'))
    onApply(snapshot.source)
    setProposal(null)
    setProposalScope('')
    setProposalKnots([])
    setStreamText('')
    setStreamScope('')
    setStreamKnots([])
    setStatus('idle')
    setError(null)
    setAttempt(0)
    setRetryNote(null)
  }

  const fixErrors = () => {
    const list = errors
      .map(
        (issue) =>
          `${issue.line != null ? `line ${issue.line}: ` : ''}${issue.message}`,
      )
      .join('\n')
    setScope('')
    void runWith(
      `Fix the following errors and return the complete corrected script. Keep everything else stable.\n${list}`,
      '',
    )
  }

  const cancel = () => {
    abortRef.current?.abort()
    setStreamText('')
    setStreamScope('')
    setStreamKnots([])
    setStatus('idle')
  }

  const changed = scopedProposal != null && scopedProposal !== scopedSource

  return (
    <div className="ai">
      <p className="ai-lede">
        Generate or revise the story with an LLM. With a knot selected, only that
        knot is sent; otherwise the bible and full script are sent. The proposal
        is shown as a diff before anything is applied.
      </p>

      <details
        className="ai-settings"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>Provider settings</summary>
        <label className="ai-field">
          <span>Provider</span>
          <select
            value={settings.provider}
            onChange={(event) =>
              chooseProvider(event.target.value as AiProvider)
            }
          >
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </label>
        <label className="ai-field">
          <span>Base URL</span>
          <input
            value={settings.baseUrl}
            onChange={(event) => updateSettings({ baseUrl: event.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="ai-field">
          <span>Model</span>
          <input
            value={settings.model}
            onChange={(event) => updateSettings({ model: event.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="ai-field">
          <span>API key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) => updateSettings({ apiKey: event.target.value })}
            placeholder={
              settings.provider === 'ollama'
                ? 'not needed for Ollama'
                : 'required'
            }
            autoComplete="off"
          />
        </label>
        <div className="ai-actions">
          <button type="button" className="mini" onClick={saveSettings}>
            Save settings
          </button>
          {saved && <span className="ai-status">Saved</span>}
        </div>
        <p className="ai-note">
          In the desktop app the key is stored in the OS keychain; in the web app
          it stays in this browser profile. Use a limited-scope key. Ollama must
          allow this origin (`OLLAMA_ORIGINS`).
        </p>
        {keyWarning && (
          <p className="ai-warning">
            The API key could not be stored in the OS keychain; it will only last
            for this session.
          </p>
        )}
      </details>

      <label className="ai-field">
        <span>Scope</span>
        <select
          value={scope}
          disabled={running}
          onChange={(event) => {
            setScope(event.target.value)
            setProposal(null)
            setProposalScope('')
            setProposalKnots([])
            setStreamText('')
            setStreamScope('')
            setStreamKnots([])
            setStatus('idle')
            setError(null)
            setAttempt(0)
            setRetryNote(null)
          }}
        >
          <option value="">Whole story</option>
          <option value="*">Multiple knots…</option>
          {knots.map((knot) => (
            <option key={knot} value={knot}>
              {knot}
            </option>
          ))}
        </select>
      </label>

      {scope === '*' && (
        <div className="ai-knot-picker">
          {knots.map((knot) => (
            <label key={knot} className="ai-knot-option">
              <input
                type="checkbox"
                checked={selectedKnots.includes(knot)}
                disabled={running}
                onChange={(event) =>
                  setSelectedKnots((previous) =>
                    event.target.checked
                      ? [...previous, knot]
                      : previous.filter((item) => item !== knot),
                  )
                }
              />
              <span>{knot}</span>
            </label>
          ))}
          {knots.length === 0 && (
            <span className="ai-status">No knots in this file.</span>
          )}
          <span className="ai-status">{activeKnots.length} selected</span>
        </div>
      )}

      <label className="ai-field">
        <span>Instruction</span>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={4}
          placeholder={
            scope === '*'
              ? 'e.g. Tighten the opening and the ending. Keep the middle stable.'
              : scope
                ? `e.g. Tighten the dialogue in ${scope}.`
                : 'e.g. Add a new knot called epilogue and connect the ending to it. Keep the noir tone.'
          }
        />
      </label>

      <div className="ai-actions">
        <button
          type="button"
          className="ai-primary"
          onClick={() => void run(instruction)}
          disabled={running || (scope === '*' && activeKnots.length === 0)}
        >
          {running ? 'Thinking…' : 'Generate / edit'}
        </button>
        {running && (
          <button type="button" className="ghost" onClick={cancel}>
            Cancel
          </button>
        )}
        {errors.length > 0 && !running && (
          <button type="button" className="ghost" onClick={fixErrors}>
            Fix {errors.length} error
            {errors.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {error && <p className="ai-error">{error}</p>}
      {running && (
        <p className="ai-status">
          {streamKnots.length > 0
            ? `Streaming JSON for ${streamKnots.length} knot${streamKnots.length === 1 ? '' : 's'}…`
            : streamText
              ? 'Streaming…'
              : `Attempt ${Math.max(1, attempt)} of 3 — waiting for the model…`}
        </p>
      )}
      {retryNote && !running && <p className="ai-warning">{retryNote}</p>}

      {running && liveInk && (
        <section className="ai-proposal ai-streaming">
          <div className="ai-proposal-head">
            <strong>Streaming preview</strong>
            <span className="ai-status">
              {streamScope ? `knot ${streamScope}` : 'whole story'}
            </span>
          </div>
          <DiffView parts={liveDiff} />
        </section>
      )}
      {running && streamKnots.length > 0 && streamText && (
        <pre className="ai-stream-json">{streamText.slice(-4000)}</pre>
      )}

      {proposal && (
        <section className="ai-proposal">
          <div className="ai-proposal-head">
            <strong>Proposed edit</strong>
            <span className="ai-status">
              {proposalKnots.length > 0
                ? `${proposalKnots.length} knot${proposalKnots.length === 1 ? '' : 's'}`
                : proposalScope
                  ? `knot ${proposalScope}`
                  : 'whole story'}{' '}
              · {changed ? 'Review the diff' : 'No changes'}
            </span>
          </div>
          <DiffView parts={diff} />
          <div className="ai-actions">
            <button
              type="button"
              className="ai-primary"
              onClick={apply}
              disabled={!changed}
            >
              Apply
            </button>
            <button type="button" className="ghost" onClick={discard}>
              Discard
            </button>
          </div>
        </section>
      )}

      {snapshots.length > 0 && (
        <details className="ai-history">
          <summary>History ({snapshots.length})</summary>
          <ul>
            {snapshots.map((snapshot, index) => (
              <li key={`${snapshot.at}-${index}`}>
                <span>
                  {new Date(snapshot.at).toLocaleTimeString()} ·{' '}
                  {snapshot.label}
                </span>
                <button
                  type="button"
                  className="mini"
                  onClick={() => restore(snapshot)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          <div className="ai-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearSnapshots(snapshotKey)
                setSnapshots([])
              }}
            >
              Clear history
            </button>
          </div>
        </details>
      )}
    </div>
  )
}

function DiffView({ parts }: { parts: Change[] }) {
  return (
    <div className="ai-diff">
      {parts.map((part, partIndex) =>
        part.value
          .split('\n')
          .filter(
            (line, index, lines) =>
              !(index === lines.length - 1 && line === ''),
          )
          .map((line, lineIndex) => (
            <div
              key={`${partIndex}-${lineIndex}`}
              className={
                part.added
                  ? 'diff-add'
                  : part.removed
                    ? 'diff-del'
                    : 'diff-same'
              }
            >
              <span className="diff-sign">
                {part.added ? '+' : part.removed ? '-' : ' '}
              </span>
              {line || ' '}
            </div>
          )),
      )}
      {parts.length === 0 && <div className="diff-same">No changes.</div>}
    </div>
  )
}
