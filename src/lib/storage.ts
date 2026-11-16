import type { Pack } from './pack'

const DB_NAME = 'knotebook'
const DB_VERSION = 2
const PACK_STORE = 'packs'
const PROGRESS_STORE = 'progress'
const LIBRARY_STORE = 'library'

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

export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openDb()
  const entries = await requestResult(
    db
      .transaction(LIBRARY_STORE, 'readonly')
      .objectStore(LIBRARY_STORE)
      .getAll() as IDBRequest<LibraryEntry[]>,
  )
  if (entries.length > 0) {
    return entries.sort((a, b) => b.installed.localeCompare(a.installed))
  }

  const records = await requestResult(
    db
      .transaction(PACK_STORE, 'readonly')
      .objectStore(PACK_STORE)
      .getAll() as IDBRequest<PackRecord[]>,
  )
  if (records.length === 0) return []
  const migrated = records.map(({ pack, installed }) =>
    toLibraryEntry(pack, installed),
  )
  const tx = db.transaction(LIBRARY_STORE, 'readwrite')
  for (const entry of migrated) {
    tx.objectStore(LIBRARY_STORE).put(entry)
  }
  await transactionDone(tx)
  return migrated.sort((a, b) => b.installed.localeCompare(a.installed))
}

export async function installPack(pack: Pack): Promise<LibraryEntry> {
  const db = await openDb()
  const installed = new Date().toISOString()
  const entry = toLibraryEntry(pack, installed)
  const tx = db.transaction([PACK_STORE, LIBRARY_STORE], 'readwrite')
  tx.objectStore(PACK_STORE).put({ id: pack.id, pack, installed })
  tx.objectStore(LIBRARY_STORE).put(entry)
  await transactionDone(tx)
  return entry
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
    [PACK_STORE, PROGRESS_STORE, LIBRARY_STORE],
    'readwrite',
  )
  tx.objectStore(PACK_STORE).delete(id)
  tx.objectStore(PROGRESS_STORE).delete(id)
  tx.objectStore(LIBRARY_STORE).delete(id)
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
