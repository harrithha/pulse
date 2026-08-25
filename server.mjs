import { preview } from 'vite'

const port = Number(process.env.PORT || 4173)

const server = await preview({
  preview: {
    host: true,
    port,
    strictPort: true,
    open: false,
    allowedHosts: true,
  },
})

server.printUrls()
