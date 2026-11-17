/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export async function readPdf(file: File, addPage: (blob: Blob, widthMm: number, heightMm: number, page: number, pixels: { width: number; height: number }) => void) {
  const task = getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    standardFontDataUrl: new URL('./assets/pdf-fonts/', document.baseURI).href,
    cMapUrl: new URL('./assets/pdf-cmaps/', document.baseURI).href,
    cMapPacked: true,
    wasmUrl: new URL('./assets/pdf-wasm/', document.baseURI).href,
  })
  try {
    const pdf = await task.promise
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const original = page.getViewport({ scale: 1 })
      const scale = Math.min(300 / 72, 8192 / Math.max(original.width, original.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      try {
        await page.render({ canvas, viewport }).promise
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(value => value ? resolve(value) : reject(new Error('PDF render failed')), 'image/png'),
        )
        addPage(blob, original.width * 25.4 / 72, original.height * 25.4 / 72, index,
          { width: canvas.width, height: canvas.height })
      } finally {
        page.cleanup()
        canvas.width = 0
        canvas.height = 0
      }
    }
  } finally {
    await task.destroy()
  }
}
