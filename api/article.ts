import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleArticle } from '../vite-plugin-news'

export const config = { maxDuration: 30 }

export default function handler(req: IncomingMessage, res: ServerResponse) {
  void handleArticle(req, res)
}
