import type { NewsPayload } from '../types'
import { cleanArticleParagraphs } from './articleText'

type ArticleResult = { title?: string; image?: string; paragraphs: string[]; error?: string }

const ARTICLE_TTL = 12 * 60 * 1000
const EDITION_STORE = 'pulse-edition'
const ARTICLE_STORE = 'pulse-article:'
const EDITION_TTL = 6 * 60 * 60 * 1000
const articleCache = new Map<string, { at: number; data: ArticleResult }>()
const articleInflight = new Map<string, Promise<ArticleResult>>()
const editionInflight = new Map<string, Promise<NewsPayload>>()

function storyKey(story: { id?: string; url: string; publishers: { url: string }[] }) {
  return story.id || story.url || story.publishers[0]?.url || ''
}

function readStoredArticle(key: string): { at: number; data: ArticleResult } | null {
  try {
    const raw = sessionStorage.getItem(ARTICLE_STORE + key)
    if (!raw) return null
    const row = JSON.parse(raw) as { at: number; data: ArticleResult }
    if (!row?.data || Date.now() - row.at > ARTICLE_TTL) return null
    return row
  } catch {
    return null
  }
}

function writeStoredArticle(key: string, data: ArticleResult) {
  try {
    sessionStorage.setItem(ARTICLE_STORE + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* quota */
  }
}

export function getCachedStoryArticle(story: { id?: string; url: string; publishers: { url: string }[] }): ArticleResult | null {
  const key = storyKey(story)
  if (!key) return null
  const hit = articleCache.get(key)
  if (hit && Date.now() - hit.at < ARTICLE_TTL) {
    return { ...hit.data, paragraphs: cleanArticleParagraphs(hit.data.paragraphs || []) }
  }
  const stored = readStoredArticle(key)
  if (!stored) return null
  articleCache.set(key, stored)
  return { ...stored.data, paragraphs: cleanArticleParagraphs(stored.data.paragraphs || []) }
}

function prefsKey(locations: string[], topics: string[]) {
  return `${[...locations].sort().join('|')}::${[...topics].sort().join('|')}`
}

export function readCachedEdition(locations: string[], topics: string[]): NewsPayload | null {
  try {
    const raw = localStorage.getItem(EDITION_STORE)
    if (!raw) return null
    const row = JSON.parse(raw) as { key: string; at: number; data: NewsPayload }
    if (row.key !== prefsKey(locations, topics)) return null
    if (!row.data?.shelves?.length) return null
    if (Date.now() - row.at > EDITION_TTL) return null
    return row.data
  } catch {
    return null
  }
}

export function writeCachedEdition(locations: string[], topics: string[], data: NewsPayload) {
  try {
    localStorage.setItem(EDITION_STORE, JSON.stringify({ key: prefsKey(locations, topics), at: Date.now(), data }))
  } catch {
    /* quota */
  }
}

export async function loadEdition(
  locations: string[],
  topics: string[],
  signal?: AbortSignal,
  fresh = false,
): Promise<NewsPayload> {
  const params = new URLSearchParams({
    locations: locations.join(','),
    topics: topics.join(','),
  })
  if (fresh) params.set('fresh', '1')
  const key = `${prefsKey(locations, topics)}::${fresh ? '1' : '0'}`
  const pending = editionInflight.get(key)
  if (pending && !signal) return pending
  const work = (async () => {
    const res = await fetch(`/api/news?${params.toString()}`, {
      signal,
      cache: fresh ? 'no-store' : 'default',
    })
    if (!res.ok) {
      throw new Error('Could not load today’s edition from live news sources.')
    }
    const data = (await res.json()) as NewsPayload & { error?: string }
    if (data.error) throw new Error(data.error)
    writeCachedEdition(locations, topics, data)
    return data
  })().finally(() => {
    if (editionInflight.get(key) === work) editionInflight.delete(key)
  })
  editionInflight.set(key, work)
  return work
}

export function emptyEdition(): NewsPayload {
  return {
    fetchedAt: '',
    shelves: [],
    highlights: [],
    brief: { sections: [], storyCount: 0, minutes: 0, script: '' },
  }
}

export async function loadArticle(url: string, signal?: AbortSignal) {
  const res = await fetch(`/api/article?url=${encodeURIComponent(url)}`, { signal })
  if (!res.ok) throw new Error('Could not load the article.')
  return (await res.json()) as ArticleResult
}

async function fetchBestArticle(story: { url: string; publishers: { url: string }[] }): Promise<ArticleResult> {
  const google = /news\.google\.com/i
  const urls = [...story.publishers.map(p => p.url), story.url].filter(Boolean)
  const unique = [...new Set(urls)]
  const ordered = [...unique.filter(u => !google.test(u)), ...unique.filter(u => google.test(u))].slice(0, 3)
  if (!ordered.length) return { paragraphs: [] }

  return new Promise(resolve => {
    let pending = ordered.length
    let fallback: ArticleResult = { paragraphs: [] }
    let done = false
    const finish = (data: ArticleResult) => {
      if (done) return
      done = true
      resolve(data)
    }
    for (const url of ordered) {
      loadArticle(url)
        .then(data => {
          if ((data.paragraphs?.length || 0) >= 2) {
            finish(data)
            return
          }
          if (data.paragraphs?.length) fallback = data
          else if (data.error) fallback = { ...fallback, error: data.error }
          pending -= 1
          if (pending === 0) finish(fallback)
        })
        .catch(err => {
          fallback = { ...fallback, error: err instanceof Error ? err.message : 'Could not load the article.' }
          pending -= 1
          if (pending === 0) finish(fallback)
        })
    }
  })
}

export function prefetchStoryArticle(story: { id?: string; url: string; publishers: { url: string }[] }): Promise<ArticleResult> {
  const key = storyKey(story)
  if (!key) return Promise.resolve({ paragraphs: [] })
  const cached = getCachedStoryArticle(story)
  if (cached?.paragraphs?.length) return Promise.resolve(cached)
  const inflight = articleInflight.get(key)
  if (inflight) return inflight
  const work = fetchBestArticle(story)
    .then(data => {
      const cleaned = { ...data, paragraphs: cleanArticleParagraphs(data.paragraphs || []) }
      if (cleaned.paragraphs?.length) {
        articleCache.set(key, { at: Date.now(), data: cleaned })
        writeStoredArticle(key, cleaned)
      }
      return cleaned
    })
    .finally(() => articleInflight.delete(key))
  articleInflight.set(key, work)
  return work
}

export async function loadStoryArticle(
  story: { id?: string; url: string; publishers: { url: string }[] },
  signal?: AbortSignal,
) {
  const work = prefetchStoryArticle(story)
  if (!signal) return work
  return new Promise<ArticleResult>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      data => {
        signal.removeEventListener('abort', onAbort)
        resolve(data)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
