'use client'

import { useRef } from 'react'
import { type ScrollbarMetrics } from '@/lib/agents/zoomPan'

/** Draggable scrollbar overlay for panning a zoomable graph/swarm horizontally or vertically. */
export default function GraphScrollbar({
  orientation,
  metrics,
  onScroll,
}: {
  orientation: 'horizontal' | 'vertical'
  metrics: ScrollbarMetrics
  onScroll: (fraction: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ start: number; startOffset: number } | null>(null)

  if (!metrics.scrollable) return null

  const isHorizontal = orientation === 'horizontal'
  const maxOffset = 1 - metrics.size

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragRef.current = { start: isHorizontal ? e.clientX : e.clientY, startOffset: metrics.offset }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    const track = trackRef.current
    if (!drag || !track || maxOffset <= 0) return
    const trackSize = isHorizontal ? track.clientWidth : track.clientHeight
    if (!trackSize) return
    const pos = isHorizontal ? e.clientX : e.clientY
    const deltaFraction = (pos - drag.start) / trackSize
    const nextOffset = Math.min(maxOffset, Math.max(0, drag.startOffset + deltaFraction))
    onScroll(nextOffset / maxOffset)
  }

  function handlePointerUp(e: React.PointerEvent) {
    dragRef.current = null
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={trackRef}
      className={
        isHorizontal
          ? 'absolute bottom-1 left-1 right-4 h-2 rounded-full bg-gray-200/70 dark:bg-slate-700/60'
          : 'absolute right-1 top-1 bottom-4 w-2 rounded-full bg-gray-200/70 dark:bg-slate-700/60'
      }
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={
          'absolute rounded-full bg-gray-400/80 hover:bg-gray-500 dark:bg-slate-500/80 dark:hover:bg-slate-400 transition-colors ' +
          (isHorizontal ? 'top-0 h-2 cursor-ew-resize' : 'left-0 w-2 cursor-ns-resize')
        }
        style={
          isHorizontal
            ? { left: `${metrics.offset * 100}%`, width: `${metrics.size * 100}%` }
            : { top: `${metrics.offset * 100}%`, height: `${metrics.size * 100}%` }
        }
      />
    </div>
  )
}
