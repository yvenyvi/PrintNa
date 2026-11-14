import { useEffect, useRef, useState } from 'react'

export type Crop = { left: number; top: number; right: number; bottom: number }
const fullImage: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

export function CropEditor({ url, crop, onClose, onApply }: {
  url: string; crop?: Crop; onClose: () => void;
  onApply: (result?: { crop: Crop; url: string; width: number; height: number }) => void
}) {
  const [area, setArea] = useState(crop ?? fullImage)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])

  function apply() {
    const source = image.current
    if (!source?.naturalWidth) return
    const left = Math.round(source.naturalWidth * area.left / 100)
    const top = Math.round(source.naturalHeight * area.top / 100)
    const width = Math.max(1, Math.round(source.naturalWidth * (100 - area.right) / 100) - left)
    const height = Math.max(1, Math.round(source.naturalHeight * (100 - area.bottom) / 100) - top)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(source, left, top, width, height, 0, 0, width, height)
      const url = canvas.toDataURL()
      if (url === 'data:,') throw new Error()
      onApply({ crop: area, url, width, height })
    } catch {
      setError('This crop could not be applied.')
    }
  }

  return <dialog ref={dialog} className="crop-dialog" aria-labelledby="crop-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id="crop-title">Crop image</h2>
    <p className="hint">Move the sliders to trim each edge. The shaded area will be removed.</p>
    <div className="crop-preview">
      <img ref={image} src={url} alt="Original image" />
      <span style={{ inset: `${area.top}% ${area.right}% ${area.bottom}% ${area.left}%` }} />
    </div>
    <div className="field-row">
      {(['left', 'top', 'right', 'bottom'] as const).map(edge => {
        const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
        return <label key={edge}>Trim {edge} ({area[edge]}%)
          <input type="range" min={0} max={99 - area[opposite[edge]]} value={area[edge]}
            onChange={event => setArea(previous => ({ ...previous, [edge]: event.target.valueAsNumber }))} />
        </label>
      })}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="crop-actions">
      {crop && <button className="sheet-select" onClick={() => onApply()}>Remove crop</button>}
      <button className="sheet-select" onClick={onClose}>Cancel</button>
      <button className="print-button" onClick={apply}>Apply crop</button>
    </div>
  </dialog>
}
