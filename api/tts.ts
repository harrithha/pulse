import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleTts } from '../pulse-tts'

export const config = {
  maxDuration: 60,
  api: { bodyParser: false },
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  void handleTts(req, res, {
    speechifyKey: process.env.SPEECHIFY_API_KEY,
    speechifyVoice: process.env.SPEECHIFY_VOICE_ID,
  })
}
