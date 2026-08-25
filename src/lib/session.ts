import type { Session } from '../types'

const SESSION_KEY = 'pulse-session'
const PREFS_KEY = 'pulse-prefs'

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (!parsed.name || !parsed.email) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { locations?: string[]; topics?: string[]; onboarded?: boolean }
  } catch {
    return null
  }
}

export function writePrefs(prefs: { locations: string[]; topics: string[]; onboarded: boolean }) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}
