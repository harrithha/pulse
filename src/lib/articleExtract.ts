/** Publisher page variants we should try when the canonical URL is thin or slow. */

export function isArticleUrl(url = '') {
  if (!url || /news\.google\.com/i.test(url)) return false
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '') || '/'
    const segs = path.split('/').filter(Boolean)
    if (path === '/' || !segs.length) return false
    if (/\/(rss|feed|feeds)(\/|$)/i.test(path)) return false
    if (/^\/(latest|topic|topics|section|tag|tags|liveblog|videos|photos)(\/|$)/i.test(path)) return false
    if (/timesofindia\.indiatimes|economictimes/i.test(host)) {
      return /articleshow|amp_articleshow/i.test(path) || /\/\d{6,}(?:\/|$)/.test(path)
    }
    if (/indianexpress/i.test(host)) return /\/article\//i.test(path)
    if (/ndtv/i.test(host)) return segs.length >= 2 && /\d{5,}/.test(path)
    if (/livemint/i.test(host)) return /\.html?$/i.test(path) || /\d{10,}/.test(path)
    if (/cnbctv18|cnbc\.com/i.test(host)) return segs.length >= 2 && (/\d{5,}/.test(path) || /\.html?$/i.test(path))
    return segs.length >= 2 && (/\d{5,}/.test(path) || /\.html?$|\.cms$/i.test(path) || /\/article\//i.test(path))
  } catch {
    return false
  }
}

export function publisherAltUrls(url: string): string[] {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    const origin = `${u.protocol}//${u.host}`

    if (host === 'ndtv.com' || host.endsWith('.ndtv.com')) {
      if (/\/amp(?:\/|$)/i.test(path)) return []
      return [`${origin}${path}/amp/1`]
    }

    if (host === 'indianexpress.com' || host.endsWith('.indianexpress.com')) {
      if (u.searchParams.get('outputType') === 'amp' || /\/lite\/?$/i.test(path)) return []
      const lite = path.endsWith('/') ? `${origin}${path}lite/` : `${origin}${path}/lite/`
      return [`${origin}${path}?outputType=amp`, lite]
    }

    if (host === 'timesofindia.indiatimes.com' || host.endsWith('.timesofindia.indiatimes.com')) {
      if (/amp_articleshow/i.test(path)) return []
      if (/\/articleshow\//i.test(path)) return [`${origin}${path.replace('/articleshow/', '/amp_articleshow/')}${u.search}`]
      return []
    }

    if (host === 'economictimes.indiatimes.com' || host.endsWith('.economictimes.indiatimes.com') || host === 'economictimes.com' || host.endsWith('.economictimes.com')) {
      if (/amp_articleshow/i.test(path)) return []
      if (!/\/articleshow\//i.test(path)) return []
      const ampPath = `${path.replace('/articleshow/', '/amp_articleshow/')}`
      return [`https://m.economictimes.com${ampPath}`]
    }

    if (host === 'livemint.com' || host.endsWith('.livemint.com')) {
      if (path.startsWith('/amp/') || path.startsWith('/amp-')) return []
      return [`${origin}/amp${path}${u.search}`]
    }

    if (host === 'cnbctv18.com' || host.endsWith('.cnbctv18.com') || host === 'cnbc.com' || host.endsWith('.cnbc.com')) {
      if (path.startsWith('/amp/') || u.searchParams.has('amp')) return []
      return [`${origin}/amp${path}${u.search}`]
    }
  } catch {
    /* ignore */
  }
  return []
}

export function ampHtmlHref(html: string, baseUrl = ''): string {
  const match =
    html.match(/rel=["']amphtml["'][^>]*href=["']([^"']+)/i) ||
    html.match(/href=["']([^"']+)["'][^>]*rel=["']amphtml["']/i)
  const href = match?.[1]?.replace(/&amp;/g, '&').trim()
  if (!href) return ''
  try {
    return new URL(href, baseUrl || undefined).href
  } catch {
    return href
  }
}

export function isFullArticle(paragraphs: string[], rssSummary = '') {
  const paras = paragraphs.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (paras.length >= 2) return true
  const first = paras[0] || ''
  if (first.length >= 500) return true
  if (!first) return false
  const summary = rssSummary.replace(/\s+/g, ' ').trim()
  if (summary && first.toLowerCase().startsWith(summary.toLowerCase().slice(0, 80))) {
    return first.length > summary.length + 120
  }
  return false
}

/** Turn a JSON-LD / meta blob into readable paragraphs, even when the source is one block. */
export function splitArticleBody(body: string): string[] {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const byBreak = body
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 70)
  if (byBreak.length >= 2) return byBreak.slice(0, 40)
  const source = byBreak[0] || text
  if (source.length < 140) return source.length > 70 ? [source] : []
  const sentences = source.split(/(?<=[.!?])\s+(?=[A-Z"“'‘])/).map(s => s.trim()).filter(s => s.length > 40)
  if (sentences.length >= 2) return sentences.slice(0, 40)
  return source.length > 70 ? [source] : []
}
