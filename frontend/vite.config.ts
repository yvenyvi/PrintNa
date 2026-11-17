import { defineConfig } from 'vite'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [{
    name: 'local-pdf-resources',
    configureServer(server) {
      server.middlewares.use('/assets', (request, response, next) => {
        const match = request.url?.match(/^\/pdf-(fonts|cmaps|wasm)\/([\w.-]+)$/)
        if (!match) return next()
        const requestPath = request.url
        request.url = `/node_modules/pdfjs-dist/${directories[match[1]]}/${match[2]}`
        next()
        request.url = requestPath
      })
    },
    closeBundle() {
      for (const [name, source] of Object.entries(directories)) {
        cpSync(resolve('node_modules/pdfjs-dist', source), resolve('dist/assets', `pdf-${name}`), { recursive: true })
      }
    },
  }],
})

const directories: Record<string, string> = { fonts: 'standard_fonts', cmaps: 'cmaps', wasm: 'wasm' }
