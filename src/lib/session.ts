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

const LOC_TAB_KEY = 'pulse-loc-tab'

export function readTabLocationGranted() {
  try {
    return sessionStorage.getItem(LOC_TAB_KEY) === 'granted'
  } catch {
    return false
  }
}

export function readTabLocationAsked() {
  try {
    return sessionStorage.getItem(LOC_TAB_KEY) === 'granted' || sessionStorage.getItem(LOC_TAB_KEY) === 'denied'
  } catch {
    return false
  }
}

export function writeTabLocation(status: 'granted' | 'denied') {
  try {
    sessionStorage.setItem(LOC_TAB_KEY, status)
  } catch {
    /* private mode */
  }
}
