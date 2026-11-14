export const papers = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
  { name: 'Folio (8.5 × 13 in)', width: 215.9, height: 330.2 },
  { name: '4 × 6 in photo', width: 101.6, height: 152.4 },
  { name: '5 × 7 in photo', width: 127, height: 177.8 },
  { name: 'A3', width: 297, height: 420 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'A6', width: 105, height: 148 },
  { name: 'B4 (JIS)', width: 257, height: 364 },
  { name: 'B5 (JIS)', width: 182, height: 257 },
  { name: 'B6 (JIS)', width: 128, height: 182 },
  { name: 'Half Letter', width: 139.7, height: 215.9 },
  { name: 'Executive', width: 184.15, height: 266.7 },
  { name: 'Tabloid (11 × 17 in)', width: 279.4, height: 431.8 },
  { name: '3.5 × 5 in photo', width: 88.9, height: 127 },
  { name: '8 × 10 in photo', width: 203.2, height: 254 },
  { name: '11 × 14 in photo', width: 279.4, height: 355.6 },
  { name: '13 × 19 in photo', width: 330.2, height: 482.6 },
]

export function groupBySheet<T>(images: T[], capacity: (page: number) => number): T[][] {
  const sheets: T[][] = []
  let offset = 0
  while (offset < images.length) {
    const end = offset + capacity(sheets.length)
    sheets.push(images.slice(offset, end))
    offset = end
  }
  return sheets
}

export function fitImageToPaper(width: number, height: number, availableWidth: number, availableHeight: number) {
  if (width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0) return null

  const scale = Math.min(1, availableWidth / width, availableHeight / height)
  return { width: width * scale, height: height * scale, scaledDown: scale < 1 }
}

export function proportionalSize(
  image: { width: number; height: number },
  axis: 'width' | 'height',
  value: number,
  paper: { width: number; height: number },
) {
  const minScale = Math.max(1 / image.width, 1 / image.height)
  const maxScale = Math.min(paper.width / image.width, paper.height / image.height)
  const scale = Math.min(maxScale, Math.max(minScale, value / image[axis]))
  return { width: image.width * scale, height: image.height * scale }
}

export function spaceAtCurrentSize<T extends { width: number; height: number }>(
  images: T[], paper: { width: number; height: number }, margin: number, gap: number,
) {
  if (!images.length) return []
  const width = paper.width - 2 * margin
  const height = paper.height - 2 * margin
  const widest = Math.max(...images.map(image => image.width))
  const tallest = Math.max(...images.map(image => image.height))
  const maxColumns = Math.floor((width + gap) / (widest + gap) + 1e-9)
  const maxRows = Math.floor((height + gap) / (tallest + gap) + 1e-9)
  if (maxColumns < 1 || maxRows < 1 || images.length > maxColumns * maxRows) return []
  const columns = Math.min(maxColumns, Math.max(Math.ceil(images.length / maxRows),
    Math.round(Math.sqrt(images.length * width * tallest / (height * widest)))))
  const rows = Math.ceil(images.length / columns)
  const verticalGap = rows > 1 ? (height - rows * tallest) / (rows + 1) : (height - tallest) / 2
  return images.map((image, index) => {
    const row = Math.floor(index / columns)
    const count = Math.min(columns, images.length - row * columns)
    const horizontalGap = count > 1 ? (width - count * widest) / (count + 1) : (width - widest) / 2
    return {
      ...image,
      left: margin + horizontalGap + (index % columns) * (widest + horizontalGap) + (widest - image.width) / 2,
      top: margin + verticalGap + row * (tallest + verticalGap) + (tallest - image.height) / 2,
    }
  })
}

export function distributeImages<T extends { left: number; top: number; width: number; height: number }>(
  images: T[], paper: { width: number; height: number }, margin: number,
  direction: 'horizontal' | 'vertical' | 'evenly', spacing = 2,
) {
  if (direction === 'evenly') {
    const availableWidth = paper.width - 2 * margin
    const availableHeight = paper.height - 2 * margin
    if (images.length < 2 || availableWidth <= 0 || availableHeight <= 0) return []

    const gutter = spacing
    let best: T[] = []
    let bestArea = 0
    for (let columns = 1; columns <= images.length; columns++) {
      const rows = Math.ceil(images.length / columns)
      const cellWidth = (availableWidth - (columns - 1) * gutter) / columns
      const cellHeight = (availableHeight - (rows - 1) * gutter) / rows
      if (cellWidth <= 0 || cellHeight <= 0) continue
      let area = 0
      const placements = images.map((image, index) => {
        const row = Math.floor(index / columns)
        const imagesInRow = Math.min(columns, images.length - row * columns)
        const rowWidth = imagesInRow * cellWidth + (imagesInRow - 1) * gutter
        const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
        const width = image.width * scale
        const height = image.height * scale
        area += width * height
        return {
          ...image, width, height,
          left: (paper.width - rowWidth) / 2 + (index % columns) * (cellWidth + gutter) + (cellWidth - width) / 2,
          top: margin + row * (cellHeight + gutter) + (cellHeight - height) / 2,
        }
      })
      if (area > bestArea) {
        bestArea = area
        best = placements
      }
    }
    return best
  }

  const horizontal = direction === 'horizontal'
  const length = horizontal ? 'width' : 'height'
  const crossLength = horizontal ? 'height' : 'width'
  const position = horizontal ? 'left' : 'top'
  const available = paper[length] - 2 * margin
  const crossAvailable = paper[crossLength] - 2 * margin
  if (images.length < 2 || available <= 0 || crossAvailable <= 0) return []

  const total = images.reduce((sum, image) => sum + image[length], 0)
  const tallest = Math.max(...images.map(image => image[crossLength]))
  const scale = Math.min(1, available / total, crossAvailable / tallest)
  const gap = Math.max(0, available - total * scale) / (images.length + 1)
  let cursor = margin + gap
  return [...images].sort((a, b) => a[position] + a[length] / 2 - b[position] - b[length] / 2)
    .map(image => {
      const width = image.width * scale
      const height = image.height * scale
      const left = horizontal ? cursor : (paper.width - width) / 2
      const top = horizontal ? (paper.height - height) / 2 : cursor
      cursor += image[length] * scale + gap
      return { ...image, width, height, left, top }
    })
}

