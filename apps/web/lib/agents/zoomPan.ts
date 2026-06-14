'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Transform {
  scale: number
  tx: number
  ty: number
}

export interface ContentSize {
  width: number
  height: number
}

const MIN_SCALE = 0.2
const MAX_SCALE = 5
const WHEEL_STEP = 1.12
const BUTTON_STEP = 1.3
const FIT_PADDING = 40
const PAN_THRESHOLD = 4 // px of movement before a gesture counts as a pan

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Clamp pan offsets so the content can never be scrolled fully out of the
 * viewport: when the (scaled) content is smaller than the viewport on an
 * axis it is centred on that axis, otherwise the offset is bounded so the
 * content edges never move past the viewport edges.
 */
function clampPan(
  tx: number,
  ty: number,
  content: ContentSize,
  viewport: ContentSize,
  scale: number,
): { tx: number; ty: number } {
  const scaledWidth = content.width * scale
  const scaledHeight = content.height * scale

  const nx =
    scaledWidth <= viewport.width
      ? (viewport.width - scaledWidth) / 2
      : Math.min(0, Math.max(viewport.width - scaledWidth, tx))

  const ny =
    scaledHeight <= viewport.height
      ? (viewport.height - scaledHeight) / 2
      : Math.min(0, Math.max(viewport.height - scaledHeight, ty))

  return { tx: nx, ty: ny }
}

export interface ScrollbarMetrics {
  /** Thumb size as a fraction of the track (0-1). 1 means no scrolling needed. */
  size: number
  /** Thumb start position as a fraction of the track (0-1). */
  offset: number
  /** Whether this axis can be scrolled at all. */
  scrollable: boolean
}

export interface ZoomPanApi {
  svgRef: React.RefObject<SVGSVGElement>
  transform: Transform
  viewportSize: ContentSize
  isPanning: boolean
  /** True when the last gesture moved far enough to count as a drag (suppress clicks). */
  didPanRef: React.RefObject<boolean>
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  zoomBy: (factor: number) => void
  zoomIn: () => void
  zoomOut: () => void
  fitToView: () => void
  /** Scroll metrics for rendering custom horizontal/vertical scrollbars. */
  horizontalScrollbar: ScrollbarMetrics
  verticalScrollbar: ScrollbarMetrics
  /** Set the horizontal scroll position from a scrollbar drag (0-1 fraction of scroll range). */
  setHorizontalScroll: (fraction: number) => void
  /** Set the vertical scroll position from a scrollbar drag (0-1 fraction of scroll range). */
  setVerticalScroll: (fraction: number) => void
}

/**
 * Stateless SVG zoom/pan via a `<g transform>` matrix. Handles mouse wheel
 * panning (horizontal scroll/swipe pans left-right, ctrl/cmd+wheel zooms,
 * anchored at the cursor), pointer drag pan, two-pointer pinch zoom for
 * touch, and "fit to view". The content is always clamped so it can't be
 * scrolled out of the viewport, and is centred when it's smaller than the
 * viewport. Crisp at any zoom level since nothing re-rasterises.
 */
export function useZoomPan(content: ContentSize): ZoomPanApi {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [viewportSize, setViewportSize] = useState<ContentSize>({ width: 0, height: 0 })

  const transformRef = useRef(transform)
  transformRef.current = transform

  const viewport = useRef<ContentSize>({ width: 0, height: 0 })
  const didPanRef = useRef(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panOrigin = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)

  const contentRef = useRef(content)
  contentRef.current = content

  const fitToView = useCallback(() => {
    const vp = viewport.current
    const c = contentRef.current
    if (!vp.width || !vp.height || !c.width || !c.height) return
    const scale = clampScale(
      Math.min(
        (vp.width - FIT_PADDING * 2) / c.width,
        (vp.height - FIT_PADDING * 2) / c.height,
        1, // never upscale beyond natural size on fit
      ),
    )
    setTransform({
      scale,
      tx: (vp.width - c.width * scale) / 2,
      ty: (vp.height - c.height * scale) / 2,
    })
  }, [])

  // Measure the viewport; fit the content the first time we get real dimensions.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const firstMeasure = viewport.current.width === 0
      const size = { width: rect.width, height: rect.height }
      viewport.current = size
      setViewportSize(size)
      if (firstMeasure) fitToView()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToView])

  const zoomAround = useCallback((px: number, py: number, factor: number) => {
    setTransform((t) => {
      const next = clampScale(t.scale * factor)
      const k = next / t.scale
      const rawTx = px - (px - t.tx) * k
      const rawTy = py - (py - t.ty) * k
      const { tx, ty } = clampPan(rawTx, rawTy, contentRef.current, viewport.current, next)
      return { scale: next, tx, ty }
    })
  }, [])

  const panBy = useCallback((dx: number, dy: number) => {
    setTransform((t) => {
      const { tx, ty } = clampPan(t.tx + dx, t.ty + dy, contentRef.current, viewport.current, t.scale)
      return { scale: t.scale, tx, ty }
    })
  }, [])

  // Native non-passive wheel listener so we can preventDefault page scroll.
  // Plain wheel/trackpad scroll pans the graph horizontally (vertical scroll
  // moves it left/right, horizontal scroll/swipe also moves it left/right).
  // Ctrl/Cmd+wheel zooms, anchored at the cursor.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
        zoomAround(e.clientX - rect.left, e.clientY - rect.top, factor)
        return
      }
      // Scroll up / scroll right -> content moves right; scroll down / scroll left -> content moves left.
      panBy(e.deltaX - e.deltaY, 0)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround, panBy])

  const localPoint = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const pt = localPoint(e)
    pointers.current.set(e.pointerId, pt)
    svgRef.current?.setPointerCapture(e.pointerId)
    didPanRef.current = false

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: distance(a, b),
        scale: transformRef.current.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      }
      panOrigin.current = null
    } else {
      const t = transformRef.current
      panOrigin.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty }
      setIsPanning(true)
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, localPoint(e))

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()]
        const dist = distance(a, b)
        if (pinch.current.dist > 0) {
          const next = clampScale((pinch.current.scale * dist) / pinch.current.dist)
          const cx = pinch.current.cx
          const cy = pinch.current.cy
          setTransform((t) => {
            const k = next / t.scale
            const rawTx = cx - (cx - t.tx) * k
            const rawTy = cy - (cy - t.ty) * k
            const { tx, ty } = clampPan(rawTx, rawTy, contentRef.current, viewport.current, next)
            return { scale: next, tx, ty }
          })
        }
        didPanRef.current = true
        return
      }

      const origin = panOrigin.current
      if (!origin) return
      const dx = e.clientX - origin.x
      const dy = e.clientY - origin.y
      if (Math.hypot(dx, dy) > PAN_THRESHOLD) didPanRef.current = true
      setTransform((t) => {
        const { tx, ty } = clampPan(
          origin.tx + dx,
          origin.ty + dy,
          contentRef.current,
          viewport.current,
          t.scale,
        )
        return { scale: t.scale, tx, ty }
      })
    },
    [],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    svgRef.current?.releasePointerCapture?.(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      panOrigin.current = null
      setIsPanning(false)
    } else {
      // One finger remains after a pinch — resume panning from it.
      const remaining = [...pointers.current.values()][0]
      const rect = svgRef.current?.getBoundingClientRect()
      const t = transformRef.current
      panOrigin.current = {
        x: remaining.x + (rect?.left ?? 0),
        y: remaining.y + (rect?.top ?? 0),
        tx: t.tx,
        ty: t.ty,
      }
    }
  }, [])

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewport.current
      zoomAround(vp.width / 2, vp.height / 2, factor)
    },
    [zoomAround],
  )

  const zoomIn = useCallback(() => zoomBy(BUTTON_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / BUTTON_STEP), [zoomBy])

  const setHorizontalScroll = useCallback((fraction: number) => {
    const vp = viewport.current
    const c = contentRef.current
    setTransform((t) => {
      const scaledWidth = c.width * t.scale
      const range = Math.max(0, scaledWidth - vp.width)
      const tx = -clamp01(fraction) * range
      const { tx: ctx, ty } = clampPan(tx, t.ty, c, vp, t.scale)
      return { scale: t.scale, tx: ctx, ty }
    })
  }, [])

  const setVerticalScroll = useCallback((fraction: number) => {
    const vp = viewport.current
    const c = contentRef.current
    setTransform((t) => {
      const scaledHeight = c.height * t.scale
      const range = Math.max(0, scaledHeight - vp.height)
      const ty = -clamp01(fraction) * range
      const { tx, ty: cty } = clampPan(t.tx, ty, c, vp, t.scale)
      return { scale: t.scale, tx, ty: cty }
    })
  }, [])

  const horizontalScrollbar = scrollbarMetrics(
    content.width * transform.scale,
    viewportSize.width,
    transform.tx,
  )
  const verticalScrollbar = scrollbarMetrics(
    content.height * transform.scale,
    viewportSize.height,
    transform.ty,
  )

  return {
    svgRef,
    transform,
    viewportSize,
    isPanning,
    didPanRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomBy,
    zoomIn,
    zoomOut,
    fitToView,
    horizontalScrollbar,
    verticalScrollbar,
    setHorizontalScroll,
    setVerticalScroll,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function scrollbarMetrics(scaledContent: number, viewport: number, offset: number): ScrollbarMetrics {
  if (!viewport || scaledContent <= viewport) {
    return { size: 1, offset: 0, scrollable: false }
  }
  const size = clamp01(viewport / scaledContent)
  const range = scaledContent - viewport
  const position = clamp01(-offset / range)
  return { size, offset: position * (1 - size), scrollable: true }
}
