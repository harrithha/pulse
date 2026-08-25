import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleNews } from '../vite-plugin-news'

export const config = { maxDuration: 60 }

export default function handler(req: IncomingMessage, res: ServerResponse) {
  void handleNews(req, res)
}
