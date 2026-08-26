import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleTts } from '../pulse-tts.js'

export const config = {
  maxDuration: 60,
  api: { bodyParser: false },
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleTts(req, res, {
    voice: process.env.TTS_VOICE,
  })
}
