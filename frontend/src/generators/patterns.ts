import type { PatternType } from '../types'

// Seeded PRNG (mulberry32)
export function createRng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = ReturnType<typeof createRng>

/** 一次生成所需的全部参数（rotation/bgColor 在外层包装 SVG 时使用，与图案本身无关） */
export interface PatternParams {
  seed: number
  width: number
  height: number
  iterations: number
  scale: number
  strokeWidth: number
  opacity: number
  palette: string[]
}

/** 分段产物：index 为段序号（从 0 起），pattern 为所属图案，content 为该段 SVG 片段 */
export interface PatternSegment {
  index: number
  pattern: PatternType
  content: string
}

export const PATTERN_IDS: PatternType[] = ['spiral', 'fractal', 'wave', 'circles', 'noise']

export const PATTERN_NAMES: Record<PatternType, string> = {
  spiral: '螺旋',
  fractal: '分形树',
  wave: '波浪',
  circles: '圆环',
  noise: '噪声场',
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  return value === null ? 'null' : typeof value
}

/** 校验参数，返回所有不合规原因（空数组表示通过）。图案或参数缺失时给出明确原因而非静默跳过。 */
export function validatePatternParams(pattern: unknown, p: unknown): string[] {
  const reasons: string[] = []
  if (typeof pattern !== 'string' || !(PATTERN_IDS as string[]).includes(pattern)) {
    reasons.push(`图案类型缺失或不受支持："${String(pattern)}"，当前支持：${PATTERN_IDS.join('、')}`)
  }
  if (p === null || typeof p !== 'object') {
    reasons.push(`缺少生成参数（PatternParams 需要是对象，实际为 ${describe(p)}）`)
    return reasons
  }
  const record = p as Record<string, unknown>
  const checkNumber = (key: keyof PatternParams, label: string, rule?: (v: number) => string) => {
    const v = record[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      reasons.push(`参数缺失或非法：${label}(${key}) 需要是有限数字，实际为 ${describe(v)}`)
    } else if (rule) {
      const msg = rule(v)
      if (msg) reasons.push(`参数非法：${label}(${key})=${v}，${msg}`)
    }
  }
  checkNumber('seed', '种子')
  checkNumber('width', '画布宽度', v => (v > 0 ? '' : '必须大于 0'))
  checkNumber('height', '画布高度', v => (v > 0 ? '' : '必须大于 0'))
  checkNumber('iterations', '迭代数', v => (v >= 1 ? '' : '必须不小于 1'))
  checkNumber('scale', '缩放', v => (v > 0 ? '' : '必须大于 0'))
  checkNumber('strokeWidth', '描边宽度', v => (v > 0 ? '' : '必须大于 0'))
  checkNumber('opacity', '不透明度', v => (v > 0 && v <= 1 ? '' : '必须在 (0, 1] 范围内'))
  const palette = record.palette
  if (!Array.isArray(palette)) {
    reasons.push(`参数缺失或非法：调色板(palette) 需要是非空字符串数组，实际为 ${describe(palette)}`)
  } else if (palette.length === 0) {
    reasons.push('参数非法：调色板(palette) 不能为空数组')
  } else if (palette.some(c => typeof c !== 'string' || c.length === 0)) {
    reasons.push('参数非法：调色板(palette) 中每一项都必须是非空颜色字符串')
  }
  return reasons
}

function assertValid(pattern: PatternType, p: PatternParams): void {
  const reasons = validatePatternParams(pattern, p)
  if (reasons.length > 0) {
    throw new Error([`图案「${PATTERN_NAMES[pattern as PatternType] ?? pattern}」参数校验未通过：`, ...reasons.map(r => `  - ${r}`)].join('\n'))
  }
}

/* ---------------- 各图案实现：分段产出 + 一次性参照 ---------------- */

interface PatternImpl {
  readonly id: PatternType
  readonly name: string
  /** 段总数 */
  count(p: PatternParams): number
  /** 一次性生成整串（与历史行为一致，作为拼接校验的参照） */
  whole(p: PatternParams): string
  /** 惰性逐段产出，段序即拼接顺序 */
  segments(p: PatternParams): Generator<string, void, unknown>
  /** 独立重生成第 index 段（不复用批量产出的任何中间状态） */
  partAt(p: PatternParams, index: number): string
}

function nth(gen: Generator<string, void, unknown>, index: number): string {
  let i = 0
  for (const content of gen) {
    if (i === index) return content
    i++
  }
  throw new Error(`段序号 ${index} 超出范围（共 ${i} 段）`)
}

/* ---------- 螺旋：每段一条旋臂 ---------- */

function spiralArm(arm: number, arms: number, p: PatternParams): string {
  const { width: w, height: h, iterations, scale, strokeWidth, opacity, palette } = p
  const cx = w / 2, cy = h / 2
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
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
}

const spiralImpl: PatternImpl = {
  id: 'spiral',
  name: PATTERN_NAMES.spiral,
  count(p) {
    const rng = createRng(p.seed)
    return 3 + Math.floor(rng() * 5)
  },
  whole(p) {
    const cx = p.width / 2, cy = p.height / 2
    let paths = ''
    const rng = createRng(p.seed)
    const arms = 3 + Math.floor(rng() * 5)
    for (let arm = 0; arm < arms; arm++) {
      const offset = (arm / arms) * Math.PI * 2
      let d = ''
      for (let i = 0; i < p.iterations; i++) {
        const angle = (i / p.iterations) * Math.PI * 8 + offset
        const r = (i / p.iterations) * Math.min(p.width, p.height) * 0.45 * p.scale
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)
      }
      const color = p.palette[arm % p.palette.length]
      paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
    }
    return paths
  },
  *segments(p) {
    const rng = createRng(p.seed)
    const arms = 3 + Math.floor(rng() * 5)
    for (let arm = 0; arm < arms; arm++) yield spiralArm(arm, arms, p)
  },
  partAt(p, index) {
    const rng = createRng(p.seed)
    const arms = 3 + Math.floor(rng() * 5)
    return spiralArm(index, arms, p)
  },
}

/* ---------- 分形树：每段一条枝杈线段（深度优先顺序） ---------- */

function fractalLine(
  x: number, y: number, x2: number, y2: number, depth: number, p: PatternParams
): string {
  const color = p.palette[depth % p.palette.length]
  return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
}

const fractalImpl: PatternImpl = {
  id: 'fractal',
  name: PATTERN_NAMES.fractal,
  count(p) {
    let n = 0
    for (const _line of fractalImpl.segments(p)) n++
    return n
  },
  whole(p) {
    let paths = ''
    const rng = createRng(p.seed)
    const depth = Math.min(8, Math.floor(p.iterations / 25) + 2)
    function tree(x: number, y: number, angle: number, len: number, d: number) {
      if (d <= 0 || len < 2) return
      const x2 = x + Math.cos(angle) * len
      const y2 = y + Math.sin(angle) * len
      paths += fractalLine(x, y, x2, y2, d, p)
      const spread = 0.4 + rng() * 0.3
      tree(x2, y2, angle - spread, len * 0.7, d - 1)
      tree(x2, y2, angle + spread, len * 0.7, d - 1)
    }
    tree(p.width / 2, p.height * 0.85, -Math.PI / 2, p.height * 0.25 * p.scale, depth)
    return paths
  },
  *segments(p) {
    const rng = createRng(p.seed)
    const depth = Math.min(8, Math.floor(p.iterations / 25) + 2)
    function* tree(x: number, y: number, angle: number, len: number, d: number): Generator<string, void, unknown> {
      if (d <= 0 || len < 2) return
      const x2 = x + Math.cos(angle) * len
      const y2 = y + Math.sin(angle) * len
      yield fractalLine(x, y, x2, y2, d, p)
      const spread = 0.4 + rng() * 0.3
      yield* tree(x2, y2, angle - spread, len * 0.7, d - 1)
      yield* tree(x2, y2, angle + spread, len * 0.7, d - 1)
    }
    yield* tree(p.width / 2, p.height * 0.85, -Math.PI / 2, p.height * 0.25 * p.scale, depth)
  },
  partAt(p, index) {
    return nth(fractalImpl.segments(p), index)
  },
}

/* ---------- 波浪：每段一条波形层 ---------- */

function waveLayer(
  layer: number, layers: number, p: PatternParams,
  freq: number, amp: number, phase: number
): string {
  const baseY = (layer / layers) * p.height
  let d = `M0,${baseY.toFixed(1)}`
  for (let x = 0; x <= p.width; x += 4) {
    const y = baseY + Math.sin(x * freq + phase) * amp + Math.cos(x * freq * 2 + phase) * amp * 0.3
    d += ` L${x},${y.toFixed(1)}`
  }
  const color = p.palette[layer % p.palette.length]
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
}

function waveLayerCount(p: PatternParams): number {
  return Math.min(20, Math.floor(p.iterations / 10))
}

const waveImpl: PatternImpl = {
  id: 'wave',
  name: PATTERN_NAMES.wave,
  count(p) {
    return waveLayerCount(p)
  },
  whole(p) {
    let paths = ''
    const rng = createRng(p.seed)
    const layers = waveLayerCount(p)
    for (let layer = 0; layer < layers; layer++) {
      const freq = 0.005 + rng() * 0.01
      const amp = 30 + rng() * 60 * p.scale
      const baseY = (layer / layers) * p.height
      const phase = rng() * Math.PI * 2
      let d = `M0,${baseY.toFixed(1)}`
      for (let x = 0; x <= p.width; x += 4) {
        const y = baseY + Math.sin(x * freq + phase) * amp + Math.cos(x * freq * 2 + phase) * amp * 0.3
        d += ` L${x},${y.toFixed(1)}`
      }
      const color = p.palette[layer % p.palette.length]
      paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
    }
    return paths
  },
  *segments(p) {
    const rng = createRng(p.seed)
    const layers = waveLayerCount(p)
    for (let layer = 0; layer < layers; layer++) {
      const freq = 0.005 + rng() * 0.01
      const amp = 30 + rng() * 60 * p.scale
      const phase = rng() * Math.PI * 2
      yield waveLayer(layer, layers, p, freq, amp, phase)
    }
  },
  partAt(p, index) {
    const layers = waveLayerCount(p)
    const rng = createRng(p.seed)
    let freq = 0, amp = 0, phase = 0
    for (let layer = 0; layer <= index; layer++) {
      freq = 0.005 + rng() * 0.01
      amp = 30 + rng() * 60 * p.scale
      phase = rng() * Math.PI * 2
    }
    return waveLayer(index, layers, p, freq, amp, phase)
  },
}

/* ---------- 圆环：每段一个圆 ---------- */

function circleTag(i: number, cx: number, cy: number, r: number, p: PatternParams): string {
  const color = p.palette[i % p.palette.length]
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
}

const circlesImpl: PatternImpl = {
  id: 'circles',
  name: PATTERN_NAMES.circles,
  count(p) {
    return p.iterations
  },
  whole(p) {
    let paths = ''
    const rng = createRng(p.seed)
    for (let i = 0; i < p.iterations; i++) {
      const cx = rng() * p.width
      const cy = rng() * p.height
      const r = 5 + rng() * 80 * p.scale
      paths += circleTag(i, cx, cy, r, p)
    }
    return paths
  },
  *segments(p) {
    const rng = createRng(p.seed)
    for (let i = 0; i < p.iterations; i++) {
      const cx = rng() * p.width
      const cy = rng() * p.height
      const r = 5 + rng() * 80 * p.scale
      yield circleTag(i, cx, cy, r, p)
    }
  },
  partAt(p, index) {
    const rng = createRng(p.seed)
    let cx = 0, cy = 0, r = 0
    for (let i = 0; i <= index; i++) {
      cx = rng() * p.width
      cy = rng() * p.height
      r = 5 + rng() * 80 * p.scale
    }
    return circleTag(index, cx, cy, r, p)
  },
}

/* ---------- 噪声场：每段一行网格 ---------- */

function noiseStep(p: PatternParams): number {
  return Math.max(4, Math.floor(20 / p.scale))
}

/** 处理一个网格单元，按原始顺序消耗随机数；被概率跳过返回 null */
function noiseMark(
  col: number, row: number, step: number, p: PatternParams, rng: Rng
): string | null {
  if (rng() > 0.4) return null
  const x = col * step
  const y = row * step
  const len = 5 + rng() * 15 * p.scale
  const angle = rng() * Math.PI * 2
  const x2 = x + Math.cos(angle) * len
  const y2 = y + Math.sin(angle) * len
  const color = p.palette[(row + col) % p.palette.length]
  return `<line x1="${x}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${p.strokeWidth}" opacity="${p.opacity}"/>`
}

const noiseImpl: PatternImpl = {
  id: 'noise',
  name: PATTERN_NAMES.noise,
  count(p) {
    return Math.floor(p.height / noiseStep(p))
  },
  whole(p) {
    let paths = ''
    const rng = createRng(p.seed)
    const step = noiseStep(p)
    const cols = Math.floor(p.width / step)
    const rows = Math.floor(p.height / step)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const mark = noiseMark(col, row, step, p, rng)
        if (mark) paths += mark
      }
    }
    return paths
  },
  *segments(p) {
    const rng = createRng(p.seed)
    const step = noiseStep(p)
    const cols = Math.floor(p.width / step)
    const rows = Math.floor(p.height / step)
    for (let row = 0; row < rows; row++) {
      let rowContent = ''
      for (let col = 0; col < cols; col++) {
        const mark = noiseMark(col, row, step, p, rng)
        if (mark) rowContent += mark
      }
      yield rowContent
    }
  },
  partAt(p, index) {
    const rng = createRng(p.seed)
    const step = noiseStep(p)
    const cols = Math.floor(p.width / step)
    let rowContent = ''
    for (let row = 0; row <= index; row++) {
      rowContent = ''
      for (let col = 0; col < cols; col++) {
        const mark = noiseMark(col, row, step, p, rng)
        if (row === index && mark) rowContent += mark
      }
    }
    return rowContent
  },
}

const IMPLS: Record<PatternType, PatternImpl> = {
  spiral: spiralImpl,
  fractal: fractalImpl,
  wave: waveImpl,
  circles: circlesImpl,
  noise: noiseImpl,
}

/* ---------------- 对外 API ---------------- */

/** 段总数 */
export function getSegmentCount(pattern: PatternType, p: PatternParams): number {
  assertValid(pattern, p)
  return IMPLS[pattern].count(p)
}

/** 一次性生成整串 SVG 片段（参照实现） */
export function renderPattern(pattern: PatternType, p: PatternParams): string {
  assertValid(pattern, p)
  return IMPLS[pattern].whole(p)
}

/** 惰性逐段产出：可用于分步回放，不必先拼完整串 */
export function* generateSegments(pattern: PatternType, p: PatternParams): Generator<PatternSegment, void, unknown> {
  assertValid(pattern, p)
  let index = 0
  for (const content of IMPLS[pattern].segments(p)) {
    yield { index: index++, pattern, content }
  }
}

/** 一次性取出全部分段 */
export function generateSegmentList(pattern: PatternType, p: PatternParams): PatternSegment[] {
  return Array.from(generateSegments(pattern, p))
}

/** 只生成指定序号的一段（独立重跑随机序列，用于回放/复用单段） */
export function generateSegmentAt(pattern: PatternType, p: PatternParams, index: number): PatternSegment {
  assertValid(pattern, p)
  const impl = IMPLS[pattern]
  const total = impl.count(p)
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new Error(`图案「${impl.name}」(${pattern}) 第 ${index} 段不存在：共 ${total} 段（合法序号 0-${total - 1}）`)
  }
  return { index, pattern, content: impl.partAt(p, index) }
}
