import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleNews } from '../vite-plugin-news.js'

export const config = { maxDuration: 60 }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleNews(req, res)
}
