import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type TtsOptions = {
  speechifyKey?: string
  speechifyVoice?: string
}

type VoiceRow = {
  id?: string
  name?: string
  display_name?: string
  displayName?: string
  gender?: string
}

type VoicePick = { id: string; name: string }

const SPEECHIFY = 'https://api.speechify.ai'
const STREAM_LIMIT = 18_000
const FALLBACK: VoicePick = { id: 'geffen_32', name: 'Geffen' }
const VOICE_CACHE_MS = 30 * 60 * 1000
const AUDIO_CACHE_MS = 30 * 60 * 1000
let voiceCache: { at: number; pick: VoicePick } | null = null
const audioCache = new Map<string, { at: number; buf: Buffer; type: string; voice: string }>()

function envFileValue(name: string) {
  try {
    const file = path.resolve(process.cwd(), '.env')
    if (!existsSync(file)) return ''
    const match = readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    return (match?.[1] || '').trim().replace(/^['"]|['"]$/g, '')
  } catch {
    return ''
  }
}

function apiKey(opts?: TtsOptions) {
  return (opts?.speechifyKey || process.env.SPEECHIFY_API_KEY || envFileValue('SPEECHIFY_API_KEY')).trim()
}

function preferredVoiceId(opts?: TtsOptions) {
  return (envFileValue('SPEECHIFY_VOICE_ID') || process.env.SPEECHIFY_VOICE_ID || opts?.speechifyVoice || '').trim()
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 400_000) {
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function asVoices(data: unknown): VoiceRow[] {
  if (Array.isArray(data)) return data as VoiceRow[]
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    if (Array.isArray(rec.voices)) return rec.voices as VoiceRow[]
    if (Array.isArray(rec.data)) return rec.data as VoiceRow[]
  }
  return []
}

function voiceLabel(v: VoiceRow) {
  return `${v.id || ''} ${v.display_name || ''} ${v.displayName || ''} ${v.name || ''}`
}

function nameOf(v: VoiceRow, fallback: string) {
  return v.display_name || v.displayName || v.name || fallback
}

async function listVoices(key: string): Promise<VoiceRow[]> {
  const out: VoiceRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < 8; page++) {
    const url = new URL(`${SPEECHIFY}/v1/voices`)
    url.searchParams.set('locale', 'en')
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) break
    const data = (await res.json()) as { has_more?: boolean; next_cursor?: string }
    out.push(...asVoices(data))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return out
}

function pickVoice(_voices: VoiceRow[], _preferId?: string): VoicePick {
  return FALLBACK
}

async function resolveVoice(_opts?: TtsOptions): Promise<VoicePick> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS && voiceCache.pick.id === FALLBACK.id) {
    return voiceCache.pick
  }
  const pick = FALLBACK
  voiceCache = { at: Date.now(), pick }
  return pick
}

function escapeSsml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapSsml(parts: string[]) {
  const inner = parts
    .map(p => p.trim())
    .filter(Boolean)
    .map(part => {
      const sentences = part.split(/(?<=[.!?])\s+/).filter(Boolean)
      const spoken = sentences
        .map((sentence, si) => {
          const pitch = 16 + (si % 2 === 0 ? 4 : -4)
          const text = escapeSsml(sentence)
          const marked = si === 0 ? `<emphasis level="strong">${text}</emphasis>` : `<emphasis level="moderate">${text}</emphasis>`
          return `<prosody rate="20%" pitch="+${pitch}%" volume="loud">${marked}</prosody>`
        })
        .join('<break time="60ms"/>')
      return `<speechify:style emotion="energetic">${spoken}</speechify:style>`
    })
    .join('<break time="90ms"/>')
  return `<speak>${inner}</speak>`
}

function toInput(parts: string[]) {
  const ssml = wrapSsml(parts)
  if (ssml.length <= 19_000) return ssml
  return parts.map(p => p.trim()).filter(Boolean).join('\n\n').slice(0, 18_000)
}

function splitText(text: string): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return []
  if (trimmed.length <= STREAM_LIMIT) return [trimmed]
  const parts: string[] = []
  let rest = trimmed
  while (rest.length > STREAM_LIMIT) {
    let cut = rest.lastIndexOf('. ', STREAM_LIMIT)
    if (cut < STREAM_LIMIT * 0.5) cut = rest.lastIndexOf(' ', STREAM_LIMIT)
    if (cut < 1) cut = STREAM_LIMIT
    parts.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function speechifyAudio(key: string, voice: VoicePick, input: string) {
  const tryOnce = (body: string, model: 'simba-3.2' | 'simba-3.0') =>
    fetch(`${SPEECHIFY}/v1/audio/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        input: body,
        voice_id: voice.id,
        audio_format: 'mp3',
        model,
      }),
    })

  const first = await tryOnce(input, 'simba-3.2')
  if (first.ok) return first
  const plain = input.includes('<speak>')
    ? input
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : ''
  if (plain) {
    const second = await tryOnce(plain, 'simba-3.2')
    if (second.ok) return second
  }
  const last = await tryOnce(plain || input, 'simba-3.0')
  if (last.ok) return last
  throw new Error((await first.text().catch(() => first.statusText)).slice(0, 400) || 'Speechify request failed')
}

async function handleStatus(res: ServerResponse, opts?: TtsOptions) {
  const key = apiKey(opts)
  if (!key) {
    sendJson(res, 200, {
      ready: false,
      provider: 'browser',
      voice: null,
      gwyneth: false,
    })
    return
  }
  try {
    const voice = await resolveVoice(opts)
    sendJson(res, 200, {
      ready: true,
      provider: 'speechify',
      voice: voice.name,
      voiceId: voice.id,
      gwyneth: /gwyneth/i.test(`${voice.name} ${voice.id}`),
    })
  } catch {
    sendJson(res, 200, {
      ready: false,
      provider: 'browser',
      voice: null,
      gwyneth: false,
    })
  }
}

async function handleSpeakParts(parts: string[], res: ServerResponse, opts?: TtsOptions) {
  const key = apiKey(opts)
  if (!key) {
    sendJson(res, 503, { error: 'missing_key' })
    return
  }
  if (!parts.length) {
    sendJson(res, 400, { error: 'missing_text' })
    return
  }

  const input = toInput(parts)
  if (input.length > 20_000) {
    sendJson(res, 413, { error: 'text_too_long' })
    return
  }

  const voice = await resolveVoice(opts)
  const cacheKey = createHash('sha1').update(`${voice.id}\n${input}`).digest('hex')
  const cached = audioCache.get(cacheKey)
  if (cached && Date.now() - cached.at < AUDIO_CACHE_MS) {
    res.statusCode = 200
    res.setHeader('Content-Type', cached.type)
    res.setHeader('Content-Length', String(cached.buf.length))
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('X-Pulse-Voice', encodeURIComponent(cached.voice))
    res.end(cached.buf)
    return
  }

  const upstream = await speechifyAudio(key, voice, input)
  const buf = Buffer.from(await upstream.arrayBuffer())
  if (!buf.length) {
    sendJson(res, 502, { error: 'empty_audio' })
    return
  }
  const type = upstream.headers.get('content-type') || 'audio/mpeg'
  audioCache.set(cacheKey, { at: Date.now(), buf, type, voice: voice.name })

  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Length', String(buf.length))
  res.setHeader('Cache-Control', 'private, max-age=120')
  res.setHeader('X-Pulse-Voice', encodeURIComponent(voice.name))
  res.end(buf)
}

async function handleSpeak(req: IncomingMessage, res: ServerResponse, opts?: TtsOptions) {
  const body = await readJson(req)
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : []
  const single = typeof body.text === 'string' ? body.text.trim() : ''
  const parts = texts.length ? texts : splitText(single)
  await handleSpeakParts(parts, res, opts)
}

export async function handleTts(req: IncomingMessage, res: ServerResponse, opts?: TtsOptions) {
  try {
    if (req.method === 'GET') {
      const speak = new URL(req.url || '/', 'http://localhost').searchParams.get('speak')
      if (speak?.trim()) {
        await handleSpeakParts(splitText(speak), res, opts)
        return
      }
      await handleStatus(res, opts)
      return
    }
    if (req.method === 'POST') {
      await handleSpeak(req, res, opts)
      return
    }
    res.statusCode = 405
    res.end()
  } catch (err) {
    sendJson(res, 502, {
      error: 'tts_failed',
      detail: err instanceof Error ? err.message : 'Could not synthesize speech',
    })
  }
}
