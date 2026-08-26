import assert from 'node:assert/strict'
import test from 'node:test'
import { ampHtmlHref, isFullArticle, publisherAltUrls, splitArticleBody } from '../src/lib/articleExtract.ts'

test('NDTV uses /amp/1, never the /amp + path 404', () => {
  const url = 'https://www.ndtv.com/mumbai-news/4-700-litres-milk-destroyed-in-mumbai-food-safety-crackdown-11954293'
  const alts = publisherAltUrls(url)
  assert.deepEqual(alts, [`${url}/amp/1`])
  assert.equal(alts.some(u => u.includes('/amp/mumbai-news')), false)
})

test('NDTV AMP pages are not rewritten again', () => {
  assert.deepEqual(
    publisherAltUrls('https://www.ndtv.com/mumbai-news/foo-11954293/amp/1'),
    [],
  )
})

test('Indian Express, TOI, Mint, and CNBC get AMP variants', () => {
  assert.ok(publisherAltUrls('https://indianexpress.com/article/cities/mumbai/foo-123/')[0].includes('outputType=amp'))
  assert.ok(publisherAltUrls('https://timesofindia.indiatimes.com/city/mumbai/foo/articleshow/123.cms')[0].includes('/amp_articleshow/'))
  assert.equal(publisherAltUrls('https://www.livemint.com/news/india/foo-123.html')[0], 'https://www.livemint.com/amp/news/india/foo-123.html')
  assert.equal(publisherAltUrls('https://www.cnbctv18.com/india/foo-123.htm')[0], 'https://www.cnbctv18.com/amp/india/foo-123.htm')
})

test('amphtml link is read from the page, including relative hrefs', () => {
  const html = '<link rel="amphtml" href="/mumbai-news/foo-11954293/amp/1">'
  assert.equal(
    ampHtmlHref(html, 'https://www.ndtv.com/mumbai-news/foo-11954293'),
    'https://www.ndtv.com/mumbai-news/foo-11954293/amp/1',
  )
})

test('a one-line RSS dek is not treated as the full article', () => {
  const dek = 'Across multiple raided establishments, officials seized and destroyed 4,710 litres of adulterated and suspect milk valued at Rs 1,85,780 to protect public health.'
  assert.equal(isFullArticle([dek], dek), false)
  assert.equal(isFullArticle([dek, 'An FIR was registered at Turbhe police station on August 22.'], dek), true)
})

test('a long JSON-LD blob splits into multiple paragraphs', () => {
  const blob = 'The Food and Drug Administration (FDA) has busted a major milk adulteration racket. According to an official release, a special FDA squad raided the dairy on August 19. An FIR was registered at Turbhe police station on August 22 against 15 individuals and entities.'
  const paras = splitArticleBody(blob)
  assert.ok(paras.length >= 2)
  assert.ok(isFullArticle(paras))
})
