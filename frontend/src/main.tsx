import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { distributeImages, findImageSpace, fitImageToPaper, papers, proportionalSize, spaceAtCurrentSize } from './layout'
import { CropEditor } from './crop'
import type { Crop } from './crop'
import { readPdf } from './pdfImport'
import './style.css'

type Photo = { id: string; name: string; url: string; width: number; height: number; grayscale?: boolean; keepProportions?: boolean;
  cropped?: { crop: Crop; url: string; width: number; height: number }; pdfSize?: { width: number; height: number } }
type PrintSheet = { width: number; height: number; landscape: boolean; grayscale: boolean }
type PrintBridge = {
  open_printer_settings: () => Promise<void>
  list_printers: () => Promise<string[]>
  edit_printing_preferences: (printer: string) => Promise<PrintSheet | null>
  print_sheets: (printer: string, sheets: PrintSheet[]) => Promise<string>
}
type Placement = { left: number; top: number; width: number; height: number; page: number; angle: number; exactSize?: boolean }
type Orientation = 'portrait' | 'landscape'
type Item = Placement & { id: string; photo: Photo; exactSize: boolean }
type Gesture = {
  item: Item; pointer: number; x: number; y: number; scale: number;
  resize: boolean; moved: boolean; grabLeft: number; grabTop: number;
}

function keepOnSheet(item: Placement, width: number, height: number, edge = 0): Placement {
  const fitted = fitImageToPaper(Math.max(1, item.width), Math.max(1, item.height), width - 2 * edge, height - 2 * edge)
  if (!fitted) return item
  const { width: itemWidth, height: itemHeight } = fitted
  return {
    ...item, width: itemWidth, height: itemHeight,
    left: Math.max(edge, Math.min(item.left, width - edge - itemWidth)),
    top: Math.max(edge, Math.min(item.top, height - edge - itemHeight)),
  }
}

type Unit = 'mm' | 'cm' | 'in'
const millimetersPerUnit = { mm: 1, cm: 10, in: 25.4 }
const millimetersPerImagePixel = 25.4 / 96

function displaySize(mm: number, unit: Unit) {
  return Number((mm / millimetersPerUnit[unit]).toFixed(6))
}

function NumberField({ label, value, onChange, min, max, unit, commitOnBlur = false }: {
  label: string; value: string; onChange: (value: string) => void; min: number; max: number; unit: Unit; commitOnBlur?: boolean
}) {
  const [draft, setDraft] = useState<string>()
  return <label>{label} ({unit})<input type="number"
    value={draft ?? (value === '' ? '' : displaySize(Number(value), unit))}
    min={displaySize(min, unit)} max={displaySize(max, unit)} step="any"
    onChange={event => {
      const input = event.target.value
      setDraft(input)
      if (commitOnBlur) return
      const mm = Number(input) * millimetersPerUnit[unit]
      const normalized = Number(mm.toFixed(9))
      onChange(input === '' ? '' : String(normalized))
    }}
    onBlur={() => {
      if (commitOnBlur && draft) {
        const mm = Number((Number(draft) * millimetersPerUnit[unit]).toFixed(9))
        if (mm >= min && mm <= max) onChange(String(mm))
      }
      setDraft(undefined)
    }}
    onKeyDown={event => { if (commitOnBlur && event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

function inRange(value: string, min: number, max: number) {
  return value !== '' && Number(value) >= min && Number(value) <= max
}

function App() {
  const [perSheet, setPerSheet] = useState(0)
  const [arrangeError, setArrangeError] = useState('')
  const [sheetCapacities, setSheetCapacities] = useState<Record<number, number>>({})
  const [setExactSize, setSetExactSize] = useState(false)
  const [paper, setPaper] = useState('0')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [sheetOrientations, setSheetOrientations] = useState<Record<number, Orientation>>({})
  const [sheetGrayscale, setSheetGrayscale] = useState<Record<number, boolean>>({})
  const [selectedSheet, setSelectedSheet] = useState<number>()
  const [customWidth, setCustomWidth] = useState('210')
  const [customHeight, setCustomHeight] = useState('297')
  const [unit, setUnit] = useState<Unit>('cm')
  const [photoWidth, setPhotoWidth] = useState('25.4')
  const [photoHeight, setPhotoHeight] = useState('25.4')
  const [margin, setMargin] = useState('5')
  const [gap, setGap] = useState('2')
  const [fit, setFit] = useState<'cover' | 'contain'>('contain')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [importing, setImporting] = useState(false)
  const [fileError, setFileError] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [cropping, setCropping] = useState(false)
  const [edits, setEdits] = useState<Record<string, Placement>>({})
  const [extraPages, setExtraPages] = useState(0)
  const [zoom, setZoom] = useState(100)
  const preview = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const photosRef = useRef<Photo[]>([])
  const nextPhotoId = useRef(0)
  const fileRequest = useRef(0)
  useEffect(() => {
    const pane = preview.current
    if (!pane) return
    function zoomWithWheel(event: WheelEvent) {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      setZoom(value => Math.min(250, Math.max(50, value - Math.sign(event.deltaY) * 10)))
    }
    pane.addEventListener('wheel', zoomWithWheel, { passive: false })
    return () => pane.removeEventListener('wheel', zoomWithWheel)
  }, [])
  useEffect(() => () => {
    fileRequest.current++
    new Set(photosRef.current.map(photo => photo.url)).forEach(url => URL.revokeObjectURL(url))
  }, [])

  async function openPhotos(files: FileList) {
    const request = ++fileRequest.current
    setImporting(true)
    setFileError('')
    const next: Photo[] = []
    try {
      for (const file of Array.from(files)) {
        if (/\.pdf$/i.test(file.name)) {
          await readPdf(file, (blob, width, height, page, pixels) => next.push({
            id: String(nextPhotoId.current++), name: `${file.name} · page ${page}`,
            url: URL.createObjectURL(blob), ...pixels, pdfSize: { width, height },
          }))
          continue
        }
        if (!/\.(jpg|jpeg|png)$/i.test(file.name)) throw new Error()
        const photo = { id: String(nextPhotoId.current++), name: file.name, url: URL.createObjectURL(file), width: 0, height: 0 }
        next.push(photo)
        const source = new Image()
        source.src = photo.url
        await source.decode()
        photo.width = source.naturalWidth
        photo.height = source.naturalHeight
      }
    } catch {
      next.forEach(photo => URL.revokeObjectURL(photo.url))
      if (request === fileRequest.current) setFileError('Choose a readable PDF, JPG, or PNG. Unlock password-protected PDFs before importing.')
      return
    } finally {
      if (request === fileRequest.current) setImporting(false)
    }
    if (request !== fileRequest.current) {
      next.forEach(photo => URL.revokeObjectURL(photo.url))
      return
    }
    photosRef.current = [...photosRef.current, ...next]
    setPhotos(photosRef.current)
  }

  function removePhoto(photo: Photo) {
    photosRef.current = photosRef.current.filter(item => item !== photo)
    setPhotos(photosRef.current)
    if (!photosRef.current.some(item => item.url === photo.url)) URL.revokeObjectURL(photo.url)
    if (selectedId === photo.id) setSelectedId(undefined)
    setEdits(({ [photo.id]: removed, ...others }) => others)
  }

  function duplicatePhoto(item: Item) {
    const { photo, left, top, width, height, angle, exactSize } = item
    const copy = { ...photo, id: String(nextPhotoId.current++) }
    const index = photosRef.current.indexOf(photo) + 1
    photosRef.current = [...photosRef.current.slice(0, index), copy, ...photosRef.current.slice(index)]
    setEdits(previous => ({
      ...previous,
      [item.id]: { left, top, width, height, angle, page: item.page, exactSize },
      [copy.id]: { left: -1, top: -1, width, height, angle, page: item.page, exactSize },
    }))
    setPhotos(photosRef.current)
    setSelectedId(copy.id)
  }

  const customValid = inRange(customWidth, 25, 600) && inRange(customHeight, 25, 600)
  const size = paper === 'custom'
    ? (customValid ? { width: Number(customWidth), height: Number(customHeight) } : papers[0])
    : papers[Number(paper)]
  const short = Math.min(size.width, size.height)
  const long = Math.max(size.width, size.height)
  const configuredPageCount = Math.max(1, ...[sheetCapacities, sheetOrientations, sheetGrayscale]
    .flatMap(settings => Object.keys(settings).map(page => Number(page) + 1)))
  function sheetSetting<T>(settings: Record<number, T>, page: number, fallback: T): T {
    const last = Object.keys(settings).reduce((previous, key) => {
      const index = Number(key)
      return index <= page ? Math.max(previous, index) : previous
    }, -1)
    return settings[last] ?? fallback
  }
  const capacity = (page: number) => sheetSetting(sheetCapacities, page, perSheet)
  const directionFor = (page: number) => sheetSetting(sheetOrientations, page, orientation)
  const grayscaleFor = (page: number) => sheetSetting(sheetGrayscale, page, false)
  function sheetSize(page: number) {
    return directionFor(page) === 'portrait' ? { width: short, height: long } : { width: long, height: short }
  }
  const { width, height } = sheetSize(selectedSheet ?? 0)
  const exactSize = setExactSize
  const settingsValid = (paper !== 'custom' || customValid) &&
    inRange(margin, 0, 100) && inRange(gap, 0, 100) &&
    (!exactSize || (inRange(photoWidth, 2.54, 609.6) && inRange(photoHeight, 2.54, 609.6)))
  const edge = Number(margin)
  const space = Number(gap)
  const pages: Item[][] = []
  let fits = true
  let currentPage = 0
  if (settingsValid) for (const photo of photos) {
    const edit = edits[photo.id]
    let page = edit ? edit.page : currentPage + (photo.pdfSize && pages[currentPage]?.length ? 1 : 0)
    for (;;) {
      const paper = sheetSize(page)
      const autoFitPdf = Boolean(photo.pdfSize && !edit)
      const useExactSize = edit?.exactSize ?? (exactSize && !autoFitPdf)
      const source = photo.cropped ?? photo
      const dimensions = edit ?? (useExactSize ? { width: Number(photoWidth), height: Number(photoHeight) }
        : fitImageToPaper(photo.pdfSize?.width ?? source.width * millimetersPerImagePixel,
          photo.pdfSize?.height ?? source.height * millimetersPerImagePixel,
          paper.width - 2 * edge, paper.height - 2 * edge, autoFitPdf))
      if (!dimensions || dimensions.width > paper.width - 2 * edge + 1e-7 ||
        dimensions.height > paper.height - 2 * edge + 1e-7) {
        fits = false
        break
      }
      const sheet = pages[page] ?? []
      const limit = capacity(page)
      const position = (!limit || sheet.length < limit) && (edit || !sheet.some(item => item.photo.pdfSize))
        ? (edit && edit.left >= 0 && page === edit.page
          ? keepOnSheet(edit, paper.width, paper.height, edge)
          : autoFitPdf && sheet.length === 0
            ? { left: (paper.width - dimensions.width) / 2, top: (paper.height - dimensions.height) / 2 }
            : findImageSpace(dimensions, sheet, paper, edge, space))
        : null
      if (position) {
        sheet.push({ id: photo.id, photo, page, exactSize: useExactSize, angle: edit?.angle ?? 0,
          width: dimensions.width, height: dimensions.height, left: position.left, top: position.top })
        pages[page] = sheet
        if (!edit) currentPage = page
        break
      }
      page++
    }
  }
  const automaticCount = Math.max(1, pages.length)
  const pageCount = Math.max(configuredPageCount, automaticCount, extraPages)
  for (let page = 0; page < pageCount; page++) pages[page] ??= []
  const selected = pages.flat().find(item => item.id === selectedId)
  const selectedSize = sheetSize(selected?.page ?? 0)
  const printablePages = pages.filter(sheet => sheet.length > 0)
  const canPrint = settingsValid && fits && printablePages.length > 0
  const [printBridge, setPrintBridge] = useState<PrintBridge>()
  const [printers, setPrinters] = useState<string[]>([])
  const [printer, setPrinter] = useState('')
  const [confirmPrint, setConfirmPrint] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [editingPreferences, setEditingPreferences] = useState(false)
  const [preferencesApplied, setPreferencesApplied] = useState(false)
  const [printError, setPrintError] = useState('')
  const [printStatus, setPrintStatus] = useState('')
  const printDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (confirmPrint) printDialog.current?.showModal()
  }, [confirmPrint])
  async function print() {
    if (!printBridge) return window.print()
    setPrintError('')
    setPrintStatus('')
    setPreferencesApplied(false)
    try {
      const available = await printBridge.list_printers()
      if (!available.length) throw new Error()
      setPrinters(available)
      setPrinter(current => available.includes(current) ? current : available[0])
      setConfirmPrint(true)
    } catch {
      setPrintError('No Windows printer is available. Check that your printer is installed.')
    }
  }
  async function applyPrinterPreferences() {
    if (!printBridge || !printer || printing || editingPreferences) return
    setEditingPreferences(true)
    setPrintError('')
    try {
      const settings = await printBridge.edit_printing_preferences(printer)
      if (!settings) return
      const preset = papers.findIndex(size =>
        Math.abs(size.width - settings.width) <= 0.25 && Math.abs(size.height - settings.height) <= 0.25,
      )
      if (preset === -1 && ![settings.width, settings.height].every(value => value >= 25 && value <= 600)) {
        setPrintError('The printer returned a paper size outside PrintNa’s supported range.')
        return
      }
      setPaper(preset === -1 ? 'custom' : String(preset))
      setCustomWidth(String(settings.width))
      setCustomHeight(String(settings.height))
      setOrientation(settings.landscape ? 'landscape' : 'portrait')
      setSheetOrientations({})
      setSheetGrayscale({ 0: settings.grayscale })
      setPreferencesApplied(true)
    } catch {
      setPrintError('Could not read the selected printer’s preferences.')
    } finally {
      setEditingPreferences(false)
    }
  }
  async function submitPrint() {
    if (!printBridge || !printer || printing) return
    setPrinting(true)
    setPrintError('')
    try {
      const sheets = pages.flatMap((sheet, index) => sheet.length ? [{
        width: short, height: long, landscape: directionFor(index) === 'landscape',
        grayscale: grayscaleFor(index) || sheet.every(item => item.photo.grayscale),
      }] : [])
      const error = await printBridge.print_sheets(printer, sheets)
      if (error) setPrintError(error)
      else {
        setConfirmPrint(false)
        setPrintStatus('Sent to printer.')
      }
    } catch {
      setPrintError('Windows could not submit the print job.')
    } finally {
      setPrinting(false)
    }
  }
  useEffect(() => {
    function readPrintBridge() {
      const host = window as Window & {
        pywebview?: { api?: PrintBridge }
      }
      if (host.pywebview?.api?.print_sheets) setPrintBridge(host.pywebview.api)
    }
    window.addEventListener('pywebviewready', readPrintBridge)
    readPrintBridge()
    return () => window.removeEventListener('pywebviewready', readPrintBridge)
  }, [])

  function addPage() {
    setExtraPages(pageCount + 1)
    setSelectedSheet(pageCount)
    requestAnimationFrame(() => {
      stage.current?.querySelector(`[data-sheet="${pageCount}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  const activePage = selected?.page ?? selectedSheet
  const removablePage = activePage ?? (pageCount === 1 ? 0 : undefined)
  const canRemoveSheet = fits && removablePage !== undefined && Boolean(pages[removablePage]) &&
    (pageCount > 1 || pages[removablePage].length > 0)
  const activeSheetIsGrayscale = activePage !== undefined && grayscaleFor(activePage)
  const imageLimit = activePage === undefined ? perSheet : capacity(activePage)

  function distributeOnSheet(page: number, direction: 'horizontal' | 'vertical' | 'evenly' | 'keep-size') {
    setArrangeError('')
    const placements = direction === 'keep-size'
      ? spaceAtCurrentSize(pages[page], sheetSize(page), edge, Number(gap))
      : distributeImages(pages[page], sheetSize(page), edge, direction, Number(gap))
    if (!placements.length) {
      setArrangeError('These images don’t fit at this spacing. Move some to another sheet or reduce the spacing.')
      return
    }
    setEdits(previous => ({
      ...previous,
      ...Object.fromEntries(placements.map(({ id, left, top, width, height, angle }) =>
        [id, { page, angle, left, top, width, height, exactSize: previous[id]?.exactSize }],
      )),
    }))
  }

  function spaceAllSheets() {
    const layouts = pages.map((sheet, page) => spaceAtCurrentSize(sheet, sheetSize(page), edge, Number(gap)))
    const blocked = layouts.findIndex((sheet, page) => sheet.length !== pages[page].length)
    if (blocked !== -1) {
      setArrangeError(`Sheet ${blocked + 1} doesn’t fit at the current sizes. Move some images to another sheet or reduce the spacing.`)
      return
    }
    setArrangeError('')
    setEdits(previous => ({
      ...previous,
      ...Object.fromEntries(layouts.flat().map(({ id, left, top, width, height, page, angle, exactSize }) =>
        [id, { left, top, width, height, page, angle, exactSize }],
      )),
    }))
  }

  function changeCapacity(count: number) {
    if (activePage === undefined) setPerSheet(count)
    else setSheetCapacities(previous => ({ ...previous, [activePage]: count }))
    setArrangeError('')
  }

  function changeSpacing(value: string) {
    if (value === gap) return
    setGap(value)
    if (!inRange(value, 0, 100)) return
    const placements = pages.flatMap((sheet, page) =>
      sheet.some(item => edits[item.id])
        ? spaceAtCurrentSize(sheet, sheetSize(page), edge, Number(value))
        : [],
    )
    setEdits(previous => ({
      ...previous,
      ...Object.fromEntries(placements.map(({ id, left, top, width, height, page, angle }) =>
        [id, { left, top, width, height, page, angle, exactSize: previous[id]?.exactSize }],
      )),
    }))
  }

  function removeSheet(page: number) {
    const removed = pages[page]
    if (removed.length && !window.confirm(`Remove sheet ${page + 1} and its images?`)) return
    const removeIds = new Set(removed.map(item => item.id))
    const remaining = photosRef.current.filter(photo => !removeIds.has(photo.id))
    const urls = new Set(remaining.map(photo => photo.url))
    removed.forEach(({ photo }) => {
      if (!urls.has(photo.url)) URL.revokeObjectURL(photo.url)
    })
    photosRef.current = remaining
    setPhotos(remaining)
    setSelectedId(undefined)
    setSelectedSheet(undefined)
    const reindex = <T,>(settings: Record<number, T>) => Object.fromEntries(
      Object.entries(settings).flatMap(([key, value]) => {
        const index = Number(key)
        return index === page ? [] : [[index > page ? index - 1 : index, value]]
      }),
    )
    const capacities = reindex(sheetCapacities)
    setSheetCapacities(capacities)
    setSheetOrientations(reindex(sheetOrientations))
    setSheetGrayscale(reindex(sheetGrayscale))
    setExtraPages(Math.max(1, pageCount - 1))
    setEdits(Object.fromEntries(pages.flat().filter(item => !removeIds.has(item.id)).map(item => {
      const { id, left, top, width, height, angle } = item
      return [id, { left, top, width, height, angle, exactSize: edits[id]?.exactSize, page: item.page > page ? item.page - 1 : item.page }]
    })))
  }

  function changeItem(item: Item, changes: Partial<Placement>) {
    const { left, top, width: itemWidth, height: itemHeight, page, angle } = item
    const dimensions = sheetSize(changes.page ?? page)
    const placement = { left, top, width: itemWidth, height: itemHeight, page, angle, ...changes }
    if (placement.page !== page) {
      const fitted = fitImageToPaper(placement.width, placement.height, dimensions.width, dimensions.height)
      if (fitted) {
        placement.width = fitted.width
        placement.height = fitted.height
      }
    }
    setEdits(previous => ({
      ...previous,
      [item.id]: keepOnSheet({ ...placement, exactSize: changes.exactSize ?? previous[item.id]?.exactSize }, dimensions.width, dimensions.height, edge),
    }))
  }

  function beginGesture(event: PointerEvent, item: Item, resize = false) {
    if (event.button !== 0 || !stage.current || gesture.current) return
    const sheet = event.currentTarget.closest('.sheet')
    if (!sheet) return
    event.stopPropagation()
    setSelectedId(item.id)
    stage.current.setPointerCapture(event.pointerId)
    const rect = sheet.getBoundingClientRect()
    const scale = sheetSize(item.page).width / rect.width
    gesture.current = {
      item, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      scale, resize, moved: false,
      grabLeft: (event.clientX - rect.left) * scale - item.left,
      grabTop: (event.clientY - rect.top) * scale - item.top,
    }
  }

  function dragItem(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current
    if (!drag || drag.pointer !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    const { item, scale } = drag
    if (drag.resize) {
      const { width, height } = sheetSize(item.page)
      const ratio = Math.max(0, 1 + (Math.abs(dx) >= Math.abs(dy) ? dx * scale / item.width : dy * scale / item.height))
      const bounded = Math.min(ratio, (width - item.left) / item.width, (height - item.top) / item.height)
      changeItem(item, { width: item.width * bounded, height: item.height * bounded })
      return
    }
    const sheet = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sheet]')
    const target = Number(sheet?.dataset.sheet)
    if (sheet) {
      const rect = sheet.getBoundingClientRect()
      const targetScale = sheetSize(target).width / rect.width
      changeItem(item, {
        page: target, left: (event.clientX - rect.left) * targetScale - drag.grabLeft,
        top: (event.clientY - rect.top) * targetScale - drag.grabTop,
      })
    }
  }

  function endGesture(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null
  }

  return <>
    {confirmPrint && <dialog ref={printDialog} className="crop-dialog" aria-labelledby="print-title"
      onCancel={event => { event.preventDefault(); if (!printing && !editingPreferences) setConfirmPrint(false) }}>
      <h2 id="print-title">Print {printablePages.length} {printablePages.length === 1 ? 'sheet' : 'sheets'}</h2>
      <label>Printer
        <select value={printer} disabled={printing || editingPreferences} onChange={event => {
          setPrinter(event.target.value)
          setPreferencesApplied(false)
          setPrintError('')
        }}>
          {printers.map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      <p className="hint">{paper === 'custom' ? 'Custom paper' : papers[Number(paper)].name} · 100% scale</p>
      <button className="sheet-select" type="button" disabled={printing || editingPreferences || !printer}
        onClick={applyPrinterPreferences}>{editingPreferences ? 'Opening preferences…' : 'Printing preferences'}</button>
      {preferencesApplied && <p className="hint" role="status">
        Applied to all sheets: {short} × {long} mm · {orientation} · {grayscaleFor(0) ? 'Black and white' : 'Color'}.
      </p>}
      {!canPrint && <p className="error">The layout does not fit the selected paper. Close this window to adjust it.</p>}
      {printError && <p role="alert" className="error">{printError}</p>}
      <div className="crop-actions">
        <button className="sheet-select" disabled={printing || editingPreferences} onClick={() => setConfirmPrint(false)}>Close</button>
        <button className="print-button" disabled={printing || editingPreferences || !canPrint} onClick={submitPrint}>{printing ? 'Sending…' : 'Print'}</button>
      </div>
    </dialog>}
    <style media="print">{`@page { margin: 0; }
      @page portrait-sheet { size: ${short}mm ${long}mm; }
      @page landscape-sheet { size: ${long}mm ${short}mm; }`}</style>
    <header className="topbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true"><span className="brand-paper">P</span></span><div>
        <strong>PrintNa</strong><p>Resize. Arrange. Print.</p>
      </div></div>
      <div className="print-actions">
        {printBridge && <button className="sheet-select" disabled={!canPrint || printing} onClick={async () => {
          setPrintError('')
          try {
            await printBridge.open_printer_settings()
          } catch {
            setPrintError('Windows printer settings could not open. Use Print sheet to open print preview.')
          }
        }}>Printer settings</button>}
        <button className="print-button" disabled={!canPrint} onClick={print}>{printablePages.length > 1 ? 'Print all sheets' : 'Print sheet'}</button>
      </div>
    </header>
    <main className="workspace" onKeyDown={event => {
      if (event.key !== 'Delete' || event.repeat || !selected) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      removePhoto(selected.photo)
    }}>
      <aside className="controls" aria-label="Print settings">
        <section>
          <label>Measurement unit
            <select value={unit} onChange={event => setUnit(event.target.value as Unit)}>
              <option value="cm">Centimeters (cm)</option>
              <option value="mm">Millimeters (mm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </label>
        </section>
        {selected && <section className="image-editor">
          <h2>Edit image</h2>
          <div className="choices">
            <button onClick={() => setCropping(true)}>Crop</button>
            <button onClick={() => {
              const scale = Math.min(1, selectedSize.width / selected.height, selectedSize.height / selected.width)
              const rotatedWidth = selected.height * scale
              const rotatedHeight = selected.width * scale
              changeItem(selected, {
                angle: (selected.angle + 90) % 360, width: rotatedWidth, height: rotatedHeight,
                left: selected.left + (selected.width - rotatedWidth) / 2,
                top: selected.top + (selected.height - rotatedHeight) / 2,
              })
            }}>Rotate 90°</button>
            <button onClick={() => duplicatePhoto(selected)}>Duplicate</button>
            <button onClick={() => removePhoto(selected.photo)}>Delete image</button>
          </div>
          {cropping && <CropEditor key={selected.id} url={selected.photo.url} crop={selected.photo.cropped?.crop}
            onClose={() => setCropping(false)} onApply={cropped => {
              const previous = selected.photo.cropped ?? selected.photo
              const current = cropped ?? selected.photo
              const sideways = selected.angle % 180 !== 0
              changeItem(selected, {
                width: selected.width * (sideways ? current.height / previous.height : current.width / previous.width),
                height: selected.height * (sideways ? current.width / previous.width : current.height / previous.height),
                exactSize: false,
              })
              photosRef.current = photosRef.current.map(photo => photo.id === selected.id ? { ...photo, cropped } : photo)
              setPhotos(photosRef.current)
              setCropping(false)
            }} />}
          <details className="editor-options">
            <summary>Color</summary>
          <label className="page-picker">Image color
            <select disabled={activeSheetIsGrayscale}
              value={activeSheetIsGrayscale || selected.photo.grayscale ? 'grayscale' : 'color'} onChange={event => {
              const grayscale = event.target.value === 'grayscale'
              photosRef.current = photosRef.current.map(photo =>
                photo.id === selected.id ? { ...photo, grayscale } : photo,
              )
              setPhotos(photosRef.current)
            }}>
              <option value="color">Color</option>
              <option value="grayscale">Black and white</option>
            </select>
          </label>
          {activeSheetIsGrayscale && <p className="hint">This sheet prints in black and white.</p>}
          </details>
          <details className="editor-options">
            <summary>Size and position</summary>
          <label className="size-toggle page-picker">
            <input type="checkbox" checked={selected.photo.keepProportions !== false} onChange={event => {
              const keepProportions = event.target.checked
              photosRef.current = photosRef.current.map(photo =>
                photo.id === selected.id ? { ...photo, keepProportions } : photo,
              )
              setPhotos(photosRef.current)
            }} />
            Keep proportions
          </label>
          <div className="field-row">
            {([
              ['Width', 'width'], ['Height', 'height'],
              ['Distance from left', 'left'], ['Distance from top', 'top'],
            ] as const).map(([label, field]) => <label key={field}>{label} ({unit})
              <input key={`${selected.id}:${unit}:${selected[field]}`} type="number" step="any" min={0}
                defaultValue={displaySize(selected[field], unit)}
                onBlur={event => {
                  if (event.currentTarget.value === String(displaySize(selected[field], unit))) return
                  const value = event.currentTarget.valueAsNumber * millimetersPerUnit[unit]
                  if (!Number.isFinite(value)) {
                    event.currentTarget.value = String(displaySize(selected[field], unit))
                    return
                  }
                  const changes = selected.photo.keepProportions !== false && (field === 'width' || field === 'height')
                    ? proportionalSize(selected, field, value, selectedSize)
                    : { [field]: value }
                  changeItem(selected, changes)
                  const updated = keepOnSheet({ ...selected, ...changes }, selectedSize.width, selectedSize.height, edge)
                  event.currentTarget.value = String(displaySize(updated[field], unit))
                }}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            </label>)}
          </div>
          <label className="page-picker">Move to sheet
            <select value={selected.page} onChange={event => {
              const page = Number(event.target.value)
              if (page === pageCount) addPage()
              changeItem(selected, { page })
            }}>
              {pages.map((_, index) => <option key={index} value={index}>Sheet {index + 1}</option>)}
              <option value={pageCount}>New sheet</option>
            </select>
          </label>
          <div className="choices">
            <button onClick={() => changeItem(selected, { left: (selectedSize.width - selected.width) / 2, top: (selectedSize.height - selected.height) / 2 })}>Center on sheet</button>
            <button onClick={() => changeItem(selected, { left: (selectedSize.width - selected.width) / 2 })}>Center horizontally</button>
            <button onClick={() => changeItem(selected, { top: (selectedSize.height - selected.height) / 2 })}>Center vertically</button>
            <button onClick={() => setEdits(({ [selected.id]: removed, ...others }) => others)}>Reset placement</button>
          </div>
          </details>
        </section>}
        <section>
          <h2>Images</h2>
          <label className="file-picker">
            {importing ? 'Opening files…' : photos.length ? 'Add images or PDFs' : 'Choose images or PDFs'}
            <input type="file" aria-label="Choose images or PDFs" accept=".jpg,.jpeg,.png,.pdf" multiple disabled={importing}
              onChange={event => {
                if (event.target.files?.length) void openPhotos(event.target.files)
                event.target.value = ''
              }} />
          </label>
          {fileError && <p className="error" role="alert">{fileError}</p>}
        </section>
        <section>
          <h2>Layout</h2>
          {activePage !== undefined && pages[activePage] && <details className="editor-options">
          <summary>Arrange sheet {activePage + 1}</summary>
          <label className="page-picker">
            Sheet {activePage + 1} color
            <select value={activeSheetIsGrayscale ? 'grayscale' : 'color'} onChange={event => {
              const grayscale = event.target.value === 'grayscale'
              setSheetGrayscale(previous => ({ ...previous, [activePage]: grayscale }))
            }}>
              <option value="color">Color</option>
              <option value="grayscale">Black and white</option>
            </select>
          </label>
          <div className="page-picker choices">
            <button disabled={pages[activePage].length < 2} onClick={() => distributeOnSheet(activePage, 'keep-size')}>Space evenly · Keep size</button>
            <button disabled={pages[activePage].length < 2} onClick={() => distributeOnSheet(activePage, 'evenly')}>Resize to fill sheet</button>
            <button disabled={pages[activePage].length < 2} onClick={() => distributeOnSheet(activePage, 'horizontal')}>Arrange in a row</button>
            <button disabled={pages[activePage].length < 2} onClick={() => distributeOnSheet(activePage, 'vertical')}>Stack vertically</button>
          </div></details>}
          <label className="size-toggle">
            <input type="checkbox" checked={imageLimit > 0} onChange={event => changeCapacity(event.target.checked ? 8 : 0)} />
            {activePage === undefined ? 'Limit images per sheet' : `Limit images on sheet ${activePage + 1}`}
          </label>
          {imageLimit > 0 && <label>Maximum images
            <input key={`${activePage}:${imageLimit}`}
              type="number" min={1} step={1}
              defaultValue={imageLimit}
              onBlur={event => {
                const count = event.currentTarget.valueAsNumber
                if (!Number.isSafeInteger(count) || count < 1) {
                  event.currentTarget.value = String(imageLimit)
                  return
                }
                changeCapacity(count)
              }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          </label>}
          {printablePages.length > 1 && <button className="sheet-select" onClick={spaceAllSheets}>Space all sheets · Keep size</button>}
          {arrangeError && <p className="error" role="alert">{arrangeError}</p>}
        </section>
        <section>
          <h2>Paper</h2>
          <label>Paper size<select value={paper} onChange={event => setPaper(event.target.value)}>
            {papers.map((size, index) => <option key={size.name} value={index}>{size.name}</option>)}
            <option value="custom">Custom size</option>
          </select></label>
          {paper === 'custom' && <div className="field-row">
            <NumberField key={`paper-width-${unit}`} unit={unit} label="Width" value={customWidth} onChange={setCustomWidth} min={25} max={600} />
            <NumberField key={`paper-height-${unit}`} unit={unit} label="Height" value={customHeight} onChange={setCustomHeight} min={25} max={600} />
          </div>}
          <div className="page-picker">
            <h2>{selectedSheet === undefined ? 'Default orientation' : `Sheet ${selectedSheet + 1} orientation`}</h2>
            <div className="choices" aria-label="Paper orientation">
              {(['portrait', 'landscape'] as const).map(direction => <button key={direction}
                aria-pressed={(selectedSheet === undefined ? orientation : directionFor(selectedSheet)) === direction}
                onClick={() => selectedSheet === undefined ? setOrientation(direction)
                  : setSheetOrientations(previous => ({ ...previous, [selectedSheet]: direction }))}>
                {direction === 'portrait' ? 'Portrait' : 'Landscape'}
              </button>)}
            </div>
            {selectedSheet !== undefined && <button className="sheet-select" onClick={() => setSelectedSheet(undefined)}>Back to default settings</button>}
          </div>
        </section>
        {<section>
          <h2>Printed image size</h2>
          <label className="size-toggle">
            <input type="checkbox" checked={setExactSize} onChange={event => setSetExactSize(event.target.checked)} />
            Set an exact size
          </label>
          {!exactSize && <p className="hint">Keeps the image whole and shrinks it only if needed to fit.</p>}
          {exactSize && <>
          <div className="field-row">
            <NumberField key={`image-width-${unit}`} unit={unit} label="Width" value={photoWidth} onChange={setPhotoWidth} min={2.54} max={609.6} />
            <NumberField key={`image-height-${unit}`} unit={unit} label="Height" value={photoHeight} onChange={setPhotoHeight} min={2.54} max={609.6} />
          </div>
          <div className="choices" aria-label="Image fit">
            <button aria-pressed={fit === 'cover'} onClick={() => setFit('cover')}>Crop to fit</button>
            <button aria-pressed={fit === 'contain'} onClick={() => setFit('contain')}>Show whole image</button>
          </div>
          </>}
        </section>}
        <section>
          <h2>Spacing</h2>
          <div className="field-row">
            <NumberField key={`margin-${unit}`} unit={unit} label="Paper edge" value={margin} onChange={setMargin} min={0} max={100} />
            <NumberField key={`gap-${unit}`} unit={unit} label="Between images" value={gap} onChange={changeSpacing} min={0} max={100} commitOnBlur />
          </div>
        </section>
      </aside>
      <section ref={preview} className="preview" aria-labelledby="preview-title">
        <div className="stage" ref={stage} onPointerMove={dragItem} onPointerUp={endGesture}
          onPointerCancel={endGesture} onLostPointerCapture={endGesture}>
          {pages.map((sheet, pageIndex) => {
            const { width, height } = sheetSize(pageIndex)
            return <div className="sheet-group" key={pageIndex}>
            <button className="sheet-select" aria-pressed={selectedSheet === pageIndex}
              onClick={() => { setSelectedId(undefined); setSelectedSheet(pageIndex) }}>
              Sheet {pageIndex + 1} · {directionFor(pageIndex) === 'portrait' ? 'Portrait' : 'Landscape'}
            </button>
            <div data-sheet={pageIndex}
            className={`sheet${sheet.length ? '' : ' blank-sheet'}${selectedSheet === pageIndex ? ' active-sheet' : ''}`}
            onPointerDown={() => { setSelectedId(undefined); setSelectedSheet(pageIndex) }} style={{
              '--ratio': width / height, '--sheet-max': `${Math.min(800, 650 * width / height)}px`,
              '--zoom': zoom / 100,
              '--print-width': `${width}mm`, '--print-height': `${height}mm`,
              page: `${directionFor(pageIndex)}-sheet`,
          } as CSSProperties}>
            {!sheet.length && <p className="empty">{photos.length ? `Sheet ${pageIndex + 1}` : 'Choose an image to see how it will print.'}</p>}
            {sheet.map((slot, index) => {
              return <div key={slot.id} className={slot.id === selectedId ? 'placed selected' : 'placed'}
                onPointerDown={event => {
                  if (event.button === 0) event.currentTarget.querySelector('button')?.focus({ preventScroll: true })
                  beginGesture(event, slot)
                }}
                style={{
                  left: `${slot.left / width * 100}%`, top: `${slot.top / height * 100}%`,
                  width: `${slot.width / width * 100}%`, height: `${slot.height / height * 100}%`,
                }}>
                <button className="select-image" type="button" aria-label={`Edit ${slot.photo.name}, image ${index + 1} on sheet ${pageIndex + 1}`}
                  aria-pressed={slot.id === selectedId} onClick={() => setSelectedId(slot.id)}>
                  <img src={slot.photo.cropped?.url ?? slot.photo.url} alt="" draggable={false} style={{
                    objectFit: slot.exactSize ? fit : 'contain',
                    filter: grayscaleFor(pageIndex) || slot.photo.grayscale ? 'grayscale(100%)' : undefined,
                    width: slot.angle % 180 ? `${slot.height / slot.width * 100}%` : '100%',
                    height: slot.angle % 180 ? `${slot.width / slot.height * 100}%` : '100%',
                    transform: `translate(-50%, -50%) rotate(${slot.angle}deg)`,
                  }} />
                </button>
                {slot.id === selectedId && <span className="resize-handle" aria-hidden="true"
                  onPointerDown={event => beginGesture(event, slot, true)} />}
              </div>
            })}
          </div></div>
          })}
        </div>
        <p className={printError || !settingsValid || !fits ? 'preview-note error' : 'preview-note'} role="status">
          {printError || printStatus || (!settingsValid ? 'Check the sizes and spacing you entered.'
            : !fits
              ? 'The images won’t fit. Try a larger sheet, smaller images, or less spacing.'
            : printBridge ? 'PrintNa uses the paper and layout settings shown here.'
              : 'In the print window, match the paper size and choose Actual size or 100%.')}
        </p>
        <div className="preview-header">
          <div className="preview-section preview-tools">
          <h1 id="preview-title">Paper preview</h1>
          <div className="preview-zoom" role="group" aria-label="Preview zoom">
            <button className="sheet-select" type="button" aria-label="Zoom out" disabled={zoom <= 50}
              onClick={() => setZoom(value => Math.max(50, value - 25))}>−</button>
            <button className="sheet-select" type="button" aria-label={`Zoom ${zoom} percent. Reset zoom`}
              onClick={() => setZoom(100)}>{zoom}%</button>
            <button className="sheet-select" type="button" aria-label="Zoom in" disabled={zoom >= 250}
              onClick={() => setZoom(value => Math.min(250, value + 25))}>+</button>
          </div>
          </div>
          <div className="preview-section preview-add">
            <button className="sheet-select add-page" type="button" onClick={addPage}>+ Add page</button>
            <button className="sheet-select remove-sheet" type="button" disabled={!canRemoveSheet}
              title={removablePage === undefined ? 'Select a sheet to remove it' : undefined}
              onClick={() => { if (canRemoveSheet) removeSheet(removablePage) }}>Remove sheet</button>
          </div>
          <div className="preview-section preview-size">
          <p><strong>{paper === 'custom' ? 'Custom' : papers[Number(paper)].name}</strong>
            {' · '}{displaySize(width, unit)} × {displaySize(height, unit)} {unit}
          </p>
          {canPrint && <span className="count" role="status">
            {printablePages.length > 1 ? `${printablePages.length} sheets` : `${printablePages[0].length} ${printablePages[0].length === 1 ? 'image' : 'images'} on the sheet`}
          </span>}
          </div>
        </div>
      </section>
    </main>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
