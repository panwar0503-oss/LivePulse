import type { ReactElement } from 'react'
import { encode } from 'uqr'

export type QrCodeProps = {
  value: string
  // Rendered width in px; omit to fill up to 12rem of the container.
  size?: number
}

// Quiet zone of 4 modules is required by the QR spec for reliable scanning.
const QUIET = 4
const LABEL = 'QR code for the join link'

function toMatrix(value: string): boolean[][] | null {
  try {
    return encode(value).data
  } catch {
    // Render a text fallback instead of crashing the room page.
    return null
  }
}

export function QrCode({ value, size }: QrCodeProps): ReactElement {
  const matrix = toMatrix(value)
  if (!matrix) {
    return (
      <p role="status" className="text-sm text-muted">
        QR code unavailable. Use the join link.
      </p>
    )
  }
  const n = matrix.length + QUIET * 2
  const rects: ReactElement[] = []
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) rects.push(<rect key={`${x}-${y}`} x={x + QUIET} y={y + QUIET} width={1} height={1} />)
    })
  })
  return (
    <svg
      role="img"
      aria-label={LABEL}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={size ? undefined : 'w-full max-w-[12rem]'}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <g fill="#000">{rects}</g>
    </svg>
  )
}
