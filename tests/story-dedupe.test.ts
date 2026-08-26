import assert from 'node:assert/strict'
import test from 'node:test'
import { headlineDedupeKey, urlDedupeKey } from '../src/lib/storyDedupe.ts'

test('same story from city and state rows share a headline key', () => {
  const a = headlineDedupeKey('Tamil Nadu VB-G RAM G Wage Hike Fails to Reach Rural Workers')
  const b = headlineDedupeKey('Tamil Nadu VB-G RAM G Wage Hike Fails to Reach Rural Workers')
  assert.equal(a, b)
  assert.ok(a.includes('tamil'))
})

test('publisher article paths de-dupe; Google News URLs do not', () => {
  const toi =
    'https://timesofindia.indiatimes.com/city/chennai/tamil-nadu-vb-g-ram-g-wage-hike-fails-to-reach-rural-workers/articleshow/133522429.cms?from=rss'
  assert.equal(
    urlDedupeKey(toi),
    'timesofindia.indiatimes.com/city/chennai/tamil-nadu-vb-g-ram-g-wage-hike-fails-to-reach-rural-workers/articleshow/133522429.cms',
  )
  assert.equal(urlDedupeKey('https://news.google.com/rss/articles/CBMiabc'), '')
})
