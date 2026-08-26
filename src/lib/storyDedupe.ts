export function headlineDedupeKey(headline: string) {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 8)
    .join(' ')
}

export function urlDedupeKey(url = '') {
  try {
    const u = new URL(url)
    if (/news\.google\.com/i.test(u.hostname)) return ''
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return ''
  }
}
