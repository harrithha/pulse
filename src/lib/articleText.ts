export function isJunkParagraph(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (/you can also check/i.test(t)) return true
  if (/^\s*also (check|read|see)\b/i.test(t)) return true
  if (/^\(?\s*function\b/.test(t)) return true
  if (/\bvdo\.ai\b|googletag|fbq\(|gtag\(/.test(t)) return true
  if ((t.match(/\|/g) || []).length >= 3) return true
  const widgets = (t.match(/\b(gold rate|silver rate|bank holidays?|public holidays?|petrol price|diesel price|cng price|lpg price|\baqi\b|weather in )\b/gi) || []).length
  if (widgets >= 2) return true
  if (/^(trending|related|more from|read more|top stories|visual stories)\b/i.test(t)) return true
  return false
}

export function cleanArticleParagraphs(paras: string[]) {
  const out: string[] = []
  for (const raw of paras) {
    const cut = raw.split(/you can also check\s*:?/i)[0]
    const t = cut.replace(/\s+/g, ' ').replace(/[|\s]+$/g, '').trim()
    if (t.length < 55 || isJunkParagraph(t)) continue
    if (!out.some(u => u.slice(0, 80) === t.slice(0, 80))) out.push(t)
  }
  return out
}
