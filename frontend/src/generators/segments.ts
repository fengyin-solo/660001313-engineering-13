// 分段生成器：每种图案按绘制过程产出有序片段，而不是一次性拼出整串。
// 每段带所属图案与序号；拼接（join('')）结果必须与 patterns.ts 中
// 对应一次性生成函数的输出逐字符一致，该约定由构建脚本强制校验。
import {
  createRng,
  generateSpiral, generateFractal, generateWave, generateCircles, generateNoise,
} from './patterns'
import type { Rng } from './patterns'
import type { PatternType } from '../types'

export interface SegmentParams {
  width: number
  height: number
  iterations: number
  scale: number
  seed: number
  palette: string[]
  strokeWidth: number
  opacity: number
}

export interface PatternSegment {
  pattern: PatternType
  index: number
  svg: string
}

// 对缺失/非法参数显式说明原因，绝不静默跳过。
export function validateSegmentParams(params: SegmentParams): string[] {
  const reasons: string[] = []
  const { width, height, iterations, scale, seed, palette, strokeWidth, opacity } = params
  if (!Number.isFinite(width) || width <= 0) reasons.push(`width 非法: ${width}`)
  if (!Number.isFinite(height) || height <= 0) reasons.push(`height 非法: ${height}`)
  if (!Number.isFinite(iterations) || iterations < 1) reasons.push(`iterations 非法: ${iterations}`)
  if (!Number.isFinite(scale) || scale <= 0) reasons.push(`scale 非法: ${scale}`)
  if (!Number.isFinite(seed)) reasons.push(`seed 非法: ${seed}`)
  if (!Array.isArray(palette) || palette.length === 0) reasons.push('palette 缺失或为空')
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) reasons.push(`strokeWidth 非法: ${strokeWidth}`)
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) reasons.push(`opacity 非法: ${opacity}`)
  return reasons
}

type SegmentGenerator = (
  w: number, h: number, iterations: number, scale: number,
  palette: string[], rng: Rng, strokeWidth: number, opacity: number
) => PatternSegment[]

// 螺旋：每条旋臂为一段（旋臂数量由 rng 决定，与一次性版同源）。
const spiralSegments: SegmentGenerator = (w, h, iterations, scale, palette, rng, strokeWidth, opacity) => {
  const cx = w / 2, cy = h / 2
  const arms = 3 + Math.floor(rng() * 5)
  const segments: PatternSegment[] = []
  for (let arm = 0; arm < arms; arm++) {
    const offset = (arm / arms) * Math.PI * 2
    let d = ''
    for (let i = 0; i < iterations; i++) {
      const angle = (i / iterations) * Math.PI * 8 + offset
      const r = (i / iterations) * Math.min(w, h) * 0.45 * scale
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)
    }
    const color = palette[arm % palette.length]
    segments.push({
      pattern: 'spiral', index: arm,
      svg: `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
    })
  }
  return segments
}

// 分形树：按深度优先的绘制顺序，每条树枝为一段（rng 消耗顺序与一次性版一致）。
const fractalSegments: SegmentGenerator = (w, h, iterations, scale, palette, rng, strokeWidth, opacity) => {
  const segments: PatternSegment[] = []
  const depth = Math.min(8, Math.floor(iterations / 25) + 2)
  function tree(x: number, y: number, angle: number, len: number, d: number) {
    if (d <= 0 || len < 2) return
    const x2 = x + Math.cos(angle) * len
    const y2 = y + Math.sin(angle) * len
    const color = palette[d % palette.length]
    segments.push({
      pattern: 'fractal', index: segments.length,
      svg: `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
    })
    const spread = 0.4 + rng() * 0.3
    tree(x2, y2, angle - spread, len * 0.7, d - 1)
    tree(x2, y2, angle + spread, len * 0.7, d - 1)
  }
  tree(w / 2, h * 0.85, -Math.PI / 2, h * 0.25 * scale, depth)
  return segments
}

// 波浪：每一层为一段。
const waveSegments: SegmentGenerator = (w, h, iterations, scale, palette, rng, strokeWidth, opacity) => {
  const segments: PatternSegment[] = []
  const layers = Math.min(20, Math.floor(iterations / 10))
  for (let layer = 0; layer < layers; layer++) {
    const freq = 0.005 + rng() * 0.01
    const amp = 30 + rng() * 60 * scale
    const baseY = (layer / layers) * h
    const phase = rng() * Math.PI * 2
    let d = `M0,${baseY.toFixed(1)}`
    for (let x = 0; x <= w; x += 4) {
      const y = baseY + Math.sin(x * freq + phase) * amp + Math.cos(x * freq * 2 + phase) * amp * 0.3
      d += ` L${x},${y.toFixed(1)}`
    }
    const color = palette[layer % palette.length]
    segments.push({
      pattern: 'wave', index: layer,
      svg: `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
    })
  }
  return segments
}

// 圆环：每个圆为一段。
const circlesSegments: SegmentGenerator = (w, h, iterations, scale, palette, rng, strokeWidth, opacity) => {
  const segments: PatternSegment[] = []
  for (let i = 0; i < iterations; i++) {
    const cx = rng() * w
    const cy = rng() * h
    const r = 5 + rng() * 80 * scale
    const color = palette[i % palette.length]
    segments.push({
      pattern: 'circles', index: i,
      svg: `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
    })
  }
  return segments
}

// 噪声场：每一扫描行为一段（空段保留以保证序号连续，与逐行绘制过程对应）。
const noiseSegments: SegmentGenerator = (w, h, iterations, scale, palette, rng, strokeWidth, opacity) => {
  const segments: PatternSegment[] = []
  const step = Math.max(4, Math.floor(20 / scale))
  const cols = Math.floor(w / step)
  const rows = Math.floor(h / step)
  for (let row = 0; row < rows; row++) {
    let svg = ''
    for (let col = 0; col < cols; col++) {
      if (rng() > 0.4) continue
      const x = col * step
      const y = row * step
      const len = 5 + rng() * 15 * scale
      const angle = rng() * Math.PI * 2
      const x2 = x + Math.cos(angle) * len
      const y2 = y + Math.sin(angle) * len
      const color = palette[(row + col) % palette.length]
      svg += `<line x1="${x}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
    }
    segments.push({ pattern: 'noise', index: row, svg })
  }
  return segments
}

export const PATTERN_LABELS: Record<PatternType, string> = {
  spiral: '螺旋',
  fractal: '分形树',
  wave: '波浪',
  circles: '圆环',
  voronoi: 'Voronoi（未实现）',
  noise: '噪声场',
}

// 已注册分段生成器的图案；未出现在表中的图案（如 voronoi）属于“图案缺失”，
// 调用方必须在日志中说明，而不是静默跳过。
export const SEGMENT_GENERATORS: Partial<Record<PatternType, SegmentGenerator>> = {
  spiral: spiralSegments,
  fractal: fractalSegments,
  wave: waveSegments,
  circles: circlesSegments,
  noise: noiseSegments,
}

// 随产品交付的五种图案，构建时必须全部通过分段校验。
export const SHIPPED_PATTERNS: PatternType[] = ['spiral', 'fractal', 'wave', 'circles', 'noise']

// 一次性生成（对照基准）：与 ArtCanvas 原先调用的是同一份实现。
// 仅交付的五种图案有基准；voronoi 等未实现图案不在其中（视为图案缺失并显式记录）。
export const ONE_SHOT_GENERATORS: Partial<Record<PatternType, SegmentGenerator>> = {
  spiral: (w, h, iterations, scale, palette, rng, strokeWidth, opacity) =>
    [{ pattern: 'spiral', index: 0, svg: generateSpiral(w, h, iterations, scale, palette, rng, strokeWidth, opacity) }],
  fractal: (w, h, iterations, scale, palette, rng, strokeWidth, opacity) =>
    [{ pattern: 'fractal', index: 0, svg: generateFractal(w, h, iterations, scale, palette, rng, strokeWidth, opacity) }],
  wave: (w, h, iterations, scale, palette, rng, strokeWidth, opacity) =>
    [{ pattern: 'wave', index: 0, svg: generateWave(w, h, iterations, scale, palette, rng, strokeWidth, opacity) }],
  circles: (w, h, iterations, scale, palette, rng, strokeWidth, opacity) =>
    [{ pattern: 'circles', index: 0, svg: generateCircles(w, h, iterations, scale, palette, rng, strokeWidth, opacity) }],
  noise: (w, h, iterations, scale, palette, rng, strokeWidth, opacity) =>
    [{ pattern: 'noise', index: 0, svg: generateNoise(w, h, iterations, scale, palette, rng, strokeWidth, opacity) }],
}

/**
 * 按段产出指定图案。
 * - 参数缺失/非法：日志说明原因并返回空数组（不静默跳过）。
 * - 图案没有注册分段生成器：日志说明图案缺失并返回空数组。
 */
export function generatePatternSegments(pattern: PatternType, params: SegmentParams): PatternSegment[] {
  const generator = SEGMENT_GENERATORS[pattern]
  if (!generator) {
    console.warn(`[segments] 图案「${PATTERN_LABELS[pattern] ?? pattern}」没有分段生成器，已跳过并记录原因`)
    return []
  }
  const reasons = validateSegmentParams(params)
  if (reasons.length > 0) {
    console.warn(`[segments] 图案「${PATTERN_LABELS[pattern]}」参数缺失或非法，无法分段生成：${reasons.join('；')}`)
    return []
  }
  const { width, height, iterations, scale, seed, palette, strokeWidth, opacity } = params
  const rng = createRng(seed)
  return generator(width, height, iterations, scale, palette, rng, strokeWidth, opacity)
}

// 把分段结果拼回整串，供画布渲染 / 导出 / 对照一次性生成使用。
export function joinSegments(segments: PatternSegment[]): string {
  return segments.map(s => s.svg).join('')
}
