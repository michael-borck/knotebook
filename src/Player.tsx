import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import { Story } from 'inkjs/full'
import { choose, readTurn } from './lib/ink'
import { getTheme, themePalette } from './lib/themes'
import { parsePack, MAX_PACK_BYTES, type Pack } from './lib/pack'
import {
  fetchPackBytes,
  parseCatalogue,
  MAX_CATALOGUE_BYTES,
  PINNED_STORE_PUBLIC_KEY,
  sha256Hex,
  verifyPackSignature,
  type Catalogue,
  type CatalogueEntry,
} from './lib/catalogue'
import { firstImageTag } from './lib/tags'
import { compareVersions } from './lib/version'
import {
  clearHistory,
  clearProgress,
  installPack,
  listAllPackHistory,
  listHistory,
  listLibrary,
  loadPack,
  loadProgress,
  recordPlayed,
  removePack,
  saveProgress,
  type HistoryEntry,
  type LibraryEntry,
  type PackVersion,
} from './lib/storage'
import type { PlayView } from './lib/types'
import './player.css'

const EMPTY_PLAY: PlayView = { text: '', tags: [], choices: [], ended: false }

type View = 'library' | 'store'

export default function Player() {
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [packVersions, setPackVersions] = useState<
    Record<string, PackVersion[]>
  >({})
  const [expandedPack, setExpandedPack] = useState<string | null>(null)
  const [view, setView] = useState<View>('library')
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [catalogueLoading, setCatalogueLoading] = useState(false)
  const [themeFilter, setThemeFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState<
    'all' | 'installed' | 'updates'
  >('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [pack, setPack] = useState<Pack | null>(null)
  const [turns, setTurns] = useState<string[]>([])
  const [play, setPlay] = useState<PlayView>(EMPTY_PLAY)
  const [savedImage, setSavedImage] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const storyRef = useRef<Story | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const catalogueTarget = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const custom =
      params.get('store') ??
      (import.meta.env.VITE_CATALOGUE_URL as string | undefined)
    return { url: custom ?? 'catalogue.json', custom: Boolean(custom) }
  }, [])
  const catalogueUrl = catalogueTarget.url

  const envStoreKey = (import.meta.env.VITE_STORE_PUBLIC_KEY as string | undefined)?.trim()
  const storePublicKey =
    envStoreKey ||
    (catalogueTarget.custom ? catalogue?.publicKey : PINNED_STORE_PUBLIC_KEY)
  const trustHost = !envStoreKey && catalogueTarget.custom

  const storeThemes = useMemo(() => {
    if (!catalogue) return []
    return [...new Set(catalogue.packs.map((pack) => pack.theme))].sort((a, b) =>
      getTheme(a).title.localeCompare(getTheme(b).title),
    )
  }, [catalogue])
  const storePacks = useMemo(() => {
    const entries = catalogue?.packs ?? []
    const filtered = entries.filter((entry) => {
      const installed = library.find((item) => item.id === entry.id)
      if (storeFilter === 'installed') return Boolean(installed)
      if (storeFilter === 'updates') {
        return Boolean(
          installed &&
            compareVersions(entry.release ?? '1.0.0', installed.release) > 0,
        )
      }
      return true
    })
    return filtered.filter(
      (pack) => !themeFilter || pack.theme === themeFilter,
    )
  }, [catalogue, library, storeFilter, themeFilter])

  const catalogueInstalledCount =
    catalogue?.packs.filter((entry) =>
      library.some((item) => item.id === entry.id),
    ).length ?? 0
  const updatesCount =
    catalogue?.packs.filter((entry) => {
      const installed = library.find((item) => item.id === entry.id)
      return Boolean(
        installed &&
          compareVersions(entry.release ?? '1.0.0', installed.release) > 0,
      )
    }).length ?? 0

  useEffect(() => {
    if (themeFilter && !storeThemes.includes(themeFilter)) setThemeFilter('')
  }, [storeThemes, themeFilter])

  useEffect(() => {
    let active = true
    listLibrary()
      .then((entries) => {
        if (!active) return undefined
        setLibrary(entries)
        return listAllPackHistory()
      })
      .then((versions) => {
        if (active && versions) setPackVersions(versions)
      })
      .catch(() => undefined)
    listHistory()
      .then((entries) => {
        if (active) setHistory(entries)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const theme = useMemo(() => getTheme(pack?.theme ?? 'base'), [pack])
  const palette = useMemo(() => themePalette(theme), [theme])
  const themeStyle = useMemo(
    () =>
      ({
        '--bg': palette.bg,
        '--panel': palette.panel,
        '--panel-2': palette.panel2,
        '--text': palette.text,
        '--muted': palette.muted,
        '--border': palette.border,
        '--accent': palette.accent,
      }) as CSSProperties,
    [palette],
  )

  const imageValue = useMemo(
    () => firstImageTag(play.tags) ?? savedImage,
    [play.tags, savedImage],
  )
  const imageUrl = useMemo(
    () => (pack ? resolvePackAsset(pack, imageValue) : undefined),
    [pack, imageValue],
  )

  const startPack = async (id: string) => {
    const next = await loadPack(id)
    if (!next) {
      setToast('That pack is no longer installed.')
      return
    }
    let story: Story
    try {
      story = new Story(next.stories[0].json)
    } catch {
      setToast('That pack could not be opened.')
      return
    }
    storyRef.current = story
    void recordPlayed(next)
      .then(() => listHistory())
      .then((entries) => setHistory(entries))
      .catch(() => undefined)
    const saved = await loadProgress(next.id)
    if (saved) {
      try {
        story.state.LoadJson(saved.state)
        setTurns(saved.turns ?? [])
        setSavedImage(saved.image ?? null)
        setPlay(readTurn(story))
        setPack(next)
        return
      } catch {
        await clearProgress(next.id)
      }
    }
    const first = readTurn(story)
    setTurns(first.text ? [first.text] : [])
    setSavedImage(null)
    setPlay(first)
    setPack(next)
  }

  const handleChoose = (index: number) => {
    if (!pack) return
    const story = storyRef.current
    if (!story) return
    try {
      const next = choose(story, index)
      const nextTurns = next.text ? [...turns, next.text] : turns
      const nextImage = firstImageTag(next.tags) ?? savedImage
      setTurns(nextTurns)
      setSavedImage(nextImage)
      setPlay(next)
      void saveProgress(pack.id, {
        state: story.state.ToJson(),
        turns: nextTurns,
        image: nextImage ?? undefined,
      })
    } catch {
      setToast('That choice could not be played.')
    }
  }

  const handleRestart = () => {
    if (!pack) return
    void clearProgress(pack.id)
    try {
      const story = new Story(pack.stories[0].json)
      storyRef.current = story
      const first = readTurn(story)
      setTurns(first.text ? [first.text] : [])
      setSavedImage(null)
      setPlay(first)
    } catch {
      setToast('That pack could not be restarted.')
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_PACK_BYTES) {
      setToast('Pack is too large (16 MB limit).')
      return
    }
    const { pack: imported, error } = parsePack(await file.text())
    if (!imported) {
      setToast(error ?? 'Could not import that pack.')
      return
    }
    try {
      await installPack(imported)
      setLibrary(await listLibrary())
      setPackVersions(await listAllPackHistory())
      setToast(`Installed ${imported.title}`)
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : 'Could not install that pack.',
      )
    }
  }

  const handleRemove = async (id: string) => {
    await removePack(id)
    setLibrary(await listLibrary())
  }

  const openStore = async () => {
    setView('store')
    setCatalogueLoading(true)
    setCatalogueError(null)
    try {
      const base = new URL(catalogueUrl, window.location.href).toString()
      const response = await fetch(base, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(`Catalogue not found (${response.status}).`)
      }
      const text = await response.text()
      if (text.length > MAX_CATALOGUE_BYTES) {
        throw new Error('Catalogue too large (2 MB limit).')
      }
      const { catalogue: parsed, error } = parseCatalogue(text)
      if (!parsed) throw new Error(error ?? 'Invalid catalogue.')
      setCatalogue(parsed)
    } catch (error) {
      setCatalogue(null)
      setCatalogueError(
        error instanceof Error ? error.message : 'Could not load the store.',
      )
    } finally {
      setCatalogueLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'store') {
      void openStore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installFromStore = async (entry: CatalogueEntry) => {
    setInstalling(entry.id)
    try {
      const base = new URL(catalogueUrl, window.location.href).toString()
      const bytes = await fetchPackBytes(entry, base)
      const digest = await sha256Hex(bytes)
      if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
        throw new Error('Hash mismatch — the pack was rejected.')
      }
      const publicKey = storePublicKey
      if (publicKey && !verifyPackSignature(entry, bytes, publicKey)) {
        throw new Error('Signature check failed — the pack was rejected.')
      }
      const { pack: imported, error } = parsePack(
        new TextDecoder().decode(bytes),
      )
      if (!imported) throw new Error(error ?? 'Invalid pack.')
      await installPack(imported)
      setLibrary(await listLibrary())
      setPackVersions(await listAllPackHistory())
      setToast(`Installed ${imported.title}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Install failed.')
    } finally {
      setInstalling(null)
    }
  }

  const backToLibrary = () => {
    setPack(null)
    setView('library')
    void listLibrary().then(setLibrary)
  }

  if (pack) {
    return (
      <div className="player-shell" style={themeStyle}>
        <header className="player-bar">
          <button type="button" className="ghost" onClick={backToLibrary}>
            ← Library
          </button>
          <h1 className="player-title">{pack.title}</h1>
          <span className="theme-chip">{theme.title}</span>
        </header>
        <main className="reader">
          {imageUrl && <img className="scene-image" src={imageUrl} alt="" />}
          <div className="reader-text" role="log" aria-live="polite">
            {turns.map((turn, turnIndex) =>
              turn.split(/\n{2,}/).map((paragraph, index) => (
                <p key={`${turnIndex}-${index}`}>{paragraph}</p>
              )),
            )}
          </div>
          <div className="reader-choices">
            {play.choices.map((choice) => (
              <button
                key={choice.index}
                type="button"
                className="choice"
                onClick={() => handleChoose(choice.index)}
              >
                <span className="num">{choice.index + 1}</span>
                {choice.text}
              </button>
            ))}
            {play.ended && <div className="end">The End</div>}
          </div>
          <div className="reader-bar">
            <button type="button" onClick={handleRestart}>
              Restart
            </button>
          </div>
        </main>
        {toast && (
          <div className="toast" role="status" aria-live="polite">
            {toast}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="player-shell">
      <header className="player-bar">
        <div className="player-brand">
          Knotebook <span>Player</span>
        </div>
        <nav className="player-nav">
          <button
            type="button"
            className={view === 'library' ? 'active' : ''}
            aria-current={view === 'library' ? 'page' : undefined}
            onClick={() => setView('library')}
          >
            Library
          </button>
          <button
            type="button"
            className={view === 'store' ? 'active' : ''}
            aria-current={view === 'store' ? 'page' : undefined}
            onClick={() => void openStore()}
          >
            Store
          </button>
          <a href="./">Studio</a>
        </nav>
      </header>

      {view === 'library' ? (
        <main className="library">
          <div className="library-head">
            <h1>Library</h1>
            <button
              type="button"
              className="import-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Import pack
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              className="sr-only"
              tabIndex={-1}
            />
          </div>
          {history.length > 0 && (
            <section className="recent">
              <div className="recent-head">
                <h2>Recently played</h2>
                <button
                  type="button"
                  className="mini"
                  onClick={() => {
                    void clearHistory()
                    setHistory([])
                  }}
                >
                  Clear
                </button>
              </div>
              <ul className="recent-list">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="recent-play"
                      onClick={() => void startPack(entry.id)}
                    >
                      {entry.cover && <img src={entry.cover} alt="" />}
                      <span>{entry.title}</span>
                    </button>
                    <span className="muted small">
                      {new Date(entry.lastPlayed).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {library.length === 0 ? (
            <p className="muted">
              No packs installed. Import a pack or open the Store.
            </p>
          ) : (
            <ul className="pack-grid">
              {library.map((entry) => {
                const entryTheme = getTheme(entry.theme)
                return (
                  <li
                    key={entry.id}
                    className="pack-card"
                    style={{ borderColor: entryTheme.accent }}
                  >
                    {entry.cover && (
                      <img className="pack-cover" src={entry.cover} alt="" />
                    )}
                    <div className="pack-theme">
                      {entryTheme.title} · v{entry.release}
                    </div>
                    <h2>{entry.title}</h2>
                    <p className="muted">{entry.author || 'Unknown author'}</p>
                    <div className="pack-actions">
                      <button
                        type="button"
                        onClick={() => void startPack(entry.id)}
                      >
                        Play
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void handleRemove(entry.id)}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        aria-expanded={expandedPack === entry.id}
                        onClick={() =>
                          setExpandedPack(
                            expandedPack === entry.id ? null : entry.id,
                          )
                        }
                      >
                        History
                      </button>
                    </div>
                    {expandedPack === entry.id && (
                      <ul className="version-list">
                        {(packVersions[entry.id] ?? []).length === 0 ? (
                          <li className="muted small">
                            No version history yet.
                          </li>
                        ) : (
                          packVersions[entry.id].map((version) => (
                            <li key={`${version.release}-${version.installed}`}>
                              v{version.release} ·{' '}
                              {new Date(version.installed).toLocaleString()}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </main>
      ) : (
        <main className="library">
          <div className="library-head">
            <h1>Store</h1>
            <button
              type="button"
              className="mini"
              onClick={() => void openStore()}
            >
              Refresh
            </button>
          </div>
          {catalogue && catalogue.packs.length > 0 && (
            <div
              className="store-filters"
              role="group"
              aria-label="Filter store"
            >
              <button
                type="button"
                className={storeFilter === 'all' ? 'active' : ''}
                aria-pressed={storeFilter === 'all'}
                onClick={() => setStoreFilter('all')}
              >
                All ({catalogue.packs.length})
              </button>
              <button
                type="button"
                className={storeFilter === 'installed' ? 'active' : ''}
                aria-pressed={storeFilter === 'installed'}
                onClick={() => setStoreFilter('installed')}
              >
                Installed ({catalogueInstalledCount})
              </button>
              <button
                type="button"
                className={storeFilter === 'updates' ? 'active' : ''}
                aria-pressed={storeFilter === 'updates'}
                onClick={() => setStoreFilter('updates')}
              >
                Updates ({updatesCount})
              </button>
            </div>
          )}
          {storeThemes.length > 1 && (
            <div
              className="store-filters"
              role="group"
              aria-label="Filter packs by theme"
            >
              <button
                type="button"
                className={themeFilter === '' ? 'active' : ''}
                aria-pressed={themeFilter === ''}
                onClick={() => setThemeFilter('')}
              >
                All
              </button>
              {storeThemes.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={themeFilter === theme ? 'active' : ''}
                  aria-pressed={themeFilter === theme}
                  onClick={() => setThemeFilter(theme)}
                >
                  {getTheme(theme).title}
                </button>
              ))}
            </div>
          )}
          {trustHost && storePublicKey && (
            <p className="muted small">
              Catalogue-provided key — this store is trusted by the host.
            </p>
          )}
          {storePublicKey == null && (
            <p className="muted small">
              Unsigned catalogue — downloads are hash-checked only.
            </p>
          )}
          {catalogueLoading && <p className="muted">Loading catalogue…</p>}
          {catalogueError && (
            <div className="store-error">
              <p>{catalogueError}</p>
              <p className="muted">
                Set <code>VITE_CATALOGUE_URL</code> or add{' '}
                <code>?store=&lt;url&gt;</code>.
              </p>
            </div>
          )}
          {catalogue && storePacks.length > 0 && (
            <ul className="pack-grid">
              {storePacks.map((entry) => {
                const installedEntry = library.find(
                  (item) => item.id === entry.id,
                )
                const catalogueRelease = entry.release ?? '1.0.0'
                const hasUpdate = installedEntry
                  ? compareVersions(catalogueRelease, installedEntry.release) > 0
                  : false
                const upToDate = installedEntry?.release === catalogueRelease
                const action = !installedEntry
                  ? 'Install'
                  : hasUpdate
                    ? 'Update'
                    : 'Reinstall'
                const entryTheme = getTheme(entry.theme)
                return (
                  <li
                    key={entry.id}
                    className="pack-card"
                    style={{ borderColor: entryTheme.accent }}
                  >
                    {entry.cover ? (
                      <img className="pack-cover" src={entry.cover} alt="" />
                    ) : (
                      <div
                        className="pack-cover store-art-fallback"
                        aria-hidden="true"
                        style={{
                          borderColor: entryTheme.accent,
                          background: `linear-gradient(135deg, ${entryTheme.bg}, ${entryTheme.accent}33)`,
                        }}
                      />
                    )}
                    <div className="pack-theme">
                      {entryTheme.title} · v{catalogueRelease}
                      {installedEntry
                        ? ` · installed v${installedEntry.release}`
                        : ''}
                    </div>
                    <h2>{entry.title}</h2>
                    <p className="muted">{entry.author || 'Unknown author'}</p>
                    {entry.description && (
                      <p className="muted">{entry.description}</p>
                    )}
                    <div className="pack-actions">
                      <button
                        type="button"
                        disabled={installing === entry.id}
                        onClick={() => void installFromStore(entry)}
                      >
                        {installing === entry.id ? 'Installing…' : action}
                      </button>
                      {upToDate && (
                        <span className="installed">Up to date</span>
                      )}
                      {hasUpdate && (
                        <span className="update-available">
                          Update available
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {catalogue && catalogue.packs.length > 0 && storePacks.length === 0 && (
            <p className="muted">No packs match this filter.</p>
          )}
          {catalogue && catalogue.packs.length === 0 && (
            <p className="muted">The catalogue is empty.</p>
          )}
        </main>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}

function resolvePackAsset(pack: Pack, value: string | null): string | undefined {
  if (!value || !pack.assets) return undefined
  return pack.assets[value] ?? pack.assets[`assets/${value}`]
}
