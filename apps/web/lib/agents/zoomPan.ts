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

export interface ZoomPanApi {
  svgRef: React.RefObject<SVGSVGElement>
  transform: Transform
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
}

/**
 * Stateless SVG zoom/pan via a `<g transform>` matrix. Handles mouse wheel
 * zoom (anchored at the cursor), pointer drag pan, two-pointer pinch zoom for
 * touch, and "fit to view". Crisp at any zoom level since nothing re-rasterises.
 */
export function useZoomPan(content: ContentSize): ZoomPanApi {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [isPanning, setIsPanning] = useState(false)

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
      viewport.current = { width: rect.width, height: rect.height }
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
      return {
        scale: next,
        tx: px - (px - t.tx) * k,
        ty: py - (py - t.ty) * k,
      }
    })
  }, [])

  // Native non-passive wheel listener so we can preventDefault page scroll.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
      zoomAround(e.clientX - rect.left, e.clientY - rect.top, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround])

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
            return { scale: next, tx: cx - (cx - t.tx) * k, ty: cy - (cy - t.ty) * k }
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
      setTransform({ scale: transformRef.current.scale, tx: origin.tx + dx, ty: origin.ty + dy })
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

  return {
    svgRef,
    transform,
    isPanning,
    didPanRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomBy,
    zoomIn,
    zoomOut,
    fitToView,
  }
}
