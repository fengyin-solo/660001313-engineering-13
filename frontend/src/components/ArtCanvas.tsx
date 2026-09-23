import { useEffect, useMemo, useRef, useState } from 'react'
import { useDesignStore } from '../store/design'
import { getOrCreateSegments } from '../generators/segmentStore'
import { PATTERN_LABELS } from '../generators/segments'

export default function ArtCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const store = useDesignStore()

  // 已揭示的段数（按段回放时从 0 增长到 total）。
  const [visible, setVisible] = useState(0)
  const [playing, setPlaying] = useState(false)

  const params = useMemo(() => ({
    width: store.width,
    height: store.height,
    iterations: store.iterations,
    scale: store.scale,
    seed: store.seed,
    palette: store.palette,
    strokeWidth: store.strokeWidth,
    opacity: store.opacity,
  }), [store.width, store.height, store.iterations, store.scale, store.seed,
      store.palette, store.strokeWidth, store.opacity])

  // 分段产出：优先复用构建期固化产物 / localStorage 缓存，未命中才实时生成。
  const { segments, source } = useMemo(
    () => getOrCreateSegments(store.pattern, params),
    [store.pattern, params]
  )
  const total = segments.length

  // 参数或图案变化：停止回放，默认展示拼好的完整画面。
  useEffect(() => {
    setPlaying(false)
    setVisible(total)
  }, [segments, total])

  // 回放驱动：按段依次揭示。
  useEffect(() => {
    if (!playing) return
    if (visible >= total) { setPlaying(false); return }
    const delay = total > 0 ? Math.max(16, Math.min(400, 4000 / total)) : 100
    timerRef.current = window.setTimeout(() => {
      setVisible(v => Math.min(v + 1, total))
    }, delay)
    return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }
  }, [playing, visible, total])

  const { width, height, bgColor, rotation } = store
  const visibleContent = segments.slice(0, visible).map(s => s.svg).join('')
  const fullContent = segments.map(s => s.svg).join('')

  // 导出始终使用全部段拼回的完整字符串；画布按回放进度展示前缀。
  useEffect(() => {
    const wrapSvg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
  <g transform="rotate(${rotation},${width / 2},${height / 2})">${content}</g>
</svg>`
    store.setSvgContent(wrapSvg(fullContent))
    if (containerRef.current) {
      containerRef.current.innerHTML = wrapSvg(visibleContent)
    }
  }, [fullContent, visibleContent, width, height, bgColor, rotation])

  const startReplay = () => { setVisible(0); setPlaying(true) }
  const stepBy = (delta: number) => {
    setPlaying(false)
    setVisible(v => Math.max(0, Math.min(total, v + delta)))
  }
  const reset = () => { setPlaying(false); setVisible(total) }

  const sourceLabel = source === 'build-artifact'
    ? '复用构建产物'
    : source === 'local-cache'
      ? '复用本地缓存'
      : '实时分段生成'

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={containerRef}
        className="shadow-2xl rounded border border-gray-700"
        style={{ maxWidth: '100%', maxHeight: '70vh', overflow: 'hidden' }}
      />
      <div className="flex items-center gap-2 text-xs text-gray-300 bg-gray-900 border border-gray-700 rounded px-3 py-2">
        <span className="text-gray-400">
          {PATTERN_LABELS[store.pattern] ?? store.pattern} · {total} 段
        </span>
        <span className="text-gray-500">({sourceLabel})</span>
        <button onClick={startReplay} disabled={total === 0}
          className="px-2 py-1 rounded bg-indigo-600 disabled:opacity-40">▶ 按段回放</button>
        <button onClick={() => stepBy(-1)} disabled={visible === 0 || playing}
          className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40">⏮ 上一段</button>
        <span className="tabular-nums text-gray-400">第 {visible}/{total} 段</span>
        <button onClick={() => stepBy(1)} disabled={visible >= total || playing}
          className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40">下一段 ⏭</button>
        <button onClick={reset}
          className="px-2 py-1 rounded bg-gray-700">⏹ 完整画面</button>
      </div>
    </div>
  )
}
