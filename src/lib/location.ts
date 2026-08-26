import { matchHomePlace, type HomePlace, type RawPlace } from './places'

const IP_TIMEOUT_MS = 3_000

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
  ).then(data => ({
    city: asString(data.city),
    locality: asString(data.locality),
    region: asString(data.principalSubdivision),
    country: asString(data.countryName),
  }) satisfies RawPlace)

  const settled = await Promise.allSettled([ipwho, cloud])
  for (const result of settled) {
    if (result.status === 'fulfilled' && (result.value.city || result.value.region)) return result.value
  }
  return null
}

async function lookupPlaceFromIp(): Promise<HomePlace | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), IP_TIMEOUT_MS)
  try {
    const home = matchHomePlace(await fromIp(ctrl.signal))
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

function takeIpPlace() {
  prefetchIpPlace()
  return ipPlace ?? lookupPlaceFromIp()
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

/** Browser prompt only. Does not read GPS coords. */
export function askLocationAccess(): Promise<'granted' | 'denied'> {
  return new Promise(resolve => {
    let done = false
    let unsub = () => {}
    const finish = (status: 'granted' | 'denied') => {
      if (done) return
      done = true
      unsub()
      resolve(status)
    }

    void queryGeolocationPermission().then(state => {
      if (state === 'granted') finish('granted')
      if (state === 'denied') finish('denied')
    })
    unsub = subscribeGeolocationPermission(state => {
      if (state === 'granted') finish('granted')
      if (state === 'denied') finish('denied')
    })

    if (!navigator.geolocation) {
      finish('denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => finish('granted'),
      err => {
        if (err.code === err.PERMISSION_DENIED) finish('denied')
        void queryGeolocationPermission().then(state => {
          if (state === 'granted') finish('granted')
          if (state === 'denied') finish('denied')
          if (state === 'unknown') finish('granted')
        })
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

/** Ask first. After Allow, detect city from IP. After Block, return null. */
export async function detectHomePlace(): Promise<HomePlace | null> {
  const access = await askLocationAccess()
  if (access !== 'granted') return null
  return takeIpPlace()
}

prefetchIpPlace()
