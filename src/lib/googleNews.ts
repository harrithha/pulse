export function googleNewsArticleId(url: string) {
  return url.match(/\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/)?.[1] || ''
}

export function isGoogleNewsUrl(url = '') {
  return /news\.google\.com/i.test(url)
}

export function parseGoogleNewsBatchResponse(body: string) {
  let text = body.replace(/^\)\]\}'\s*/, '').trim()
  const nl = text.indexOf('\n')
  if (nl > 0 && /^\d+$/.test(text.slice(0, nl).trim())) {
    text = text.slice(nl + 1).trim()
  }
  try {
    const envelopes = JSON.parse(text) as unknown
    if (!Array.isArray(envelopes)) return ''
    for (const env of envelopes) {
      if (!Array.isArray(env) || env[1] !== 'Fbv4je' || typeof env[2] !== 'string') continue
      try {
        const payload = JSON.parse(env[2]) as unknown
        if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
          return payload[1]
        }
      } catch {
        /* ignore one envelope */
      }
    }
  } catch {
    return ''
  }
  return ''
}

export function googleNewsBatchexecuteBody(articleId: string, timestamp: string | number, signature: string) {
  const rpcInner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'IN:en', null, 1, null, null, null, null, null, 0, 1],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    Number(timestamp),
    signature,
  ])
  return new URLSearchParams({
    'f.req': JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]]),
  }).toString()
}
