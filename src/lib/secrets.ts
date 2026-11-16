import { invoke } from '@tauri-apps/api/core'
import { runningInTauri } from './platform'

const BROWSER_KEY = 'knotebook.ai.api-key.v1'

export async function loadApiKey(): Promise<string> {
  if (runningInTauri()) {
    try {
      return (await invoke<string | null>('get_api_key')) ?? ''
    } catch {
      return ''
    }
  }
  try {
    return localStorage.getItem(BROWSER_KEY) ?? ''
  } catch {
    return ''
  }
}

export async function saveApiKey(key: string): Promise<boolean> {
  const trimmed = key.trim()
  if (runningInTauri()) {
    try {
      await invoke('set_api_key', { key: trimmed })
      return true
    } catch {
      // The keychain is best-effort; the settings stay usable in memory.
      return false
    }
  }
  try {
    if (trimmed) {
      localStorage.setItem(BROWSER_KEY, trimmed)
    } else {
      localStorage.removeItem(BROWSER_KEY)
    }
    return true
  } catch {
    // Browser storage is best-effort.
    return false
  }
}
