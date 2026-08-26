import { matchHomePlace, matchHomePlaceFromCoords, type HomePlace, type RawPlace } from './places'

const FIX_TIMEOUT_MS = 6_000
const GEOCODE_TIMEOUT_MS = 2_000

async function fetchJson(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function gpsCoords(): Promise<{ lat: number; lon: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    let settled = false
    let watchId: number | undefined
    let timer: number | undefined
    let unsub: (() => void) | undefined

    const finish = (coords: { lat: number; lon: number } | null) => {
      if (settled) return
      settled = true
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      if (timer != null) window.clearTimeout(timer)
      unsub?.()
      resolve(coords)
    }

    const armTimer = () => {
      if (settled || timer != null) return
      timer = window.setTimeout(() => finish(null), FIX_TIMEOUT_MS)
    }

    const onOk = (pos: GeolocationPosition) => {
      finish({ lat: pos.coords.latitude, lon: pos.coords.longitude })
    }

    try {
      watchId = navigator.geolocation.watchPosition(
        onOk,
        err => {
          if (err.code === err.PERMISSION_DENIED) finish(null)
        },
        {
          enableHighAccuracy: false,
          maximumAge: 15 * 60 * 1000,
          timeout: 25_000,
        },
      )
    } catch {
      navigator.geolocation.getCurrentPosition(onOk, () => finish(null), {
        enableHighAccuracy: false,
        maximumAge: 15 * 60 * 1000,
        timeout: 25_000,
      })
    }

    void queryGeolocationPermission().then(state => {
      if (settled) return
      if (state === 'denied') finish(null)
      if (state === 'granted') armTimer()
    })
    unsub = subscribeGeolocationPermission(state => {
      if (state === 'denied') finish(null)
      if (state === 'granted') armTimer()
    })
  })
}

async function reverseGeocode(lat: number, lon: number): Promise<RawPlace | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS)
  try {
    const data = await fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      ctrl.signal,
    )
    return {
      city: asString(data.city),
      locality: asString(data.locality),
      region: asString(data.principalSubdivision),
      country: asString(data.countryName),
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export type GeoPermission = PermissionState | 'unknown'

export async function queryGeolocationPermission(): Promise<GeoPermission> {
  try {
    if (!navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'unknown'
  }
}

export function subscribeGeolocationPermission(onChange: (state: PermissionState) => void) {
  let status: PermissionStatus | undefined
  let cancelled = false
  const onEvent = () => {
    if (status) onChange(status.state)
  }
  void (async () => {
    try {
      if (!navigator.permissions?.query) return
      status = await navigator.permissions.query({ name: 'geolocation' })
      if (cancelled) return
      status.addEventListener('change', onEvent)
    } catch {
      /* Safari */
    }
  })()
  return () => {
    cancelled = true
    status?.removeEventListener('change', onEvent)
  }
}

/** Browser GPS only. Never infers city from IP. */
export async function detectHomePlace(): Promise<HomePlace | null> {
  const coords = await gpsCoords()
  if (!coords) return null

  const nearby = matchHomePlaceFromCoords(coords.lat, coords.lon)
  if (nearby.city || nearby.state) return nearby

  const named = matchHomePlace(await reverseGeocode(coords.lat, coords.lon))
  if (named.city || named.state) return named
  return null
}

let earlyDetect: Promise<HomePlace | null> | undefined

/** Start a long-lived GPS watch so the Allow dialog cannot kill the request. */
export function prefetchHomePlace() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  earlyDetect ??= detectHomePlace()
}

export function takeEarlyDetect() {
  prefetchHomePlace()
  return earlyDetect ?? detectHomePlace()
}

prefetchHomePlace()
