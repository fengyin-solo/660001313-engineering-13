#!/usr/bin/env node
/**
 * 分段结果复用 / 按段回放工具（默认读取构建时落盘的本地产物）。
 *
 * 用法：
 *   node scripts/replay-segments.mjs list
 *       列出本地已保存的图案与段数
 *
 *   node scripts/replay-segments.mjs replay <pattern> [--index N] [--step K]
 *       [--interval MS] [--svg] [--out FILE] [--regen]
 *       按绘制顺序回放分段。
 *       --index N     只回放第 N 段（复用单段）
 *       --step K      每帧回放 K 段（默认 1）
 *       --interval MS 帧间隔毫秒（默认 60）
 *       --svg         用清单中保存的参数把帧包装成完整 <svg>
 *       --out FILE    把最终一帧写入文件（不打印逐帧内容）
 *       --regen       本地缺产物时允许按固定参数重新生成；缺失原因会写入日志
 *
 * 图案或参数缺失时在日志说明原因并以非零码退出，绝不静默跳过。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')

const OUT_ROOT = path.resolve(__dirname, '..', 'generated-segments')

function parseArgs(argv) {
  const [command, positional, ...rest] = argv
  const args = { command, pattern: positional, index: null, step: 1, interval: 60, svg: false, out: null, regen: false }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--index') args.index = Number(rest[++i])
    else if (a === '--step') args.step = Number(rest[++i])
    else if (a === '--interval') args.interval = Number(rest[++i])
    else if (a === '--svg') args.svg = true
    else if (a === '--out') args.out = rest[++i]
    else if (a === '--regen') args.regen = true
    else throw new Error(`未知参数：${a}`)
  }
  return args
}

async function loadPatternsModule() {
  const tsPath = path.resolve(__dirname, '..', 'src', 'generators', 'patterns.ts')
  const source = ts.sys.readFile(tsPath)
  if (source === undefined) throw new Error(`无法读取生成器源码：${tsPath}`)
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, isolatedModules: true },
    fileName: 'patterns.ts',
  })
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seg-replay-'))
  const outPath = path.join(tempDir, 'patterns.mjs')
  await fs.writeFile(outPath, out.outputText, 'utf8')
  return import(pathToFileURL(outPath).href + `?t=${Date.now()}`)
}

/** 读取本地产物；缺失时说明原因，--regen 才允许用清单/固定参数重生成 */
async function loadLocal(patterns, patternId, allowRegen) {
  const dir = path.join(OUT_ROOT, patternId)
  const manifestPath = path.join(dir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (e) {
    if (!allowRegen) {
      throw new Error(
        `本地缺少图案「${patternId}」的分段产物（${manifestPath}：${e.code === 'ENOENT' ? '文件不存在' : e.message}）。\n` +
        '请先运行 `npm run build:segments` 生成本地产物；或追加 --regen 按固定参数临时重新生成。'
      )
    }
    console.error(`[回放] 警告：本地无图案「${patternId}」产物（${e.code === 'ENOENT' ? 'manifest.json 不存在' : e.message}），改用固定参数重新生成。`)
    const fallbackParams = {
      seed: 42, width: 800, height: 1000, iterations: 300, scale: 1,
      strokeWidth: 1.5, opacity: 0.8,
      palette: ['#ff6b35', '#f7c59f', '#efefd0', '#004e89', '#1a659e'],
    }
    return {
      manifest: { pattern: patternId, params: fallbackParams, segmentCount: patterns.getSegmentCount(patternId, fallbackParams) },
      contents: patterns.generateSegmentList(patternId, fallbackParams).map(s => s.content),
    }
  }

  if (manifest.pattern !== patternId) {
    throw new Error(`本地清单图案标记为 "${manifest.pattern}"，与请求的 "${patternId}" 不符，拒绝复用。`)
  }
  const problems = patterns.validatePatternParams(patternId, manifest.params)
  if (problems.length > 0) throw new Error(`本地清单中的参数缺失或非法，无法复用：\n${problems.map(r => `  - ${r}`).join('\n')}`)

  const contents = new Array(manifest.segments.length)
  for (const entry of manifest.segments) {
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= manifest.segments.length) {
      throw new Error(`本地清单段序号异常：${entry.index}（共 ${manifest.segments.length} 段），拒绝复用。`)
    }
    contents[entry.index] = await fs.readFile(path.join(dir, entry.file), 'utf8')
  }
  const missing = contents.map((c, i) => (c === undefined ? i : -1)).filter(i => i >= 0)
  if (missing.length > 0) throw new Error(`本地分段文件缺失第 ${missing.join('、')} 段，无法回放。`)
  return { manifest, contents }
}

function wrapSvg(contents, params) {
  const body = contents.join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">
  <rect width="${params.width}" height="${params.height}" fill="#030712"/>
  <g transform="rotate(0,${params.width / 2},${params.height / 2})">${body}</g>
</svg>`
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const patterns = await loadPatternsModule()

  if (args.command === 'list') {
    let entries
    try {
      entries = await fs.readdir(OUT_ROOT, { withFileTypes: true })
    } catch {
      console.log(`(本地产物目录不存在：${OUT_ROOT})，请先运行 npm run build:segments`)
      return
    }
    let found = false
    for (const e of entries.filter(d => d.isDirectory())) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(OUT_ROOT, e.name, 'manifest.json'), 'utf8'))
        console.log(`${m.pattern.padEnd(8)} ${m.name}  ${m.segmentCount} 段  生成于 ${m.generatedAt}`)
        found = true
      } catch {
        console.error(`[list] 警告：${e.name}/manifest.json 缺失或损坏，已跳过（目录未被自动清理）`)
      }
    }
    if (!found) console.log('(本地暂无任何图案的分段产物)')
    return
  }

  if (args.command !== 'replay') {
    throw new Error(`未知命令：${args.command ?? '(空)'}。支持：list、replay`)
  }
  if (!args.pattern) throw new Error('缺少图案参数。用法：node scripts/replay-segments.mjs replay <pattern>，可选 spiral|fractal|wave|circles|noise')
  if (!patterns.PATTERN_IDS.includes(args.pattern)) {
    throw new Error(`图案类型缺失或不受支持："${args.pattern}"，当前支持：${patterns.PATTERN_IDS.join('、')}`)
  }
  if (!Number.isInteger(args.step) || args.step < 1) throw new Error(`--step 必须是不小于 1 的整数，实际：${args.step}`)
  if (!(args.interval >= 0)) throw new Error(`--interval 必须是非负数字，实际：${args.interval}`)

  const { manifest, contents } = await loadLocal(patterns, args.pattern, args.regen)
  const total = contents.length

  if (args.index !== null) {
    if (!Number.isInteger(args.index) || args.index < 0 || args.index >= total) {
      throw new Error(`图案「${patterns.PATTERN_NAMES[args.pattern]}」第 ${args.index} 段不存在：共 ${total} 段（合法序号 0-${total - 1}）`)
    }
    const frame = args.svg ? wrapSvg([contents[args.index]], manifest.params) : contents[args.index]
    if (args.out) {
      await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
      await fs.writeFile(args.out, frame, 'utf8')
      console.log(`[回放] 第 ${args.index} 段（${frame.length} 字符）已写入 ${args.out}`)
    } else {
      process.stdout.write(frame + '\n')
    }
    return
  }

  // 顺序回放：每帧多铺 step 段
  if (args.out) {
    const frame = args.svg ? wrapSvg(contents, manifest.params) : contents.join('')
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
    await fs.writeFile(args.out, frame, 'utf8')
    console.log(`[回放] ${patterns.PATTERN_NAMES[args.pattern]} ${total} 段全部回放完毕（${frame.length} 字符），已写入 ${args.out}`)
    return
  }

  for (let done = 0; done < total; done += args.step) {
    const upto = Math.min(done + args.step, total)
    const frame = args.svg
      ? wrapSvg(contents.slice(0, upto), manifest.params)
      : contents.slice(done, upto).join('\n')
    process.stdout.write(`\n===== ${patterns.PATTERN_NAMES[args.pattern]}(${args.pattern}) 段 ${done}..${upto - 1} / ${total} =====\n`)
    process.stdout.write(frame + '\n')
    if (upto < total) await sleep(args.interval)
  }
}

main().catch(e => {
  console.error(`[回放] 失败：${e.message}`)
  process.exit(1)
})
