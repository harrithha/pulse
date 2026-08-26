import type { City, StateName } from './places'
import type { Session } from '../types'

export type ThemeName = 'dark' | 'light'

export type Prefs = {
  locations?: string[]
  topics?: string[]
  onboarded?: boolean
  homeCity?: City
  homeState?: StateName
  theme?: ThemeName
  locationSkipped?: boolean
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F6F1EA' : '#07070C')
}

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
    return JSON.parse(raw) as Prefs
  } catch {
    return null
  }
}

export function writePrefs(prefs: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}
