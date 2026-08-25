import type { NewsPayload } from '../types'
import { cleanArticleParagraphs } from './articleText'

type ArticleResult = { title?: string; image?: string; paragraphs: string[]; error?: string }

const ARTICLE_TTL = 12 * 60 * 1000
const articleCache = new Map<string, { at: number; data: ArticleResult }>()
const articleInflight = new Map<string, Promise<ArticleResult>>()

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
  const res = await fetch(`/api/news?${params.toString()}`, { signal })
  if (!res.ok) {
    throw new Error('Could not load today’s edition from live news sources.')
  }
  const data = (await res.json()) as NewsPayload & { error?: string }
  if (data.error) throw new Error(data.error)
  return data
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

function storyKey(story: { id?: string; url: string; publishers: { url: string }[] }) {
  return story.id || story.url || story.publishers[0]?.url || ''
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
  const hit = articleCache.get(key)
  if (hit && Date.now() - hit.at < ARTICLE_TTL) {
    return Promise.resolve({ ...hit.data, paragraphs: cleanArticleParagraphs(hit.data.paragraphs || []) })
  }
  const inflight = articleInflight.get(key)
  if (inflight) return inflight
  const work = fetchBestArticle(story)
    .then(data => {
      const cleaned = { ...data, paragraphs: cleanArticleParagraphs(data.paragraphs || []) }
      if (cleaned.paragraphs?.length) articleCache.set(key, { at: Date.now(), data: cleaned })
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
