'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'

interface GraphZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

/** Touch-friendly zoom buttons overlaid on a graph/swarm SVG. */
export default function GraphZoomControls({ onZoomIn, onZoomOut, onFit }: GraphZoomControlsProps) {
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/90 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
      <button type="button" className={btn} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onFit}
        aria-label="Fit to view"
        title="Fit to view"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  )
}
