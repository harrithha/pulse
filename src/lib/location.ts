import { matchHomePlace, matchHomePlaceFromCoords, type HomePlace, type RawPlace } from './places'

const FALLBACK_MS = 1_500
const CACHED_GPS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 500,
  maximumAge: 7 * 24 * 60 * 60 * 1000,
}
const PROMPT_GPS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 7 * 24 * 60 * 60 * 1000,
}

async function fetchJson(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function hasPlace(home: HomePlace | null | undefined): home is HomePlace {
  return Boolean(home && (home.city || home.state))
}

function rawFromCloud(data: Record<string, unknown>): RawPlace {
  return {
    city: asString(data.city),
    locality: asString(data.locality),
    region: asString(data.principalSubdivision),
    country: asString(data.countryName),
  }
}

async function fromIp(signal: AbortSignal): Promise<RawPlace | null> {
  const ipwho = fetchJson('https://ipwho.is/', signal).then(data => {
    if (data.success === false) throw new Error('ipwho')
    return {
      city: asString(data.city),
      region: asString(data.region),
      country: asString(data.country),
    } satisfies RawPlace
  })
  const cloud = fetchJson(
    'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en',
    signal,
  ).then(rawFromCloud)

  const settled = await Promise.allSettled([ipwho, cloud])
  for (const result of settled) {
    if (result.status === 'fulfilled' && (result.value.city || result.value.region)) return result.value
  }
  return null
}

async function lookupPlaceFromIp(): Promise<HomePlace | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), FALLBACK_MS)
  try {
    const home = matchHomePlace(await fromIp(ctrl.signal))
    return hasPlace(home) ? home : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

async function lookupPlaceFromGps(coords: { lat: number; lon: number }): Promise<HomePlace | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), FALLBACK_MS)
  try {
    const data = await fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=en`,
      ctrl.signal,
    )
    const home = matchHomePlace(rawFromCloud(data))
    return hasPlace(home) ? home : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

let ipPlace: Promise<HomePlace | null> | undefined

export function prefetchIpPlace() {
  if (typeof window === 'undefined') return
  ipPlace ??= lookupPlaceFromIp()
}

async function takeIpPlace(): Promise<HomePlace | null> {
  if (ipPlace) {
    const hit = await ipPlace
    if (hit) return hit
  }
  ipPlace = lookupPlaceFromIp()
  return ipPlace
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

export type LocationAccess = {
  access: 'granted' | 'denied'
  coords?: { lat: number; lon: number }
}

function coordsFromPosition(pos: GeolocationPosition): { lat: number; lon: number } {
  return { lat: pos.coords.latitude, lon: pos.coords.longitude }
}

function readGps(options: PositionOptions): Promise<{ lat: number; lon: number } | undefined> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(undefined)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(coordsFromPosition(pos)),
      () => resolve(undefined),
      options,
    )
  })
}

function wait(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms))
}

function metroFromCoords(coords?: { lat: number; lon: number }) {
  if (!coords) return null
  const near = matchHomePlaceFromCoords(coords.lat, coords.lon)
  return near.city ? near : null
}

/** Browser prompt. The moment Allow fires, take a cached fix — do not wait for a new GPS lock. */
export function askLocationAccess(): Promise<LocationAccess> {
  return new Promise(resolve => {
    let done = false
    let unsub = () => {}
    const finish = (result: LocationAccess) => {
      if (done) return
      done = true
      unsub()
      resolve(result)
    }

    const grantFast = () => {
      void readGps(CACHED_GPS).then(coords => finish({ access: 'granted', coords }))
    }

    void queryGeolocationPermission().then(state => {
      if (state === 'denied') finish({ access: 'denied' })
      if (state === 'granted') grantFast()
    })
    unsub = subscribeGeolocationPermission(state => {
      if (state === 'denied') finish({ access: 'denied' })
      if (state === 'granted') grantFast()
    })

    if (!navigator.geolocation) {
      finish({ access: 'denied' })
      return
    }

    navigator.geolocation.getCurrentPosition(
      pos => finish({ access: 'granted', coords: coordsFromPosition(pos) }),
      err => {
        if (done) return
        if (err.code === err.PERMISSION_DENIED) finish({ access: 'denied' })
        else grantFast()
      },
      PROMPT_GPS,
    )
  })
}

export type HomeDetectResult = {
  access: 'granted' | 'denied'
  home: HomePlace | null
}

/** After Allow: cached GPS metro match, or the prefetched IP — whichever has a city first. */
export async function detectHomePlace(): Promise<HomeDetectResult> {
  const access = await askLocationAccess()
  if (access.access !== 'granted') return { access: 'denied', home: null }

  const instant = metroFromCoords(access.coords)
  if (instant) return { access: 'granted', home: instant }

  const gpsP = readGps(CACHED_GPS)
  const ipP = takeIpPlace()

  const raced = await Promise.race([gpsP, wait(200).then(() => undefined)])
  const quickGps = metroFromCoords(raced)
  if (quickGps) return { access: 'granted', home: quickGps }

  const ip = await ipP
  if (ip?.city) return { access: 'granted', home: ip }

  const gps = metroFromCoords(await gpsP)
  if (gps) return { access: 'granted', home: gps }

  const coords = access.coords ?? (await gpsP)
  if (coords) {
    const named = await lookupPlaceFromGps(coords)
    if (hasPlace(named)) return { access: 'granted', home: named }
  }
  return { access: 'granted', home: ip }
}

prefetchIpPlace()
