export type SpeechHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
}

export type TtsStatus = {
  ready: boolean
  provider: 'edge' | 'browser'
  voice: string | null
}

export function canSpeak() {
  return typeof window !== 'undefined' && (typeof Audio !== 'undefined' || 'speechSynthesis' in window)
}

let statusCache: { at: number; status: TtsStatus } | null = null

export async function loadTtsStatus(): Promise<TtsStatus> {
  if (statusCache && Date.now() - statusCache.at < 10 * 60 * 1000) return statusCache.status
  try {
    const res = await fetch('/api/tts')
    if (!res.ok) return { ready: false, provider: 'browser', voice: null }
    const status = (await res.json()) as TtsStatus
    statusCache = { at: Date.now(), status }
    return status
  } catch {
    return { ready: false, provider: 'browser', voice: null }
  }
}

function preferredVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const rank = (v: SpeechSynthesisVoice) => {
    const n = `${v.name} ${v.lang} ${v.voiceURI}`.toLowerCase()
    if (/\bmale\b|david|mark|ravi|daniel|george|fred|guy|ryan|james|thomas/.test(n)) return -1
    if (/\bfemale\b|zira|samantha|heera|neerja|veena|susan|hazel|fiona|karen|moira|serena|aria|siri|jenny|sara/.test(n)) return 6
    if (/google uk english female|microsoft.*(aria|jenny|sara)/.test(n)) return 5
    if (/en-in/.test(n) && /female/.test(n)) return 4
    if (/en-gb/.test(n)) return 2
    if (n.startsWith('en') || /en-/.test(n)) return 1
    return 0
  }
  return [...voices].sort((a, b) => rank(b) - rank(a))[0] || null
}

function waitForVoices(): Promise<void> {
  if (window.speechSynthesis.getVoices().length) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => {
      window.speechSynthesis.onvoiceschanged = null
      resolve()
    }
    window.speechSynthesis.onvoiceschanged = done
    window.setTimeout(done, 800)
  })
}

function splitLong(text: string, max: number) {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut < 1) cut = max
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) out.push(rest)
  return out
}

export function packScriptGroups(parts: string[], firstMax = 240, max = 520) {
  const groups: string[][] = []
  let group: string[] = []
  let len = 0
  let limit = firstMax
  const flush = () => {
    if (!group.length) return
    groups.push(group)
    group = []
    len = 0
    limit = max
  }
  for (const raw of parts) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text) continue
    for (const piece of splitLong(text, limit)) {
      if (!piece) continue
      if (group.length && len + piece.length + 8 > limit) flush()
      if (piece.length > limit) {
        for (const bit of splitLong(piece, limit)) {
          if (group.length && len + bit.length + 8 > limit) flush()
          group.push(bit)
          len += bit.length + 8
        }
      } else {
        group.push(piece)
        len += piece.length + 8
      }
    }
  }
  if (group.length) groups.push(group)
  return groups
}

const ttsCache = new Map<string, Promise<Blob | null>>()

function textsKey(texts: string[]) {
  return texts.join('\u0001')
}

async function fetchTts(texts: string[], signal: AbortSignal) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
    signal,
  })
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.size) return null
  const type = res.headers.get('content-type') || ''
  if (type.includes('json')) return null
  return blob
}

function getSpeechBlob(texts: string[], signal: AbortSignal) {
  const key = textsKey(texts)
  const hit = ttsCache.get(key)
  if (hit) return hit
  const work = fetchTts(texts, signal).then(
    blob => {
      if (!blob) ttsCache.delete(key)
      return blob
    },
    err => {
      ttsCache.delete(key)
      throw err
    },
  )
  ttsCache.set(key, work)
  return work
}

export function prefetchSpeech(texts: string[]) {
  const packed = texts.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!packed.length) return
  void getSpeechBlob(packed, new AbortController().signal)
}

const SILENCE_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

function unlockAudio(audio: HTMLAudioElement) {
  audio.muted = true
  audio.src = SILENCE_WAV
  audio.volume = 1
  audio.playbackRate = 1
  void audio.play().catch(() => undefined)
}

function playBlob(blob: Blob, audio: HTMLAudioElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const cleanup = () => {
      audio.onended = null
      audio.onerror = null
      URL.revokeObjectURL(url)
    }
    if (signal.aborted) {
      cleanup()
      resolve()
      return
    }
    audio.onended = () => {
      cleanup()
      resolve()
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('Could not play audio'))
    }
    audio.src = url
    audio.muted = false
    audio.playbackRate = 1
    void audio.play().catch(err => {
      cleanup()
      reject(err)
    })
  })
}

function speakBrowser(
  sections: Array<{ script: string }>,
  startIndex: number,
  rate: number,
  onIndex: (i: number) => void,
  onEnd: () => void,
): SpeechHandle {
  const synth = window.speechSynthesis
  synth.cancel()

  let stopped = false
  let index = startIndex

  const speakNext = () => {
    if (stopped || index >= sections.length) {
      if (!stopped) onEnd()
      return
    }
    onIndex(index)
    const utter = new SpeechSynthesisUtterance(sections[index].script)
    const voice = preferredVoice()
    if (voice) utter.voice = voice
    utter.lang = voice?.lang || 'en-IN'
    utter.rate = Math.min(1.15, Math.max(0.9, rate || 1.05))
    utter.pitch = 1.05
    utter.volume = 1
    utter.onend = () => {
      if (stopped) return
      index += 1
      window.setTimeout(speakNext, index === 1 ? 280 : 160)
    }
    utter.onerror = () => {
      if (stopped) return
      index += 1
      speakNext()
    }
    synth.speak(utter)
  }

  void waitForVoices().then(() => {
    if (!stopped) speakNext()
  })

  return {
    stop() {
      stopped = true
      synth.cancel()
    },
    pause() {
      synth.pause()
    },
    resume() {
      synth.resume()
    },
  }
}

export function speakSections(
  sections: Array<{ script: string }>,
  startIndex: number,
  rate: number,
  onIndex: (i: number) => void,
  onEnd: () => void,
): SpeechHandle {
  const audio = typeof Audio !== 'undefined' ? new Audio() : null
  const ctrl = new AbortController()
  let stopped = false
  let browser: SpeechHandle | null = null
  if (audio) unlockAudio(audio)

  const finish = () => {
    if (stopped) return
    stopped = true
    onEnd()
  }

  const run = async () => {
    const remaining = sections.slice(startIndex).map(s => s.script)
    const packed = packScriptGroups(remaining)
    if (!packed.length || !audio) {
      finish()
      return
    }

    try {
      onIndex(startIndex)
      let next = packed.length > 1 ? getSpeechBlob(packed[1], ctrl.signal) : null
      const first = await getSpeechBlob(packed[0], ctrl.signal)
      if (!first) {
        browser = speakBrowser(sections, startIndex, rate, onIndex, finish)
        return
      }
      await playBlob(first, audio, ctrl.signal)
      for (let i = 1; i < packed.length; i++) {
        if (stopped) return
        let blob = await next
        if (!blob && !stopped) blob = await getSpeechBlob(packed[i], ctrl.signal)
        if (!blob) {
          finish()
          return
        }
        next = i + 1 < packed.length ? getSpeechBlob(packed[i + 1], ctrl.signal) : null
        onIndex(startIndex + i)
        await playBlob(blob, audio, ctrl.signal)
      }
      finish()
    } catch (err) {
      if (stopped || (err as Error).name === 'AbortError') return
      finish()
    }
  }

  void run()

  return {
    stop() {
      stopped = true
      ctrl.abort()
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      browser?.stop()
    },
    pause() {
      audio?.pause()
      browser?.pause()
    },
    resume() {
      void audio?.play()
      browser?.resume()
    },
  }
}
