import { matchHomePlace, type HomePlace, type RawPlace } from './places'

const TIMEOUT_MS = 12_000

async function fetchJson(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function gpsCoords(timeout: number) {
  return new Promise<{ lat: number; lon: number } | null>(resolve => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: 15 * 60 * 1000 },
    )
  })
}

async function fromGps(signal: AbortSignal): Promise<RawPlace | null> {
  const coords = await gpsCoords(TIMEOUT_MS)
  if (!coords || signal.aborted) return null
  try {
    const data = await fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=en`,
      signal,
    )
    return {
      city: asString(data.city),
      locality: asString(data.locality),
      region: asString(data.principalSubdivision),
      country: asString(data.countryName),
    }
  } catch {
    return null
  }
}

/** Only runs after the user taps Allow. Never infers city from IP. */
export async function detectHomePlace(): Promise<HomePlace | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS + 1500)
  try {
    const gps = matchHomePlace(await fromGps(ctrl.signal))
    if (gps.city || gps.state) return gps
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
