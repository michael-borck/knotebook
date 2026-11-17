import type { Pack } from './pack'

const DB_NAME = 'knotebook'
const DB_VERSION = 4
const PACK_STORE = 'packs'
const PROGRESS_STORE = 'progress'
const LIBRARY_STORE = 'library'
const HISTORY_STORE = 'history'
const PACK_HISTORY_STORE = 'packHistory'

export interface LibraryEntry {
  id: string
  title: string
  author: string
  theme: string
  release: string
  installed: string
  cover?: string
}

export interface SavedProgress {
  state: string
  turns: string[]
  image?: string
}

export interface HistoryEntry {
  id: string
  title: string
  theme: string
  cover?: string
  lastPlayed: string
}

export interface PackVersion {
  release: string
  installed: string
}

interface PackHistoryRecord {
  id: string
  title: string
  versions: PackVersion[]
}

interface PackRecord {
  id: string
  pack: Pack
  installed: string
}

interface ProgressRecord {
  id: string
  state: string
  turns: string[]
  image?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PACK_STORE)) {
        db.createObjectStore(PACK_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
        db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PACK_HISTORY_STORE)) {
        db.createObjectStore(PACK_HISTORY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open local storage'))
  })
  return dbPromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Storage request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed'))
    tx.onabort = () =>
      reject(tx.error ?? new Error('Storage transaction aborted'))
  })
}

function toLibraryEntry(pack: Pack, installed: string): LibraryEntry {
  return {
    id: pack.id,
    title: pack.title,
    author: pack.author,
    theme: pack.theme,
    release: pack.release,
    installed,
    cover: pack.cover,
  }
}

async function recordPackVersion(
  id: string,
  title: string,
  release: string,
  installed: string,
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PACK_HISTORY_STORE, 'readwrite')
  const store = tx.objectStore(PACK_HISTORY_STORE)
  const record = await requestResult(
    store.get(id) as IDBRequest<PackHistoryRecord | undefined>,
  )
  const versions = (record?.versions ?? []).filter(
    (version) => version.release !== release,
  )
  versions.unshift({ release, installed })
  store.put({ id, title, versions })
  await transactionDone(tx)
}

export async function listPackHistory(id: string): Promise<PackVersion[]> {
  const db = await openDb()
  const tx = db.transaction(PACK_HISTORY_STORE, 'readonly')
  const record = await requestResult(
    tx.objectStore(PACK_HISTORY_STORE).get(id) as IDBRequest<
      PackHistoryRecord | undefined
    >,
  )
  return record?.versions ?? []
}

export async function listAllPackHistory(): Promise<
  Record<string, PackVersion[]>
> {
  const db = await openDb()
  const tx = db.transaction(PACK_HISTORY_STORE, 'readonly')
  const records = await requestResult(
    tx.objectStore(PACK_HISTORY_STORE).getAll() as IDBRequest<
      PackHistoryRecord[]
    >,
  )
  const result: Record<string, PackVersion[]> = {}
  for (const record of records) result[record.id] = record.versions
  return result
}

async function backfillPackHistory(
  entries: LibraryEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const existing = await listAllPackHistory()
  for (const entry of entries) {
    if (existing[entry.id]) continue
    try {
      await recordPackVersion(
        entry.id,
        entry.title,
        entry.release,
        entry.installed,
      )
    } catch {
      // History is best-effort.
    }
  }
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openDb()
  let entries = await requestResult(
    db
      .transaction(LIBRARY_STORE, 'readonly')
      .objectStore(LIBRARY_STORE)
      .getAll() as IDBRequest<LibraryEntry[]>,
  )

  if (entries.length === 0) {
    const records = await requestResult(
      db
        .transaction(PACK_STORE, 'readonly')
        .objectStore(PACK_STORE)
        .getAll() as IDBRequest<PackRecord[]>,
    )
    if (records.length === 0) return []
    entries = records.map(({ pack, installed }) =>
      toLibraryEntry(pack, installed),
    )
    const tx = db.transaction(LIBRARY_STORE, 'readwrite')
    for (const entry of entries) {
      tx.objectStore(LIBRARY_STORE).put(entry)
    }
    await transactionDone(tx)
  }

  await backfillPackHistory(entries)
  return entries.sort((a, b) => b.installed.localeCompare(a.installed))
}

export async function installPack(pack: Pack): Promise<LibraryEntry> {
  const db = await openDb()
  const installed = new Date().toISOString()
  const entry = toLibraryEntry(pack, installed)
  const tx = db.transaction([PACK_STORE, LIBRARY_STORE], 'readwrite')
  tx.objectStore(PACK_STORE).put({ id: pack.id, pack, installed })
  tx.objectStore(LIBRARY_STORE).put(entry)
  await transactionDone(tx)
  try {
    await recordPackVersion(pack.id, pack.title, pack.release, installed)
  } catch {
    // Version history is best-effort.
  }
  return entry
}

export async function recordPlayed(pack: Pack): Promise<void> {
  const db = await openDb()
  const entry: HistoryEntry = {
    id: pack.id,
    title: pack.title,
    theme: pack.theme,
    cover: pack.cover,
    lastPlayed: new Date().toISOString(),
  }
  const tx = db.transaction(HISTORY_STORE, 'readwrite')
  tx.objectStore(HISTORY_STORE).put(entry)
  await transactionDone(tx)
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await openDb()
  const tx = db.transaction(HISTORY_STORE, 'readonly')
  const records = await requestResult(
    tx.objectStore(HISTORY_STORE).getAll() as IDBRequest<HistoryEntry[]>,
  )
  return records.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
}

export async function clearHistory(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(HISTORY_STORE, 'readwrite')
  tx.objectStore(HISTORY_STORE).clear()
  await transactionDone(tx)
}

export async function loadPack(id: string): Promise<Pack | null> {
  const db = await openDb()
  const tx = db.transaction(PACK_STORE, 'readonly')
  const record = await requestResult(
    tx.objectStore(PACK_STORE).get(id) as IDBRequest<PackRecord | undefined>,
  )
  return record?.pack ?? null
}

export async function removePack(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(
    [PACK_STORE, PROGRESS_STORE, LIBRARY_STORE, HISTORY_STORE],
    'readwrite',
  )
  tx.objectStore(PACK_STORE).delete(id)
  tx.objectStore(PROGRESS_STORE).delete(id)
  tx.objectStore(LIBRARY_STORE).delete(id)
  tx.objectStore(HISTORY_STORE).delete(id)
  await transactionDone(tx)
}

export async function saveProgress(
  id: string,
  progress: SavedProgress,
): Promise<void> {
  const db = await openDb()
  const record: ProgressRecord = {
    id,
    state: progress.state,
    turns: progress.turns,
    image: progress.image,
  }
  const tx = db.transaction(PROGRESS_STORE, 'readwrite')
  tx.objectStore(PROGRESS_STORE).put(record)
  await transactionDone(tx)
}

export async function loadProgress(id: string): Promise<SavedProgress | null> {
  const db = await openDb()
  const tx = db.transaction(PROGRESS_STORE, 'readonly')
  const record = await requestResult(
    tx.objectStore(PROGRESS_STORE).get(id) as IDBRequest<
      ProgressRecord | undefined
    >,
  )
  return record
    ? { state: record.state, turns: record.turns, image: record.image }
    : null
}

export async function clearProgress(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PROGRESS_STORE, 'readwrite')
  tx.objectStore(PROGRESS_STORE).delete(id)
  await transactionDone(tx)
}
