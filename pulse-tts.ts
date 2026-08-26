import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Communicate } from 'edge-tts-universal'

export type TtsOptions = {
  voice?: string
}

const STREAM_LIMIT = 4_000
const AUDIO_CACHE_MS = 30 * 60 * 1000
const DEFAULT_VOICE = {
  id: 'en-US-EmmaNeural',
  name: 'Emma',
}
const PROSODY = { rate: '+18%', pitch: '+2Hz', volume: '+16%' }
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

function voiceId(opts?: TtsOptions) {
  return (
    envFileValue('TTS_VOICE') ||
    opts?.voice ||
    process.env.TTS_VOICE ||
    DEFAULT_VOICE.id
  ).trim()
}

function voiceName(id: string) {
  const short = id.split('-').pop()?.replace(/Neural$/i, '') || DEFAULT_VOICE.name
  return short
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

function toPlain(parts: string[]) {
  return parts
    .map(p =>
      p
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
}

function shapeNewsSpeech(text: string) {
  let t = text.replace(/\s+/g, ' ').trim()
  t = t.replace(/\bGood (morning|afternoon|evening)\./gi, 'Good $1!')
  t = t.replace(/\bHere is today's Pulse\./gi, "Here's today's Pulse!")
  t = t.replace(/\bThe top (\w+) stories from ([^.]+?) are\./gi, 'From $2... the top $1.')
  t = t.replace(/\bThe top story from ([^.]+?) is\./gi, 'From $1... the top story.')
  t = t.replace(/\bThe top (\w+) editorials are\./gi, 'The top $1 editorials. Coming up.')
  t = t.replace(/\bThe top editorial is\./gi, 'The top editorial. Coming up.')
  t = t.replace(/\bFirst up\.\s+/gi, 'First up... ')
  t = t.replace(/\bNext\.\s+/gi, 'Next... ')
  t = t.replace(/\bAnd finally\.\s+/gi, 'And finally... ')
  t = t.replace(/\s+/g, ' ').trim()
  if (t && !/[.!?]$/.test(t)) t += '.'
  return t
}

async function edgeAudio(text: string, voice: string, prosody = PROSODY) {
  const communicate = new Communicate(text, {
    voice,
    ...prosody,
  })
  const chunks: Buffer[] = []
  for await (const chunk of communicate.stream()) {
    if (chunk.type === 'audio' && chunk.data) chunks.push(Buffer.from(chunk.data))
  }
  if (!chunks.length) throw new Error('No audio received')
  return Buffer.concat(chunks)
}

async function handleStatus(res: ServerResponse, opts?: TtsOptions) {
  const id = voiceId(opts)
  sendJson(res, 200, {
    ready: true,
    provider: 'edge',
    voice: voiceName(id),
    voiceId: id,
  })
}

async function handleSpeakParts(parts: string[], res: ServerResponse, opts?: TtsOptions) {
  const text = shapeNewsSpeech(toPlain(parts))
  if (!text) {
    sendJson(res, 400, { error: 'missing_text' })
    return
  }
  const voice = voiceId(opts)
  const cacheKey = createHash('sha1')
    .update(`${voice}\nmod-v4\n${text}`)
    .digest('hex')
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

  const pieces = splitText(text)
  const buffers: Buffer[] = []
  for (const piece of pieces) {
    buffers.push(await edgeAudio(piece, voice, PROSODY))
  }
  const buf = Buffer.concat(buffers)
  if (!buf.length) {
    sendJson(res, 502, { error: 'empty_audio' })
    return
  }
  const type = 'audio/mpeg'
  const name = voiceName(voice)
  audioCache.set(cacheKey, { at: Date.now(), buf, type, voice: name })

  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Length', String(buf.length))
  res.setHeader('Cache-Control', 'private, max-age=120')
  res.setHeader('X-Pulse-Voice', encodeURIComponent(name))
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
