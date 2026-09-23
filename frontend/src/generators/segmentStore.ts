// 分段结果的本地保存与复用。
// 两级缓存：
//   1. 构建期固化的产物 src/generated/segments/<key>.json（随仓库保存，可跨会话复用）
//   2. 运行期 localStorage（用户在界面上改动参数后新生成的分段结果）
// 命中缓存时直接复用，不再重新生成；未命中时实时分段生成并写入 localStorage。
import type { PatternType } from '../types'
import {
  generatePatternSegments, joinSegments, validateSegmentParams,
  PATTERN_LABELS,
} from './segments'
import type { PatternSegment, SegmentParams } from './segments'

export interface SegmentArtifact {
  key: string
  pattern: PatternType
  params: SegmentParams
  segments: PatternSegment[]
  generatedAt: string
}

const LS_PREFIX = 'gen-art:segments:'
const LS_VERSION = 1

// 构建期固化的分段产物（vite build 时由 segment-build-plugin 生成/校验）。
const buildArtifacts = import.meta.glob<{ default: SegmentArtifact }>(
  '../generated/segments/*.json',
  { eager: true }
)
const BUILD_ARTIFACTS = new Map<string, SegmentArtifact>(
  Object.values(buildArtifacts).map(mod => [mod.default.key, mod.default])
)

export function segmentKey(pattern: PatternType, params: SegmentParams): string {
  return [
    pattern,
    `s${params.seed}`,
    `i${params.iterations}`,
    `sc${params.scale}`,
    `w${params.width}`,
    `h${params.height}`,
    `sw${params.strokeWidth}`,
    `o${params.opacity}`,
    `p${params.palette.map(c => c.replace('#', '')).join('-')}`,
  ].join('|')
}

function readLocal(key: string): SegmentArtifact | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const artifact = JSON.parse(raw) as SegmentArtifact
    if (!artifact || artifact.key !== key || !Array.isArray(artifact.segments)) return null
    return artifact
  } catch {
    return null
  }
}

function writeLocal(artifact: SegmentArtifact): void {
  try {
    localStorage.setItem(LS_PREFIX + artifact.key, JSON.stringify(artifact))
  } catch (err) {
    console.warn('[segmentStore] 分段结果写入本地存储失败，本次仅内存使用:', err)
  }
}

/**
 * 取某图案在给定参数下的分段结果，优先复用本地保存的产物。
 * 返回值含来源标记，便于区分“复用”与“新生成”。
 */
export function getOrCreateSegments(
  pattern: PatternType,
  params: SegmentParams
): { segments: PatternSegment[]; source: 'build-artifact' | 'local-cache' | 'generated'; reused: boolean } {
  const reasons = validateSegmentParams(params)
  if (reasons.length > 0) {
    console.warn(`[segmentStore] 图案「${PATTERN_LABELS[pattern] ?? pattern}」参数缺失或非法，跳过取段：${reasons.join('；')}`)
    return { segments: [], source: 'generated', reused: false }
  }

  const key = segmentKey(pattern, params)

  const built = BUILD_ARTIFACTS.get(key)
  if (built) return { segments: built.segments, source: 'build-artifact', reused: true }

  const cached = readLocal(key)
  if (cached) return { segments: cached.segments, source: 'local-cache', reused: true }

  const segments = generatePatternSegments(pattern, params)
  if (segments.length > 0) {
    writeLocal({ key, pattern, params, segments, generatedAt: new Date().toISOString() })
  }
  return { segments, source: 'generated', reused: false }
}

export function joinPatternSegments(segments: PatternSegment[]): string {
  return joinSegments(segments)
}
