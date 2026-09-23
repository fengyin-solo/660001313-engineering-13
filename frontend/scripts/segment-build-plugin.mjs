// Vite 构建插件：把分段生成接进构建流程。
//
// 构建开始时按固定参数对五种图案各跑一遍分段产出，并做两类校验：
//   1. 段序完整：index 从 0 起连续、无缺失、无重复，且 pattern 归属一致；
//   2. 拼合一致：各段 svg 拼回来与一次性生成的整串逐字符相等。
// 任一不符就让构建失败，并指出是哪种图案的第几段出了问题。
// 通过的分段结果固化到 src/generated/segments/ 供运行时本地复用。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src')
const outDir = join(srcDir, 'generated', 'segments')

const LABELS = { spiral: '螺旋', fractal: '分形树', wave: '波浪', circles: '圆环', noise: '噪声场' }

// 固定参数：与 store 默认值一致，保证构建结果可复现、可对照。
const FIXED_PARAMS = {
  seed: 42,
  iterations: 200,
  scale: 1.0,
  strokeWidth: 1.5,
  opacity: 0.8,
  width: 800,
  height: 1000,
}

// 与 src/generators/segmentStore.ts 中的 segmentKey 保持同一拼法。
function segmentKey(pattern, p, palette) {
  return [
    pattern,
    `s${p.seed}`,
    `i${p.iterations}`,
    `sc${p.scale}`,
    `w${p.width}`,
    `h${p.height}`,
    `sw${p.strokeWidth}`,
    `o${p.opacity}`,
    `p${palette.map(c => c.replace('#', '')).join('-')}`,
  ].join('|')
}

// 用 esbuild 把 TS 源文件打成一份临时 ESM 再 import，
// 这样构建脚本和浏览器运行时用的是同一份分段/一次性实现。
async function loadGeneratorModules() {
  const tempDir = mkdtempSync(join(tmpdir(), 'segment-build-'))
  const entry = join(tempDir, 'entry.ts')
  const bundle = join(tempDir, 'bundle.mjs')
  writeFileSync(entry, `
export { createRng } from ${JSON.stringify(join(srcDir, 'generators', 'patterns.ts'))}
export {
  SHIPPED_PATTERNS, SEGMENT_GENERATORS, ONE_SHOT_GENERATORS, validateSegmentParams,
} from ${JSON.stringify(join(srcDir, 'generators', 'segments.ts'))}
export { THEMES } from ${JSON.stringify(join(srcDir, 'themes', 'palettes.ts'))}
`)
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: bundle,
      logLevel: 'silent',
    })
    return await import(pathToFileURL(bundle).href)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

// 返回错误信息；无误返回 null。
function validateSequence(pattern, label, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return `图案「${label}」(${pattern}) 分段产出为空，无法构成绘制序列`
  }
  const seen = new Set()
  for (const seg of segments) {
    if (!seg || seg.pattern !== pattern) {
      return `图案「${label}」(${pattern}) 的第 ${seg?.index ?? '?'} 段归属图案为 ${seg?.pattern ?? '缺失'}，与声明不符`
    }
    if (!Number.isInteger(seg.index) || seg.index < 0) {
      return `图案「${label}」(${pattern}) 存在非法段序号: ${String(seg?.index)}`
    }
    if (seen.has(seg.index)) {
      return `图案「${label}」(${pattern}) 的第 ${seg.index} 段重复出现`
    }
    seen.add(seg.index)
  }
  for (let i = 0; i < segments.length; i++) {
    if (!seen.has(i)) {
      return `图案「${label}」(${pattern}) 段序缺失：第 ${i} 段不存在（共收到 ${segments.length} 段）`
    }
    if (segments[i].index !== i) {
      return `图案「${label}」(${pattern}) 段序错位：位置 ${i} 放的是第 ${segments[i].index} 段`
    }
  }
  return null
}

// 找出两个字符串首个不同字符的位置，方便定位问题。
function firstDiffPos(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

export default function segmentBuildPlugin() {
  return {
    name: 'segment-build-verify',
    apply: 'build',
    async buildStart() {
      const mod = await loadGeneratorModules()
      const palette = mod.THEMES[0].colors

      // 参数缺失/非法：说明原因并直接让构建失败，不静默跳过。
      const paramErrors = mod.validateSegmentParams({ ...FIXED_PARAMS, palette })
      if (paramErrors.length > 0) {
        throw new Error(`[segment-build] 固定构建参数缺失或非法：${paramErrors.join('；')}`)
      }

      // 五种交付图案必须全部注册了分段生成器，否则在日志中说明并失败。
      for (const pattern of mod.SHIPPED_PATTERNS) {
        if (!mod.SEGMENT_GENERATORS[pattern]) {
          throw new Error(`[segment-build] 图案「${LABELS[pattern] ?? pattern}」(${pattern}) 缺少分段生成器注册，构建失败`)
        }
      }
      // 已知但尚未实现的图案类型：显式记录原因，不静默跳过。
      for (const pattern of ['voronoi']) {
        if (!mod.SEGMENT_GENERATORS[pattern]) {
          this.warn(`[segment-build] 图案「${pattern}」尚无生成器实现，本次构建不为其分段产出（显式跳过并记录原因）`)
        }
      }

      mkdirSync(outDir, { recursive: true })
      // 清掉上一轮残留产物，避免被运行时 glob 误复用。
      for (const file of readdirSync(outDir)) {
        if (file.endsWith('.json')) unlinkSync(join(outDir, file))
      }

      const a = FIXED_PARAMS
      let totalSegments = 0
      for (const pattern of mod.SHIPPED_PATTERNS) {
        const label = LABELS[pattern]
        // 分段与一次性产出各自拿独立的同种子 RNG，随机消耗过程互不影响。
        const segmented = mod.SEGMENT_GENERATORS[pattern](
          a.width, a.height, a.iterations, a.scale, palette, mod.createRng(a.seed), a.strokeWidth, a.opacity
        )
        const oneShotSvg = mod.ONE_SHOT_GENERATORS[pattern](
          a.width, a.height, a.iterations, a.scale, palette, mod.createRng(a.seed), a.strokeWidth, a.opacity
        )[0].svg

        const sequenceError = validateSequence(pattern, label, segmented)
        if (sequenceError) throw new Error(`[segment-build] ${sequenceError}`)

        // 按段拼接并逐段比对，定位到具体是哪一段出了问题。
        let cursor = 0
        let mismatch = null
        for (const seg of segmented) {
          if (oneShotSvg.startsWith(seg.svg, cursor)) {
            cursor += seg.svg.length
          } else {
            mismatch = seg.index
            break
          }
        }
        if (mismatch === null && cursor !== oneShotSvg.length) mismatch = '(尾段之后存在多余/缺失内容)'

        if (mismatch !== null) {
          const joined = segmented.map(s => s.svg).join('')
          const pos = firstDiffPos(joined, oneShotSvg)
          throw new Error(
            `[segment-build] 图案「${label}」(${pattern}) 分段拼合结果与一次性生成不一致：` +
            `问题出在第 ${mismatch} 段（全串首个差异字符位置 ${pos}）；` +
            `分段拼合长度 ${joined.length}，一次性生成长度 ${oneShotSvg.length}`
          )
        }

        const artifact = {
          key: segmentKey(pattern, a, palette),
          pattern,
          params: { ...a, palette },
          segments: segmented,
          generatedAt: new Date().toISOString(),
        }
        writeFileSync(join(outDir, `${pattern}.json`), JSON.stringify(artifact, null, 2))
        totalSegments += segmented.length
        this.info(`[segment-build] 图案「${label}」(${pattern}) 校验通过：${segmented.length} 段，拼合长度 ${oneShotSvg.length}`)
      }
      this.info(`[segment-build] 五种图案分段产出全部校验通过，共 ${totalSegments} 段，已保存到 src/generated/segments/ 供本地复用`)
    },
  }
}
