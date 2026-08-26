export const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Chennai', 'Hyderabad', 'Delhi', 'Kolkata', 'Ahmedabad'] as const
export const STATES = ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan'] as const
export const TOPICS = ['Technology', 'AI', 'Business', 'Startups', 'Sports', 'Entertainment', 'Science', 'Politics', 'Finance'] as const
export const BROADER = ['India', 'World'] as const

export type City = (typeof CITIES)[number]
export type StateName = (typeof STATES)[number]

export const CITY_TO_STATE: Partial<Record<City, StateName>> = {
  Pune: 'Maharashtra',
  Mumbai: 'Maharashtra',
  Bengaluru: 'Karnataka',
  Chennai: 'Tamil Nadu',
  Hyderabad: 'Telangana',
  Ahmedabad: 'Gujarat',
}

const CITY_COORDS: Record<City, { lat: number; lon: number }> = {
  Pune: { lat: 18.5204, lon: 73.8567 },
  Mumbai: { lat: 19.076, lon: 72.8777 },
  Bengaluru: { lat: 12.9716, lon: 77.5946 },
  Chennai: { lat: 13.0827, lon: 80.2707 },
  Hyderabad: { lat: 17.385, lon: 78.4867 },
  Delhi: { lat: 28.6139, lon: 77.209 },
  Kolkata: { lat: 22.5726, lon: 88.3639 },
  Ahmedabad: { lat: 23.0225, lon: 72.5714 },
}

const CITY_RADIUS_KM = 85

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Instant city match from GPS — skips a network reverse-geocode. */
export function matchHomePlaceFromCoords(lat: number, lon: number): HomePlace {
  let best: City | undefined
  let bestKm = Infinity
  for (const city of CITIES) {
    const km = haversineKm({ lat, lon }, CITY_COORDS[city])
    if (km < bestKm) {
      bestKm = km
      best = city
    }
  }
  if (!best || bestKm > CITY_RADIUS_KM) return {}
  return { city: best, state: CITY_TO_STATE[best] }
}

const CITY_HINTS: Array<[RegExp, City]> = [
  [/\b(pune|poona|pimpri|chinchwad|pcmc|hadapsar|hinjewadi|wagholi|kharadi|wakad|baner|aundh)\b/i, 'Pune'],
  [/\b(mumbai|bombay|navi mumbai|thane|kalyan|powai|bandra|andheri|worli|dadar|vashi)\b/i, 'Mumbai'],
  [/\b(bengaluru|bangalore|whitefield|koramangala|indiranagar|electronic city)\b/i, 'Bengaluru'],
  [/\b(chennai|madras|adyar|t nagar|tambaram|omr)\b/i, 'Chennai'],
  [/\b(hyderabad|secunderabad|hitec|gachibowli|madhapur)\b/i, 'Hyderabad'],
  [/\b(new delhi|delhi|noida|gurugram|gurgaon|ghaziabad|faridabad|ncr)\b/i, 'Delhi'],
  [/\b(kolkata|calcutta|howrah|salt lake)\b/i, 'Kolkata'],
  [/\b(ahmedabad|amdavad|gandhinagar|sg highway)\b/i, 'Ahmedabad'],
]

const STATE_HINTS: Array<[RegExp, StateName]> = [
  [/\bmaharashtra\b|\bMH\b/i, 'Maharashtra'],
  [/\btamil nadu\b|\btamilnadu\b|\bTN\b/i, 'Tamil Nadu'],
  [/\bkarnataka\b|\bKA\b/i, 'Karnataka'],
  [/\btelangana\b|\bTS\b|\bTG\b/i, 'Telangana'],
  [/\bgujarat\b|\bGJ\b/i, 'Gujarat'],
  [/\brajasthan\b|\bRJ\b/i, 'Rajasthan'],
]

export type HomePlace = {
  city?: City
  state?: StateName
}

export type RawPlace = {
  city?: string
  locality?: string
  region?: string
  country?: string
}

function haystack(raw: RawPlace) {
  return [raw.city, raw.locality, raw.region, raw.country].filter(Boolean).join(' ')
}

export function matchHomePlace(raw: RawPlace | null | undefined): HomePlace {
  if (!raw) return {}
  const text = haystack(raw)
  if (!text.trim()) return {}
  const city = CITY_HINTS.find(([re]) => re.test(text))?.[1]
  const state = STATE_HINTS.find(([re]) => re.test(text))?.[1] || (city && CITY_TO_STATE[city])
  return { city, state }
}

export function homePlaceLabel(home: HomePlace) {
  return [home.city, home.state].filter(Boolean).join(', ')
}

export function isLegacyDefaultLocations(locations: string[]) {
  const set = new Set(locations)
  return set.size === 4 && set.has('Pune') && set.has('Maharashtra') && set.has('India') && set.has('World')
}

export function mergeHomeLocations(locations: Iterable<string>, home: HomePlace, replaceLegacy = false) {
  const next = new Set(locations)
  if (replaceLegacy) {
    next.delete('Pune')
    next.delete('Maharashtra')
  }
  if (home.city) next.add(home.city)
  if (home.state) next.add(home.state)
  if (!next.size) {
    next.add('India')
    next.add('World')
  }
  return next
}
