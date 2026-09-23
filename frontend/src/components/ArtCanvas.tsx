import { useEffect, useRef, useState } from 'react'
import { useDesignStore } from '../store/design'
import {
  generateSegmentList, getSegmentCount, PATTERN_NAMES, validatePatternParams,
  type PatternParams, type PatternSegment,
} from '../generators/patterns'

const REPLAY_INTERVAL_MS = 50

interface FrameParams {
  width: number
  height: number
  bgColor: string
  rotation: number
}

function buildSvg(segments: PatternSegment[], p: FrameParams): string {
  const { width, height, bgColor, rotation } = p
  const content = segments.map(s => s.content).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
  <g transform="rotate(${rotation},${width / 2},${height / 2})">${content}</g>
</svg>`
}

export default function ArtCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [token, setToken] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const store = useDesignStore()
  const {
    width, height, pattern, iterations, scale, palette, strokeWidth, opacity,
    bgColor, rotation, seed,
  } = store

  const params: PatternParams = { seed, width, height, iterations, scale, strokeWidth, opacity, palette }
  const frameParams = { width, height, bgColor, rotation }

  // 一次性：把分段拼回整串铺到画布（生成、铺画布、导出仍使用同一结果）
  useEffect(() => {
    if (playing) return
    const problems = validatePatternParams(pattern, params)
    if (problems.length > 0) {
      const reason = `无法生成图案：\n${problems.map(r => `- ${r}`).join('\n')}`
      console.error(`[ArtCanvas] 图案「${PATTERN_NAMES[pattern as keyof typeof PATTERN_NAMES] ?? pattern}」${reason}`)
      setError(reason)
      setProgress(null)
      return
    }
    try {
      const segments = generateSegmentList(pattern, params)
      const svg = buildSvg(segments, frameParams)
      setError(null)
      setProgress(null)
      store.setSvgContent(svg)
      if (containerRef.current) containerRef.current.innerHTML = svg
    } catch (e) {
      console.error('[ArtCanvas] 分段生成失败：', e)
      setError((e as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pattern, seed, iterations, scale, rotation, strokeWidth, opacity, bgColor, width, height, palette])

  // 按段回放：每帧多铺一段，复用 generateSegmentList 的同一份分段产物
  useEffect(() => {
    if (!playing) return
    const problems = validatePatternParams(pattern, params)
    if (problems.length > 0) {
      console.error(`[ArtCanvas] 回放中止：${problems.join('；')}`)
      setPlaying(false)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval>
    try {
      const segments = generateSegmentList(pattern, params)
      const total = segments.length
      let done = 0
      setProgress({ done: 0, total })
      const paint = () => {
        if (cancelled) return
        const svg = buildSvg(segments.slice(0, done), frameParams)
        store.setSvgContent(svg)
        if (containerRef.current) containerRef.current.innerHTML = svg
        setProgress({ done, total })
      }
      paint()
      timer = setInterval(() => {
        done++
        if (done >= total) {
          clearInterval(timer)
          paint()
          if (!cancelled) setPlaying(false)
          return
        }
        paint()
      }, REPLAY_INTERVAL_MS)
    } catch (e) {
      console.error('[ArtCanvas] 回放时分段生成失败：', e)
      setPlaying(false)
      return
    }
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, token, pattern, seed, iterations, scale, rotation, strokeWidth, opacity, bgColor, width, height, palette])

  const patternName = PATTERN_NAMES[pattern as keyof typeof PATTERN_NAMES] ?? pattern
  let totalSegments = 0
  const problems = validatePatternParams(pattern, params)
  if (problems.length === 0) {
    try { totalSegments = getSegmentCount(pattern, params) } catch { /* 错误已在生成时记录 */ }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={containerRef}
        className="shadow-2xl rounded border border-gray-700"
        style={{ maxWidth: '100%', maxHeight: '70vh', overflow: 'hidden' }}
      />
      {error && (
        <div className="max-w-xl text-xs text-rose-300 bg-rose-950/60 border border-rose-800 rounded p-2 whitespace-pre-wrap">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-300">
        {!playing ? (
          <button
            onClick={() => { setError(null); setToken(t => t + 1); setPlaying(true) }}
            disabled={problems.length > 0}
            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed"
            title={problems.length > 0 ? problems.join('；') : `按绘制顺序逐段回放「${patternName}」`}
          >
            ▶ 分段回放（{patternName}，共 {totalSegments} 段）
          </button>
        ) : (
          <>
            <button onClick={() => setToken(t => t + 1)} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600">↺ 从头回放</button>
            <button onClick={() => setPlaying(false)} className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500">⏹ 停止</button>
          </>
        )}
        {progress && (
          <span>
            段 {progress.done}/{progress.total}
            <span className="inline-block w-32 h-1.5 ml-2 bg-gray-700 rounded align-middle overflow-hidden">
              <span
                className="block h-full bg-indigo-500 transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }}
              />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
