import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { newsPlugin } from './vite-plugin-news'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      newsPlugin({
        speechifyKey: env.SPEECHIFY_API_KEY || process.env.SPEECHIFY_API_KEY,
        speechifyVoice: env.SPEECHIFY_VOICE_ID || process.env.SPEECHIFY_VOICE_ID,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
