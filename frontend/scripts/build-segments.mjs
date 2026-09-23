#!/usr/bin/env node
/**
 * 分段产出构建脚本：
 *  1. 用固定参数（BUILD_PARAMS）对五种图案各跑一遍分段产出；
 *  2. 校验段序号 0..n-1 连续、无缺失/重复、段归属图案正确；
 *  3. 逐段独立重生成（generateSegmentAt）与批量产出逐字节对比；
 *  4. 校验各段拼回来的结果与一次性生成（renderPattern）逐字节一致；
 *  5. 分段结果落盘到 generated-segments/<pattern>/，供回放与复用。
 *
 * 任一图案的任一段不一致，或参数/图案缺失，都会在日志中说明原因并使构建失败。
 * 用法：node scripts/build-segments.mjs
 */
import { promises as fs } from 'node:fs'
import fssync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')

function transpileToTemp(tsPath) {
  const source = ts.sys.readFile(tsPath)
  if (source === undefined) throw new Error(`无法读取 TypeScript 源文件：${tsPath}`)
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
    fileName: path.basename(tsPath),
  })
  const tempDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'seg-build-'))
  const outPath = path.join(tempDir, path.basename(tsPath).replace(/\.ts$/, '.mjs'))
  fssync.writeFileSync(outPath, out.outputText, 'utf8')
  return outPath
}

const patternsTs = path.resolve(__dirname, '..', 'src', 'generators', 'patterns.ts')
const patterns = await import(pathToFileURL(transpileToTemp(patternsTs)).href + `?t=${Date.now()}`)

// —— 构建用固定参数（五种图案共用同一组参数，保证可复现）——
const BUILD_PARAMS = {
  seed: 42,
  width: 800,
  height: 1000,
  iterations: 300,
  scale: 1,
  strokeWidth: 1.5,
  opacity: 0.8,
  // 日落主题（与前端 THEMES[0] 一致）；构建时参数/调色板缺失即报错，不静默跳过
  palette: ['#ff6b35', '#f7c59f', '#efefd0', '#004e89', '#1a659e'],
}

const OUT_ROOT = path.resolve(__dirname, '..', 'generated-segments')

function findDivergence(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

function preview(s) {
  const oneLine = s.replace(/\s+/g, ' ')
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine
}

async function main() {
  await fs.mkdir(OUT_ROOT, { recursive: true })
  // 先写入暂存目录，全部校验通过后再原子替换，避免失败的构建污染可复用的本地产物
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seg-out-'))

  const failures = []
  const summary = []

  for (const patternId of patterns.PATTERN_IDS) {
    const label = `${patterns.PATTERN_NAMES[patternId]}(${patternId})`
    console.log(`\n[构建] 图案「${label}」——固定参数 seed=${BUILD_PARAMS.seed} iterations=${BUILD_PARAMS.iterations} …`)
    const patternFailures = []
    const fail = msg => patternFailures.push(msg)

    const paramProblems = patterns.validatePatternParams(patternId, BUILD_PARAMS)
    if (paramProblems.length > 0) {
      for (const r of paramProblems) console.error(`  ✗ 参数/图案缺失：${r}`)
      failures.push(`图案「${label}」参数校验未通过：${paramProblems.join('；')}`)
      summary.push({ pattern: label, segments: 0, ok: false })
      continue
    }

    const params = { ...BUILD_PARAMS, palette: [...BUILD_PARAMS.palette] }
    let segments
    try {
      segments = patterns.generateSegmentList(patternId, params)
    } catch (e) {
      console.error(`  ✗ 分段产出抛出异常：${e.message}`)
      failures.push(`图案「${label}」分段产出失败：${e.message}`)
      summary.push({ pattern: label, segments: 0, ok: false })
      continue
    }

    const count = patterns.getSegmentCount(patternId, params)
    if (count !== segments.length) {
      fail(`图案「${label}」段数不一致：getSegmentCount=${count}，实际产出=${segments.length}`)
      console.error(`  ✗ 段数不一致：接口声明 ${count}，实际产出 ${segments.length}`)
    }

    // 校验 1：段序号连续、无缺失/重复，且归属图案正确
    const seen = new Set()
    for (const seg of segments) {
      if (seg.pattern !== patternId) {
        fail(`图案「${label}」第 ${seg.index} 段的所属图案标记为 "${seg.pattern}"，应为 "${patternId}"`)
      }
      if (seen.has(seg.index)) {
        fail(`图案「${label}」第 ${seg.index} 段重复`)
      }
      seen.add(seg.index)
    }
    for (let i = 0; i < segments.length; i++) {
      if (!seen.has(i)) {
        fail(`图案「${label}」缺少第 ${i} 段（段序不连续）`)
      }
    }
    const orderBad = segments.some((seg, i) => seg.index !== i)
    if (orderBad) {
      const at = segments.findIndex((seg, i) => seg.index !== i)
      fail(`图案「${label}」段序错误：第 ${at} 个位置的段序号为 ${segments[at]?.index}`)
    }

    // 校验 2：逐段独立重生成（从同一固定参数重跑随机序列）必须与批量产出一致
    for (let i = 0; i < segments.length; i++) {
      let replayed
      try {
        replayed = patterns.generateSegmentAt(patternId, params, i)
      } catch (e) {
        fail(`图案「${label}」第 ${i} 段无法独立重生成：${e.message}`)
        break
      }
      if (replayed.index !== i || replayed.pattern !== patternId) {
        fail(`图案「${label}」第 ${i} 段重生成后序号/图案标记错误：index=${replayed.index}, pattern=${replayed.pattern}`)
      }
      if (replayed.content !== segments[i].content) {
        const at = findDivergence(replayed.content, segments[i].content)
        fail(
          `图案「${label}」第 ${i} 段独立重生成结果与批量产出不一致（首个差异字符位置 ${at}）\n` +
          `      批量产出：${preview(segments[i].content)}\n` +
          `      重生成：  ${preview(replayed.content)}`
        )
      }
    }

    // 校验 3：各段拼回来必须与一次性生成逐字节一致
    const joined = segments.map(s => s.content).join('')
    const whole = patterns.renderPattern(patternId, params)
    if (joined !== whole) {
      const at = findDivergence(joined, whole)
      // 定位首个差异落在哪一段，便于指出“第几段”（差异在末尾时归属最后一段）
      let cursor = 0
      let segAt = -1
      for (let i = 0; i < segments.length; i++) {
        cursor += segments[i].content.length
        if (at < cursor) { segAt = i; break }
      }
      if (segAt === -1 && segments.length > 0) segAt = segments.length - 1
      patternFailures.push(
        `图案「${label}」分段拼接与一次性生成不一致（首个差异字符位置 ${at}，位于第 ${segAt} 段）\n` +
        `      拼接结果（${joined.length} 字符）：${preview(joined.slice(Math.max(0, at - 30), at + 50))}\n` +
        `      一次性结果（${whole.length} 字符）：${preview(whole.slice(Math.max(0, at - 30), at + 50))}`
      )
    }

    if (patternFailures.length > 0) {
      failures.push(...patternFailures)
      summary.push({ pattern: label, segments: segments.length, ok: false })
      console.error(`  ✗ 该图案存在 ${patternFailures.length} 项校验问题，已跳过落盘`)
      continue
    }

    // 校验通过：落盘到暂存目录（旧产物仅在全部成功后替换，不会被失败的构建覆盖）
    const dir = path.join(stageRoot, patternId)
    await fs.mkdir(dir, { recursive: true })
    const pad = String(Math.max(0, segments.length - 1)).length
    await Promise.all(segments.map(seg =>
      fs.writeFile(path.join(dir, `segment-${String(seg.index).padStart(pad, '0')}.txt`), seg.content, 'utf8')
    ))
    const manifest = {
      pattern: patternId,
      name: patterns.PATTERN_NAMES[patternId],
      generatedAt: new Date().toISOString(),
      params,
      segmentCount: segments.length,
      segments: segments.map(s => ({
        index: s.index,
        file: `segment-${String(s.index).padStart(pad, '0')}.txt`,
        bytes: Buffer.byteLength(s.content, 'utf8'),
      })),
    }
    await fs.writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    console.log(`  ✓ ${segments.length} 段，拼接 ${joined.length} 字符，与一次性生成一致，已暂存`)
    summary.push({ pattern: label, segments: segments.length, ok: true })
  }

  console.log('\n[构建] 分段产出汇总：')
  for (const s of summary) console.log(`  ${s.ok ? '✓' : '✗'} ${s.pattern}: ${s.segments} 段`)

  if (failures.length > 0) {
    console.error(`\n[构建] 分段构建失败，共 ${failures.length} 项问题：`)
    for (const f of failures) console.error(`  - ${f}`)
    await fs.rm(stageRoot, { recursive: true, force: true })
    console.error('[构建] 本地产物未更新，旧的可复用分段保持不变。')
    process.exit(1)
  }
  // 全部通过：用暂存产物原子替换本地产物目录（tmp 与工作区可能跨设备，跨设备时回退为拷贝）
  await fs.rm(OUT_ROOT, { recursive: true, force: true })
  try {
    await fs.rename(stageRoot, OUT_ROOT)
  } catch (e) {
    if (e.code !== 'EXDEV') throw e
    await fs.cp(stageRoot, OUT_ROOT, { recursive: true })
    await fs.rm(stageRoot, { recursive: true, force: true })
  }
  console.log(`\n[构建] 全部图案分段校验通过，产物已保存到 ${path.relative(process.cwd(), OUT_ROOT)}/`)
}

main().catch(async e => {
  console.error('[构建] 分段构建脚本异常：', e)
  process.exit(1)
})
