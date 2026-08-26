import assert from 'node:assert/strict'
import test from 'node:test'
import {
  googleNewsArticleId,
  googleNewsBatchexecuteBody,
  isGoogleNewsUrl,
  parseGoogleNewsBatchResponse,
} from '../src/lib/googleNews.ts'

test('google article id ignores rss prefix and query string', () => {
  const id = 'CBMizAFBVV95cUxOS29vaWU5NDczNUE5'
  assert.equal(
    googleNewsArticleId(`https://news.google.com/rss/articles/${id}?oc=5`),
    id,
  )
  assert.equal(googleNewsArticleId(`https://news.google.com/articles/${id}`), id)
  assert.equal(googleNewsArticleId('https://www.ndtv.com/india-news/foo-1'), '')
})

test('parseGoogleNewsBatchResponse reads garturlres', () => {
  const dest = 'https://www.ndtv.com/video/parandur-airport-row-1148117'
  const body = `)]}'
[["wrb.fr","Fbv4je",${JSON.stringify(JSON.stringify(['garturlres', dest, 1]))},null,null,null,"generic"],["di",13]]`
  assert.equal(parseGoogleNewsBatchResponse(body), dest)
})

test('batchexecute body carries article id and signature', () => {
  const body = googleNewsBatchexecuteBody('CBMiabc', '1787740006', 'Ae5Wzi_sig')
  assert.ok(body.includes('f.req='))
  assert.ok(decodeURIComponent(body).includes('CBMiabc'))
  assert.ok(decodeURIComponent(body).includes('Ae5Wzi_sig'))
  assert.ok(decodeURIComponent(body).includes('Fbv4je'))
})

test('isGoogleNewsUrl', () => {
  assert.equal(isGoogleNewsUrl('https://news.google.com/rss/articles/CBMiabc'), true)
  assert.equal(isGoogleNewsUrl('https://timesofindia.indiatimes.com/city/chennai/foo'), false)
})
