import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { handleTts, type TtsOptions } from './pulse-tts.js'
import { ampHtmlHref, isArticleUrl, isFullArticle, publisherAltUrls, splitArticleBody } from './src/lib/articleExtract.js'
import { cleanArticleParagraphs, isJunkParagraph } from './src/lib/articleText.js'
import {
  googleNewsArticleId,
  googleNewsBatchexecuteBody,
  isGoogleNewsUrl,
  parseGoogleNewsBatchResponse,
} from './src/lib/googleNews.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const FETCH_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: 'https://www.google.com/',
}

const STOP = new Set(
  'a an the in on of for to and as at by from with after over into about after before under up down out off this that these those is are was were be been being it its their his her they we you your our not no or but if than then so just more most new also will can could would should into across amid amid amid'.split(
    ' ',
  ),
)

const TOPIC_FEEDS: Record<string, { kind: 'topic' | 'search'; value: string }> = {
  Technology: { kind: 'topic', value: 'TECHNOLOGY' },
  AI: { kind: 'search', value: '"artificial intelligence" OR ChatGPT OR OpenAI when:1d' },
  Business: { kind: 'topic', value: 'BUSINESS' },
  Startups: { kind: 'search', value: 'startup India when:1d' },
  Sports: { kind: 'topic', value: 'SPORTS' },
  Entertainment: { kind: 'topic', value: 'ENTERTAINMENT' },
  Science: { kind: 'topic', value: 'SCIENCE' },
  Politics: { kind: 'search', value: 'India politics OR parliament when:1d' },
  Finance: { kind: 'search', value: 'Sensex OR Nifty OR RBI OR markets India when:1d' },
}

type Feed = { shelf: string; url: string; publisher?: string }

const ALLOWED_HOSTS = [
  'timesofindia.indiatimes.com',
  'blogs.timesofindia.indiatimes.com',
  'ndtv.com',
  'indianexpress.com',
  'livemint.com',
  'economictimes.indiatimes.com',
  'economictimes.com',
  'cnbctv18.com',
  'cnbc.com',
]

const GOOGLE_SITES =
  'site:timesofindia.indiatimes.com OR site:ndtv.com OR site:indianexpress.com OR site:livemint.com OR site:economictimes.indiatimes.com OR site:cnbctv18.com OR site:cnbc.com'

function isAllowedSource(name: string, url = '') {
  const t = `${name} ${url}`.toLowerCase()
  return (
    /times of india|timesofindia\.indiatimes|\btoi\b/.test(t) ||
    /\bndtv\b/.test(t) ||
    /\bcnbc/.test(t) ||
    /indian express|indianexpress/.test(t) ||
    /\bmint\b|livemint/.test(t) ||
    /economic times|economictimes/.test(t)
  )
}

function publisherKey(name = '') {
  const t = name.toLowerCase()
  if (/economic times|economictimes/.test(t)) return 'et'
  if (/times of india|timesofindia|\btoi\b/.test(t)) return 'toi'
  if (/\bndtv\b/.test(t)) return 'ndtv'
  if (/indian express|indianexpress/.test(t)) return 'ie'
  if (/\bmint\b|livemint/.test(t)) return 'mint'
  if (/\bcnbc/.test(t)) return 'cnbc'
  return t.replace(/[^a-z0-9]+/g, '')
}

const IMAGE_FEEDS: Feed[] = [
  { shelf: '_img', url: 'https://feeds.feedburner.com/ndtvnews-latest', publisher: 'NDTV' },
  { shelf: '_img', url: 'https://feeds.feedburner.com/ndtvmovies-latest', publisher: 'NDTV' },
  { shelf: '_img', url: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms', publisher: 'The Economic Times' },
  { shelf: '_img', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', publisher: 'The Times of India' },
  { shelf: '_img', url: 'https://indianexpress.com/feed/', publisher: 'The Indian Express' },
  { shelf: '_img', url: 'https://www.livemint.com/rss/news', publisher: 'Mint' },
  { shelf: '_img', url: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/latest.xml', publisher: 'CNBC' },
]

const TOI_CITY: Record<string, string> = {
  Pune: 'https://timesofindia.indiatimes.com/rssfeeds/-2128821991.cms',
  Mumbai: 'https://timesofindia.indiatimes.com/rssfeeds/-2128838597.cms',
  Delhi: 'https://timesofindia.indiatimes.com/rssfeeds/-2128839596.cms',
  Bengaluru: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms',
  Chennai: 'https://timesofindia.indiatimes.com/rssfeeds/2950623.cms',
  Hyderabad: 'https://timesofindia.indiatimes.com/rssfeeds/-2128816011.cms',
  Kolkata: 'https://timesofindia.indiatimes.com/rssfeeds/-2128830821.cms',
  Ahmedabad: 'https://timesofindia.indiatimes.com/rssfeeds/-2128821153.cms',
}

const IE_CITY: Record<string, string> = {
  Pune: 'https://indianexpress.com/section/cities/pune/feed/',
  Mumbai: 'https://indianexpress.com/section/cities/mumbai/feed/',
  Delhi: 'https://indianexpress.com/section/cities/delhi/feed/',
  Bengaluru: 'https://indianexpress.com/section/cities/bangalore/feed/',
  Chennai: 'https://indianexpress.com/section/cities/chennai/feed/',
  Hyderabad: 'https://indianexpress.com/section/cities/hyderabad/feed/',
  Kolkata: 'https://indianexpress.com/section/cities/kolkata/feed/',
  Ahmedabad: 'https://indianexpress.com/section/cities/ahmedabad/feed/',
}

const STATE_HUB: Record<string, string> = {
  Maharashtra: 'Mumbai',
  'Tamil Nadu': 'Chennai',
  Karnataka: 'Bengaluru',
  Telangana: 'Hyderabad',
  Gujarat: 'Ahmedabad',
}

const PLACE_WORDS: Record<string, string[]> = {
  Pune: ['pune', 'pimpri', 'chinchwad', 'hadapsar'],
  Mumbai: ['mumbai', 'bombay', 'thane', 'navi mumbai', 'bandra', 'andheri'],
  Delhi: ['delhi', 'noida', 'gurgaon', 'gurugram', 'ncr'],
  Bengaluru: ['bengaluru', 'bangalore'],
  Chennai: ['chennai', 'madras'],
  Hyderabad: ['hyderabad', 'secunderabad'],
  Kolkata: ['kolkata', 'calcutta'],
  Ahmedabad: ['ahmedabad'],
  Maharashtra: ['maharashtra', 'mumbai', 'pune', 'nagpur', 'nashik', 'thane', 'aurangabad', 'kolhapur', 'solapur', 'navi mumbai', 'amravati'],
  'Tamil Nadu': ['tamil nadu', 'chennai', 'coimbatore', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'erode', 'vellore', 'tirunelveli', 'thoothukudi', 'kanchipuram', 'hosur'],
  Karnataka: ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'hubballi'],
  Telangana: ['telangana', 'hyderabad', 'warangal', 'secunderabad'],
  Gujarat: ['gujarat', 'ahmedabad', 'surat', 'vadodara', 'rajkot'],
  Rajasthan: ['rajasthan', 'jaipur', 'jodhpur', 'udaipur'],
}

function placeLabelFromShelf(shelf: string) {
  return shelf.replace(/^My City · /, '').trim()
}

function isStateShelf(label: string) {
  return ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan'].includes(label)
}

function mentionsPlace(item: { headline: string; url: string }, place: string) {
  const words = PLACE_WORDS[place]
  if (!words?.length) return true
  const hay = `${item.headline} ${item.url}`.toLowerCase()
  return words.some(w => hay.includes(w))
}

function mentionsStateName(headline: string, state: string) {
  return headline.toLowerCase().includes(state.toLowerCase())
}

const TOPIC_PUBLISHER_FEEDS: Record<string, Feed[]> = {
  Technology: [
    { shelf: 'Technology', url: 'https://timesofindia.indiatimes.com/rssfeeds/66949542.cms', publisher: 'The Times of India' },
    { shelf: 'Technology', url: 'https://feeds.feedburner.com/gadgets360-latest', publisher: 'NDTV' },
    { shelf: 'Technology', url: 'https://indianexpress.com/section/technology/feed/', publisher: 'The Indian Express' },
  ],
  Business: [
    { shelf: 'Business', url: 'https://timesofindia.indiatimes.com/rssfeeds/1898055.cms', publisher: 'The Times of India' },
    { shelf: 'Business', url: 'https://feeds.feedburner.com/ndtvprofit-latest', publisher: 'NDTV' },
    { shelf: 'Business', url: 'https://indianexpress.com/section/business/feed/', publisher: 'The Indian Express' },
    { shelf: 'Business', url: 'https://www.livemint.com/rss/money', publisher: 'Mint' },
    { shelf: 'Business', url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', publisher: 'The Economic Times' },
    { shelf: 'Business', url: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/latest.xml', publisher: 'CNBC' },
  ],
  Sports: [
    { shelf: 'Sports', url: 'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms', publisher: 'The Times of India' },
    { shelf: 'Sports', url: 'https://feeds.feedburner.com/ndtvsports-latest', publisher: 'NDTV' },
    { shelf: 'Sports', url: 'https://indianexpress.com/section/sports/feed/', publisher: 'The Indian Express' },
  ],
}

const EDITORIAL_FEEDS: Feed[] = [
  { shelf: 'Editorials', url: 'https://indianexpress.com/section/opinion/editorials/feed/', publisher: 'The Indian Express' },
  { shelf: 'Editorials', url: 'https://timesofindia.indiatimes.com/blogs/toi-editorials/feed/', publisher: 'The Times of India' },
  { shelf: 'Editorials', url: 'https://www.livemint.com/rss/opinion', publisher: 'Mint' },
  { shelf: 'Editorials', url: 'https://economictimes.indiatimes.com/opinion/et-editorial/rssfeeds/897228639.cms', publisher: 'The Economic Times' },
]

const INDIA_FEEDS: Feed[] = [
  { shelf: 'India', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', publisher: 'The Times of India' },
  { shelf: 'India', url: 'https://indianexpress.com/section/india/feed/', publisher: 'The Indian Express' },
  { shelf: 'India', url: 'https://feeds.feedburner.com/ndtvnews-india-news', publisher: 'NDTV' },
  { shelf: 'India', url: 'https://www.livemint.com/rss/news', publisher: 'Mint' },
  { shelf: 'India', url: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms', publisher: 'The Economic Times' },
  { shelf: 'India', url: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/india.xml', publisher: 'CNBC' },
]

const WORLD_FEEDS: Feed[] = [
  { shelf: 'World', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', publisher: 'The Times of India' },
  { shelf: 'World', url: 'https://feeds.feedburner.com/ndtvnews-world-news', publisher: 'NDTV' },
  { shelf: 'World', url: 'https://indianexpress.com/section/world/feed/', publisher: 'The Indian Express' },
  { shelf: 'World', url: 'https://www.livemint.com/rss/news', publisher: 'Mint' },
  { shelf: 'World', url: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/world.xml', publisher: 'CNBC' },
]

type RawItem = {
  headline: string
  url: string
  publisher: string
  publisherUrl: string
  summary: string
  image?: string
  publishedAt: string
  shelf: string
  body: string[]
}

type Publisher = { name: string; url: string }

export type Story = {
  id: string
  headline: string
  summary: string
  category: string
  time: string
  publishedAt: string
  sources: number
  image?: string
  url: string
  publishers: Publisher[]
  whatHappened: string[]
  whyItMatters: string
  shelf: string
  body: string[]
}

type BriefSection = {
  id: string
  label: string
  sub: string
  script: string
  dur: string
  storyIds: string[]
}

const cache = new Map<string, { at: number; body: string }>()
const CACHE_MS = 8 * 60 * 1000
const googleResolveCache = new Map<string, Promise<string>>()

function googleSearch(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`(${query}) (${GOOGLE_SITES}) when:1d`)}&hl=en-IN&gl=IN&ceid=IN:en`
}

function googleTopic(topic: string) {
  return `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-IN&gl=IN&ceid=IN:en`
}

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function tag(block: string, name: string) {
  const cdata = block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, 'i'))
  if (cdata) return cdata[1].trim()
  const plain = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return plain?.[1]?.trim() ?? ''
}

function attrTag(block: string, name: string, attr: string) {
  const m = block.match(new RegExp(`<${name}[^>]*\\s${attr}="([^"]+)"[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? { attr: m[1], text: m[2].trim() } : { attr: '', text: '' }
}

function mediaUrl(block: string) {
  const html = decode(block)
  const patterns = [
    /<media:content[^>]*url=["']([^"']+)["']/i,
    /<media:thumbnail[^>]*url=["']([^"']+)["']/i,
    /<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i,
    /<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    const src = match?.[1]?.replace(/&amp;/g, '&')
    if (src && /^https?:/i.test(src) && !/1x1|pixel|spacer|blank\.(gif|png)/i.test(src)) {
      return normalizeImage(src)
    }
    if (src && src.startsWith('//')) return normalizeImage(`https:${src}`)
  }
}

function normalizeImage(url: string) {
  if (!url) return url
  const src = url.startsWith('//') ? `https:${url}` : url
  const id = src.match(/msid-(\d+)/i)?.[1] || src.match(/\/photo\/(\d+)\.cms/i)?.[1]
  if (id && /toiimg|timesofindia/i.test(src)) {
    return `https://static.toiimg.com/thumb/msid-${id},width-800,resizemode-4/${id}.jpg`
  }
  return src
}

function articleUrl(block: string, fallback: string) {
  const hrefs = [...block.matchAll(/href=["']([^"']+)["']/gi)].map(m => decode(m[1]))
  return hrefs.find(h => /^https?:/i.test(h) && !/news\.google\.com/i.test(h)) || fallback
}

function htmlParagraphs(html: string): string[] {
  const blobs = [
    ...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi),
    ...html.matchAll(/<(?:div|span)[^>]*(?:article|story|content|Normal|artText|_s30J|sp-cn)[^>]*>([\s\S]*?)<\/(?:div|span)>/gi),
  ]
    .map(m => stripHtml(m[1]))
    .flatMap(p => p.split(/\n{2,}/))
    .map(p => p.replace(/\s+/g, ' ').trim())
    .map(p => p.split(/you can also check\s*:?/i)[0].replace(/[|\s]+$/g, '').trim())
    .filter(p => p.length > 55 && !isJunkParagraph(p) && !/cookie|subscribe|newsletter|advertisement|read more|sign in|download the app|click here|follow us|whatsapp|telegram|^\(?\s*function\b|vdo\.ai/i.test(p))
  const uniq: string[] = []
  for (const p of blobs) {
    if (!uniq.some(u => u.slice(0, 80) === p.slice(0, 80))) uniq.push(p)
  }
  return uniq.slice(0, 80)
}

function stripHtml(s: string) {
  return decode(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitHeadline(title: string, sourceName: string) {
  const decoded = decode(title).replace(/^(Opinion:\s*){2,}/i, 'Opinion: ')
  if (sourceName) {
    for (const sep of [` - ${sourceName}`, ` | ${sourceName}`]) {
      if (decoded.endsWith(sep)) return decoded.slice(0, -sep.length).trim()
    }
  }
  for (const sep of [' - ', ' | ']) {
    const idx = decoded.lastIndexOf(sep)
    if (idx > 24) return decoded.slice(0, idx).trim()
  }
  return decoded
}

function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
}

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

function relativeTime(iso: string) {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return 'Today'
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days}d ago`
}

function inferCategory(headline: string, shelf: string) {
  const h = headline.toLowerCase()
  if (/\b(cricket|t20|ipl|football|fifa|hockey|olympics|match|wicket)\b/.test(h)) return 'Sports'
  if (/\b(ai|chatgpt|openai|google|apple|microsoft|tech|app|chip)\b/.test(h)) return 'Technology'
  if (/\b(ipo|sensex|nifty|rbi|rupee|bank|gdp|market|stock)\b/.test(h)) return 'Finance'
  if (/\b(election|parliament|minister|bjp|congress|policy|bill)\b/.test(h)) return 'Politics'
  if (/\b(climate|flood|rain|cyclone|heat)\b/.test(h)) return 'Weather'
  if (/\b(startup|funding|series [abc]|unicorn)\b/.test(h)) return 'Business'
  if (shelf.includes('·')) return 'City'
  return shelf
}

function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 28 && !/^https?:/i.test(s))
}

function isUsefulSummary(text: string, headline: string) {
  const clean = text.trim()
  if (clean.length < 80) return false
  if (/<[^>]+>/.test(clean)) return false
  const h = headline.toLowerCase()
  const c = clean.toLowerCase()
  if (c === h) return false
  if (c.startsWith(h) && clean.length < headline.length + 48) return false
  if (c.includes(h) && clean.length < headline.length + 60) return false
  return true
}

function condense(texts: string[], max = 3) {
  const out: string[] = []
  const seen: string[][] = []
  for (const text of texts) {
    for (const s of sentences(text)) {
      const t = tokens(s)
      if (t.length < 5) continue
      if (seen.some(prev => jaccard(prev, t) > 0.62)) continue
      seen.push(t)
      out.push(s.replace(/\s+/g, ' '))
      if (out.length >= max) return out
    }
  }
  return out
}

function whyItMatters(story: { sources: number; shelf: string; publishers: Publisher[] }) {
  const names = story.publishers.slice(0, 3).map(p => p.name).join(', ')
  if (story.sources >= 8) {
    return `This is one of today's most widely covered stories, with ${story.sources} outlets including ${names} running it. Pulse clustered them so you get the core facts once.`
  }
  if (story.shelf.startsWith('My City') || ['Pune', 'Mumbai', 'Bengaluru', 'Chennai', 'Hyderabad', 'Delhi', 'Kolkata', 'Ahmedabad'].some(c => story.shelf.includes(c))) {
    return `Local newsrooms are moving this today. ${story.sources} ${story.sources === 1 ? 'source is' : 'sources are'} on it — useful if you live in or follow ${story.shelf.replace('My City · ', '')}.`
  }
  return `Pulse grouped ${story.sources} ${story.sources === 1 ? 'report' : 'reports'} from ${names || 'today\'s news apps'} into one short brief so you do not have to open every publisher.`
}

function parseRss(xml: string, shelf: string, publisherHint?: string): RawItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
  const items: RawItem[] = []
  for (const block of blocks) {
    const source = attrTag(block, 'source', 'url')
    const rawTitle = tag(block, 'title')
    const publisher = publisherHint || decode(source.text) || 'Unknown'
    const headline = splitHeadline(rawTitle, publisher)
    const googleLink = decode(tag(block, 'link') || tag(block, 'guid'))
    const url = articleUrl(block, googleLink)
    if (!headline || !url) continue
    if (!isAllowedSource(publisher, url)) continue
    const rawHtml = tag(block, 'content:encoded') || tag(block, 'description')
    const desc = stripHtml(rawHtml)
    const pubDate = tag(block, 'pubDate') || tag(block, 'dc:date') || tag(block, 'updated')
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    if (Number.isNaN(Date.parse(publishedAt))) continue
    items.push({
      headline,
      url,
      publisher,
      publisherUrl: url,
      summary: isUsefulSummary(desc, headline) ? desc : '',
      image: mediaUrl(block),
      publishedAt,
      shelf,
      body: htmlParagraphs(rawHtml),
    })
  }
  return items
}

async function fetchText(url: string, timeoutMs = 3200, accept = 'application/rss+xml, application/xml, text/xml, text/html, */*') {
  const ms = isGoogleNewsUrl(url) ? Math.max(timeoutMs, 5000) : timeoutMs
  const page = await fetchPage(url, ms, accept)
  return page?.html ?? null
}

async function fetchPage(url: string, timeoutMs = 3200, accept = 'text/html, */*') {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { ...FETCH_HEADERS, Accept: accept },
      redirect: 'follow',
    })
    const html = await res.text()
    if (!res.ok && html.length < 12000) return null
    return { html, url: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function decodeGoogleNewsUrl(url: string) {
  try {
    const encoded = googleNewsArticleId(url)
    if (!encoded) return ''
    const buf = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const text = buf.toString('utf8')
    const found = [...text.matchAll(/https?:\/\/[^\s\x00-\x1f"'<>]+/g)].map(m => m[0].replace(/[),.;]+$/, ''))
    return found.find(h => allowedHost(h) && !isGoogleNewsUrl(h)) || ''
  } catch {
    return ''
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++]
        await fn(item)
      }
    }),
  )
}

async function resolveGoogleNewsUrl(url: string) {
  const articleId = googleNewsArticleId(url)
  if (!articleId) return ''
  const splash = `https://news.google.com/articles/${articleId}?hl=en-IN&gl=IN&ceid=IN:en`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9000)
  let html = ''
  let finalUrl = splash
  try {
    const res = await fetch(splash, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
        Referer: 'https://news.google.com/',
      },
    })
    html = await res.text()
    finalUrl = res.url || splash
    if (res.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 900))
      const retry = await fetch(splash, {
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-IN,en;q=0.9',
          Referer: 'https://news.google.com/',
        },
      })
      html = await retry.text()
      finalUrl = retry.url || splash
      if (!retry.ok && html.length < 4000) return ''
    } else if (!res.ok && html.length < 4000) {
      return ''
    }
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
  if (finalUrl && !isGoogleNewsUrl(finalUrl) && allowedHost(finalUrl)) return finalUrl
  if (!signature || !timestamp) return ''
  const batchCtrl = new AbortController()
  const batchTimer = setTimeout(() => batchCtrl.abort(), 4500)
  try {
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: batchCtrl.signal,
      headers: {
        ...FETCH_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: 'https://news.google.com/',
      },
      body: googleNewsBatchexecuteBody(articleId, timestamp, signature),
    })
    const dest = parseGoogleNewsBatchResponse(await res.text())
    if (dest && allowedHost(dest) && !isGoogleNewsUrl(dest)) return dest
  } catch {
    return ''
  } finally {
    clearTimeout(batchTimer)
  }
  return ''
}

function publisherFallbacks(url: string) {
  return publisherAltUrls(url)
}

async function resolveArticleUrl(url: string) {
  if (!url) return url
  if (!isGoogleNewsUrl(url)) return url
  const hit = googleResolveCache.get(url)
  if (hit) return hit
  const work = (async () => {
    const decoded = decodeGoogleNewsUrl(url)
    if (decoded) return decoded
    const fromBatch = await resolveGoogleNewsUrl(url)
    return fromBatch || url
  })()
  googleResolveCache.set(url, work)
  return work
}

function applyResolvedUrl(story: Story, resolved: string) {
  if (!resolved || !isArticleUrl(resolved) || !allowedHost(resolved)) return
  if (isGoogleNewsUrl(story.url) || !isArticleUrl(story.url)) story.url = resolved
  for (const publisher of story.publishers) {
    if (isGoogleNewsUrl(publisher.url) || !isArticleUrl(publisher.url)) publisher.url = resolved
  }
}

async function resolveEditionLinks(stories: Story[]) {
  const need = stories.filter(
    story => isGoogleNewsUrl(story.url) || story.publishers.some(p => isGoogleNewsUrl(p.url)),
  )
  await mapLimit(need, 2, async story => {
    const raw =
      story.publishers.find(p => p.url && isGoogleNewsUrl(p.url))?.url ||
      (isGoogleNewsUrl(story.url) ? story.url : '')
    if (!raw) return
    const resolved = await resolveArticleUrl(raw)
    applyResolvedUrl(story, resolved)
  })
}

function keepArticleStories(stories: Story[]) {
  return stories.filter(story => {
    const pub = story.publishers.find(p => isArticleUrl(p.url))
    if (pub && !isArticleUrl(story.url)) story.url = pub.url
    return isArticleUrl(story.url)
  })
}

async function ogImage(url: string) {
  if (!url) return
  const target = isGoogleNewsUrl(url) ? await resolveArticleUrl(url) : url
  if (!target || isGoogleNewsUrl(target)) return
  const html = await fetchText(target, 2500, 'text/html')
  if (!html) return
  const match =
    html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)/i)
  const src = match?.[1]?.replace(/&amp;/g, '&')
  if (src && /^(https?:)?\/\//i.test(src)) return normalizeImage(src)
}

async function fillImages(stories: Story[]) {
  const missing = stories.filter(story => !story.image)
  const google = missing.filter(
    story => isGoogleNewsUrl(story.url) || story.publishers.some(p => isGoogleNewsUrl(p.url)),
  )
  const direct = missing.filter(story => !google.includes(story))

  await mapLimit(direct, 5, async story => {
    const url = story.publishers.find(p => p.url && !isGoogleNewsUrl(p.url))?.url || story.url
    const image = await ogImage(url)
    if (image) story.image = image
  })

  await mapLimit(google.slice(0, 6), 1, async story => {
    const url =
      story.publishers.find(p => p.url && !isGoogleNewsUrl(p.url))?.url ||
      story.publishers.find(p => p.url)?.url ||
      story.url
    const resolved = isGoogleNewsUrl(url) ? await resolveArticleUrl(url) : url
    applyResolvedUrl(story, resolved)
    const image = await ogImage(resolved)
    if (image) story.image = image
  })
}

async function backfillFromPublisherRss(stories: Story[]) {
  const need = stories.filter(
    story => !story.image && (isGoogleNewsUrl(story.url) || story.publishers.some(p => isGoogleNewsUrl(p.url))),
  )
  if (!need.length) return
  const lists = await Promise.all(
    IMAGE_FEEDS.map(async feed => {
      const xml = await fetchText(feed.url)
      return xml ? parseRss(xml, '_img', feed.publisher) : []
    }),
  )
  const pool = lists.flat()
  for (const story of need) {
    const want = publisherKey(story.publishers[0]?.name || '')
    const t = tokens(story.headline)
    let best: RawItem | undefined
    let bestScore = 0
    let bestSame = false
    for (const item of pool) {
      const same = publisherKey(item.publisher) === want
      const itemTokens = tokens(item.headline)
      const score = jaccard(t, itemTokens)
      const rare = t.filter(w => w.length >= 7 && itemTokens.includes(w)).length
      const ok = same ? score >= 0.32 : score >= 0.55 || (rare >= 2 && score >= 0.28)
      if (!ok) continue
      if (same && !bestSame) {
        best = item
        bestScore = score
        bestSame = true
        continue
      }
      if (same === bestSame && score > bestScore) {
        best = item
        bestScore = score
        bestSame = same
      }
    }
    if (!best) continue
    if (best.image) story.image = best.image
    if (bestSame && best.url && isArticleUrl(best.url) && bestScore >= 0.5) {
      story.url = best.url
      if (story.publishers[0]) story.publishers[0].url = best.url
    }
  }
}

function allowedHost(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

function metaContent(html: string, prop: string) {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'))
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))
  return (a?.[1] || b?.[1] || '').replace(/&amp;/g, '&')
}

function bodyToParagraphs(body: string): string[] {
  const split = splitArticleBody(body)
  if (split.length) return split
  return htmlParagraphs(`<p>${body}</p>`)
}

function findJsonLdBody(html: string): string[] {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const visit = (node: unknown): string[] => {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item)
        if (found.length) return found
      }
      return []
    }
    const rec = node as Record<string, unknown>
    if (typeof rec.articleBody === 'string' && rec.articleBody.length > 120) {
      return bodyToParagraphs(decode(rec.articleBody))
    }
    const kind = String(Array.isArray(rec['@type']) ? rec['@type'].join(' ') : rec['@type'] || '')
    if (/NewsArticle|Article|ReportageNewsArticle/i.test(kind) && typeof rec.text === 'string' && rec.text.length > 120) {
      return bodyToParagraphs(decode(rec.text))
    }
    if (rec['@graph']) return visit(rec['@graph'])
    return []
  }
  for (const block of blocks) {
    const raw = decode(block[1]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    try {
      const found = visit(JSON.parse(raw))
      if (found.length) return found
    } catch {
      try {
        const found = visit(JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')))
        if (found.length) return found
      } catch {
        /* ignore bad json-ld */
      }
    }
  }
  const quoted = html.match(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/)
  if (quoted?.[1]) {
    const body = decode(quoted[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'))
    if (body.length > 120) return bodyToParagraphs(body)
  }
  return []
}

function extractParagraphs(html: string): string[] {
  const fromLd = findJsonLdBody(html)
  if (fromLd.length >= 2) return cleanArticleParagraphs(fromLd)
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const articleChunk =
    (cleaned.match(/<article\b[\s\S]*?<\/article>/i) || [])[0] ||
    (cleaned.match(/<(?:div|section)[^>]*itemprop=["']articleBody["'][^>]*>[\s\S]*?<\/(?:div|section)>/i) || [])[0] ||
    cleaned
  const paras = htmlParagraphs(articleChunk)
  const picked = paras.length >= 2 ? paras : fromLd.length ? fromLd : paras
  return cleanArticleParagraphs(picked)
}

function pageToArticle(html: string) {
  return {
    title: decode(metaContent(html, 'og:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    image: normalizeImage(metaContent(html, 'og:image') || metaContent(html, 'twitter:image') || ''),
    paragraphs: extractParagraphs(html),
  }
}

async function extractArticle(url: string) {
  const empty = { title: '', image: '', paragraphs: [] as string[] }
  const seen = new Set<string>()
  const queue: string[] = []
  const add = (href?: string) => {
    if (!href) return
    let abs = href.split('#')[0]
    try {
      abs = new URL(abs, url).href
    } catch {
      return
    }
    if (seen.has(abs)) return
    if (!allowedHost(abs) && abs !== url) return
    seen.add(abs)
    queue.push(abs)
  }
  add(url)
  publisherFallbacks(url).forEach(add)

  let best = empty
  while (queue.length) {
    const batch = queue.splice(0, queue.length)
    const rows = await Promise.all(
      batch.map(async candidate => {
        const page = await fetchPage(candidate, 20000)
        if (!page) return null
        return {
          article: pageToArticle(page.html),
          amp: ampHtmlHref(page.html, page.url),
        }
      }),
    )
    for (const row of rows) {
      if (!row) continue
      if (row.article.paragraphs.length > best.paragraphs.length) {
        best = { ...row.article, image: row.article.image || best.image }
      } else if (!best.image && row.article.image) {
        best = { ...best, image: row.article.image }
      }
      add(row.amp)
    }
    if (isFullArticle(best.paragraphs)) return best
  }

  if (!isFullArticle(best.paragraphs)) {
    const page = await fetchPage(url, 25000)
    if (page) {
      const article = pageToArticle(page.html)
      if (article.paragraphs.length > best.paragraphs.length) best = article
    }
  }
  return best
}

const articleCache = new Map<string, { at: number; body: string }>()
const articleInflight = new Map<string, Promise<string>>()

function cachedArticle(url: string) {
  const hit = articleCache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body
}

async function loadArticleBody(raw: string) {
  const cached = cachedArticle(raw)
  if (cached) return cached
  const pending = articleInflight.get(raw)
  if (pending) return pending
  const work = (async () => {
    const target = isGoogleNewsUrl(raw) ? await resolveArticleUrl(raw) : raw
    if (!isArticleUrl(target) || !allowedHost(target)) {
      return JSON.stringify({ error: 'That link is not a single publisher article.', paragraphs: [] })
    }
    const ready = cachedArticle(target)
    if (ready) {
      articleCache.set(raw, { at: Date.now(), body: ready })
      return ready
    }
    const article = await extractArticle(target)
    const body = JSON.stringify(
      isFullArticle(article.paragraphs)
        ? article
        : { ...article, error: article.paragraphs.length ? undefined : 'Could not extract the full article text from the publisher page.' },
    )
    if (isFullArticle(article.paragraphs)) {
      const row = { at: Date.now(), body }
      articleCache.set(raw, row)
      articleCache.set(target, row)
    }
    return body
  })().finally(() => articleInflight.delete(raw))
  articleInflight.set(raw, work)
  return work
}

export async function handleArticle(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || ''
    const body = await loadArticleBody(raw)
    let failed = false
    try {
      const parsed = JSON.parse(body) as { error?: string; paragraphs?: string[] }
      failed = Boolean(parsed.error) && !(parsed.paragraphs?.length)
    } catch {
      failed = true
    }
    res.statusCode = failed ? 400 : 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'private, max-age=120')
    res.end(body)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Could not load article' }))
  }
}

function cluster(items: RawItem[]): Story[] {
  type Bucket = { items: RawItem[]; tokens: string[] }
  const buckets: Bucket[] = []

  const sorted = [...items].sort((a, b) => {
    const img = Number(Boolean(b.image)) - Number(Boolean(a.image))
    if (img) return img
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  })
  for (const item of sorted) {
    const t = tokens(item.headline)
    if (t.length < 2) continue
    let matched: Bucket | undefined
    for (const bucket of buckets) {
      if (jaccard(bucket.tokens, t) >= 0.42) {
        matched = bucket
        break
      }
    }
    if (matched) {
      matched.items.push(item)
      if (t.length > matched.tokens.length) matched.tokens = t
    } else {
      buckets.push({ items: [item], tokens: t })
    }
  }

  return buckets.map(bucket => {
    const primary =
      bucket.items.find(i => i.summary) ||
      bucket.items[0]
    const publishers = new Map<string, Publisher>()
    for (const item of bucket.items) {
      const key = item.publisher.toLowerCase()
      if (!publishers.has(key)) {
        publishers.set(key, { name: item.publisher, url: item.url || item.publisherUrl })
      }
    }
    const pubList = [...publishers.values()]
    const summaries = bucket.items.map(i => i.summary).filter(Boolean)
    const fromHeadlines = bucket.items
      .slice(0, 4)
      .map(i => i.headline)
      .filter((h, i, arr) => arr.findIndex(x => x === h) === i)
    const what = condense(summaries, 3)
    const whatHappened =
      what.length > 0
        ? what
        : fromHeadlines.length > 1
          ? [
              `${pubList[0]?.name || 'Newsrooms'} report: ${primary.headline}.`,
              `Other desks are framing it as ${fromHeadlines[1]}.`,
            ]
          : [`${pubList.map(p => p.name).slice(0, 3).join(', ') || 'Live coverage'} : ${primary.headline}.`]

    const summary =
      what[0] ||
      (fromHeadlines[1] ? `${primary.headline}. Also reported as: ${fromHeadlines[1]}.` : primary.headline)

    const id = Buffer.from(`${primary.headline}|${primary.shelf}`)
      .toString('base64url')
      .slice(0, 18)

    const story: Story = {
      id,
      headline: primary.headline,
      summary: summary.length > 220 ? `${summary.slice(0, 217).trim()}…` : summary,
      category: inferCategory(primary.headline, primary.shelf),
      time: relativeTime(primary.publishedAt),
      publishedAt: primary.publishedAt,
      sources: pubList.length,
      image: bucket.items.find(i => i.image)?.image,
      url: bucket.items.find(i => i.image)?.url || primary.url,
      publishers: pubList,
      whatHappened,
      whyItMatters: '',
      shelf: primary.shelf,
      body: [...bucket.items].sort((a, b) => b.body.length - a.body.length)[0]?.body || [],
    }
    story.whyItMatters = whyItMatters(story)
    return story
  })
}

function oneLine(story: Story) {
  const strip = (text: string) =>
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\b(the )?(times of india|indian express|ndtv|cnbc( tv18)?|livemint|mint|economic times|toi)\b/gi, '')
      .replace(/^\s*reports?\s*[:\-–]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  const fact = strip(story.summary || story.whatHappened[0] || '')
    .split(/(?<=[.!?])\s+/)[0]
  const headline = story.headline.replace(/\s+/g, ' ').trim().replace(/[.!?]?$/, '.')
  if (fact && fact.length > 48 && !fact.toLowerCase().includes(headline.slice(0, 24).toLowerCase())) {
    let line = fact.length > 170 ? fact.slice(0, 167).trim() : fact
    if (!/[.!?]$/.test(line)) line += '.'
    return line
  }
  return headline
}

function spokenCount(n: number) {
  if (n === 1) return 'one'
  if (n === 2) return 'two'
  return 'three'
}

function shelfBriefName(label: string) {
  return label.replace(/^My City · /, '').trim()
}

function topicIntro(name: string, count: number) {
  const n = spokenCount(Math.min(3, count))
  if (name.toLowerCase() === 'editorials') {
    return count === 1 ? 'The top editorial. Coming up.' : `The top ${n} editorials. Coming up.`
  }
  return count === 1 ? `From ${name}... the top story.` : `From ${name}... the top ${n}.`
}

function indiaHour(at = new Date()) {
  const raw = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hourCycle: 'h23',
  })
    .formatToParts(at)
    .find(part => part.type === 'hour')?.value
  return Number(raw)
}

function dayGreeting(hour = indiaHour()) {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function buildBrief(shelves: Array<{ label: string; stories: Story[] }>) {
  const used = new Set<string>()
  const hello = dayGreeting()
  const sections: BriefSection[] = [
    {
      id: 'open',
      label: `${hello}.`,
      sub: 'Today’s Pulse',
      script: `${hello}! Here's today's Pulse.`,
      dur: '0:06',
      storyIds: [],
    },
  ]

  let storyCount = 0
  for (const shelf of shelves) {
    const stories: Story[] = []
    for (const story of shelf.stories) {
      if (used.has(story.id)) continue
      used.add(story.id)
      stories.push(story)
      if (stories.length >= 3) break
    }
    if (!stories.length) continue
    storyCount += stories.length
    const name = shelfBriefName(shelf.label)
    const intro = topicIntro(name, stories.length)
    const lines = stories.map(story => oneLine(story))
    const beats = lines.map((line, i) => {
      if (lines.length === 1) return line
      if (i === 0) return `First up. ${line}`
      if (i === lines.length - 1) return `And finally. ${line}`
      return `Next. ${line}`
    })
    const script = `${intro} ${beats.join(' ')}`
    const secs = Math.max(8, Math.round((script.split(/\s+/).length / 115) * 60))
    sections.push({
      id: `shelf-${shelf.label}`,
      label: name,
      sub: intro,
      script,
      dur: `0:${String(Math.min(59, secs)).padStart(2, '0')}`,
      storyIds: stories.map(s => s.id),
    })
  }

  const allWords = sections.reduce((sum, s) => sum + s.script.split(/\s+/).length, 0)
  return {
    sections,
    storyCount,
    minutes: Math.max(1, Math.round(allWords / 115)),
    script: sections.map(s => s.script).join(' '),
  }
}

function feedsFor(locations: string[], topics: string[]) {
  const feeds: Feed[] = []
  const locSet = new Set(locations)
  const cityLike = locations.filter(l => !['India', 'World', ...Object.keys(TOPIC_FEEDS), ...['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan']].includes(l))
  const states = locations.filter(l =>
    ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan'].includes(l),
  )

  for (const city of cityLike) {
    const toi = TOI_CITY[city]
    const ie = IE_CITY[city]
    if (toi) feeds.push({ shelf: `My City · ${city}`, url: toi, publisher: 'The Times of India' })
    if (ie) feeds.push({ shelf: `My City · ${city}`, url: ie, publisher: 'The Indian Express' })
    feeds.push({ shelf: `My City · ${city}`, url: googleSearch(`${city} when:1d`) })
  }
  for (const state of states) {
    const hub = STATE_HUB[state]
    if (hub && TOI_CITY[hub]) feeds.push({ shelf: state, url: TOI_CITY[hub], publisher: 'The Times of India' })
    if (hub && IE_CITY[hub]) feeds.push({ shelf: state, url: IE_CITY[hub], publisher: 'The Indian Express' })
    if (state === 'Maharashtra') {
      feeds.push({ shelf: state, url: 'https://feeds.feedburner.com/ndtvnews-cities-news', publisher: 'NDTV' })
    }
    feeds.push({ shelf: state, url: googleSearch(`${state} when:1d`) })
  }
  if (locSet.has('India')) {
    feeds.push(...INDIA_FEEDS)
    feeds.push({ shelf: 'India', url: googleTopic('NATION') })
  }
  if (locSet.has('World')) {
    feeds.push(...WORLD_FEEDS)
    feeds.push({ shelf: 'World', url: googleTopic('WORLD') })
  }
  for (const topic of topics) {
    const pubs = TOPIC_PUBLISHER_FEEDS[topic]
    if (pubs) feeds.push(...pubs)
    const spec = TOPIC_FEEDS[topic]
    if (!spec) continue
    const url = spec.kind === 'topic' ? googleTopic(spec.value) : googleSearch(spec.value)
    feeds.push({ shelf: topic, url })
  }
  feeds.push(...EDITORIAL_FEEDS)
  return feeds
}

async function buildEdition(locations: string[], topics: string[]) {
  googleResolveCache.clear()
  const locs = locations.length ? locations : ['India', 'World']
  const feeds = feedsFor(locs, topics)
  const unique = new Map(feeds.map(f => [`${f.shelf}|${f.url}`, f]))
  const results = await Promise.allSettled(
    [...unique.values()].map(async feed => {
      const xml = await fetchText(feed.url)
      if (!xml) return [] as RawItem[]
      const parsed = parseRss(xml, feed.shelf, feed.publisher)
      const place = placeLabelFromShelf(feed.shelf)
      const googlePlaceFeed = !feed.publisher && PLACE_WORDS[place]
      const local = googlePlaceFeed ? parsed.filter(item => mentionsPlace(item, place)) : parsed
      if (feed.shelf === 'Maharashtra' && feed.publisher === 'NDTV') {
        return local.filter(item =>
          /\b(mumbai|pune|thane|nagpur|nashik|maharashtra|amravati|kolhapur|aurangabad|navi mumbai|chakan|wagholi)\b/i.test(
            `${item.headline} ${item.url}`,
          ),
        )
      }
      return local
    }),
  )

  const byShelf = new Map<string, RawItem[]>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const list = byShelf.get(item.shelf) ?? []
      list.push(item)
      byShelf.set(item.shelf, list)
    }
  }

  const seen = new Set<string>()
  const shelves: Array<{ label: string; stories: Story[] }> = []
  const order = [
    ...locs.filter(l => cityLikeLabel(l)).map(c => `My City · ${c}`),
    ...locs.filter(l => ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan'].includes(l)),
    ...['India', 'World'].filter(l => locs.includes(l)),
    'Editorials',
    ...topics,
  ]

  for (const label of order) {
    const raw = byShelf.get(label)
    if (!raw?.length) continue
    const clustered = cluster(raw)
    const unique = clustered.filter(story => {
      const key = tokens(story.headline).slice(0, 6).join(' ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const allowed = unique.filter(story =>
      story.publishers.some(p => isAllowedSource(p.name, p.url || story.url)) || isAllowedSource('', story.url),
    )
    let stories = pickStories(allowed, 12)
    if (isStateShelf(label) && stories.length < 8) {
      const named = clustered.filter(
        story =>
          mentionsStateName(story.headline, label) &&
          !stories.some(s => s.headline === story.headline) &&
          (story.publishers.some(p => isAllowedSource(p.name, p.url || story.url)) || isAllowedSource('', story.url)),
      )
      stories = pickStories([...stories, ...named], 12)
    }
    if (stories.length) shelves.push({ label, stories })
  }

  await Promise.race([
    (async () => {
      const shown = shelves.flatMap(s => s.stories)
      await resolveEditionLinks(shown)
      for (let i = shelves.length - 1; i >= 0; i--) {
        shelves[i].stories = keepArticleStories(shelves[i].stories)
        if (!shelves[i].stories.length) shelves.splice(i, 1)
      }
      const imageless = shelves.flatMap(s => s.stories.filter(story => !story.image).slice(0, 12))
      await Promise.race([
        backfillFromPublisherRss(imageless),
        new Promise<void>(resolve => setTimeout(resolve, 8000)),
      ])
      await fillImages(imageless)
    })(),
    new Promise<void>(resolve => setTimeout(resolve, 28000)),
  ])

  const highlights = [...shelves.flatMap(s => s.stories)]
    .sort((a, b) => b.sources - a.sources || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 6)

  const brief = buildBrief(shelves)
  return {
    fetchedAt: new Date().toISOString(),
    shelves,
    highlights,
    brief,
  }
}

function cityLikeLabel(l: string) {
  return ['Pune', 'Mumbai', 'Bengaluru', 'Chennai', 'Hyderabad', 'Delhi', 'Kolkata', 'Ahmedabad'].includes(l)
}

function pickStories(stories: Story[], limit = 16) {
  const pictured = stories.filter(s => s.image)
  const rest = stories.filter(s => !s.image)
  const roundRobin = (list: Story[], into: Story[]) => {
    const groups = new Map<string, Story[]>()
    for (const story of list) {
      const key = story.publishers[0]?.name || story.id
      const arr = groups.get(key) ?? []
      arr.push(story)
      groups.set(key, arr)
    }
    let added = true
    while (into.length < limit && added) {
      added = false
      for (const arr of groups.values()) {
        const next = arr.shift()
        if (!next) continue
        into.push(next)
        added = true
        if (into.length >= limit) break
      }
    }
  }
  const picked: Story[] = []
  roundRobin(pictured, picked)
  if (picked.length < limit) roundRobin(rest, picked)
  return picked
}

export async function handleNews(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const locations = (url.searchParams.get('locations') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const topics = (url.searchParams.get('topics') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const fresh = url.searchParams.get('fresh') === '1'
    const key = `${locations.join('|')}::${topics.join('|')}::${new Date().toISOString().slice(0, 10)}`
    const cacheControl = fresh
      ? 'no-store'
      : 'public, s-maxage=180, stale-while-revalidate=600'
    const hit = cache.get(key)
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', cacheControl)
      res.end(hit.body)
      return
    }
    const payload = await buildEdition(locations, topics)
    const body = JSON.stringify(payload)
    cache.set(key, { at: Date.now(), body })
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', cacheControl)
    res.end(body)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to load news' }))
  }
}

function attach(server: ViteDevServer | PreviewServer, tts?: TtsOptions) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.startsWith('/api/tts')) {
      void handleTts(req, res, tts)
      return
    }
    if (req.url?.startsWith('/api/article')) {
      void handleArticle(req, res)
      return
    }
    if (!req.url?.startsWith('/api/news')) return next()
    void handleNews(req, res)
  })
}

export function newsPlugin(tts?: TtsOptions): Plugin {
  return {
    name: 'pulse-news',
    configureServer: server => attach(server, tts),
    configurePreviewServer: server => attach(server, tts),
  }
}
