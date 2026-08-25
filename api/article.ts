import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleArticle } from '../vite-plugin-news.js'

export const config = { maxDuration: 30 }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleArticle(req, res)
}
