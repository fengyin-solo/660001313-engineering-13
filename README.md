# 生成艺术 SVG 海报设计器

参数化生成艺术工具，支持螺旋、分形树、波浪、圆环、噪声场五种图案，8 种颜色主题，SVG/PNG 导出。

## 功能

- 5 种图案类型：螺旋、分形树、波浪、圆环、噪声场
- 8 种预设颜色主题（日落、海洋、霓虹、森林、单色、糖果、火焰、极光）
- 种子随机数生成器（确定性重现）
- 参数实时预览：迭代数、缩放、旋转、描边、透明度
- **分段产出**：每种图案按绘制过程拆成带序号与所属图案的分段（螺旋按旋臂、分形树按枝杈、波浪按波形层、圆环按单个圆、噪声场按网格行），支持分步回放与单段复用
- **构建校验**：构建时用固定参数重跑分段产出，校验段序连续无缺失/重复、单段独立重生成一致、逐段拼接与一次性生成逐字节一致，不一致即构建失败并指出图案与段号
- SVG 矢量导出 & PNG 高清导出

## 技术栈

- React + TypeScript + Vite
- D3.js（数据处理）
- Zustand（状态管理）
- Tailwind CSS

## 运行

```bash
cd frontend && npm install && npm run dev
```

## 构建

`npm run build` 会先跑分段产出校验，再进行 TypeScript 检查与 Vite 打包；任一分段不一致都会使构建失败：

```bash
npm run build:segments   # 仅跑分段产出 + 校验 + 落盘
npm run build            # build:segments && tsc && vite build
```

校验内容（每种图案）：

1. 段序号必须为连续的 `0..n-1`，无缺失、无重复，每段的图案归属标记正确；
2. 每段用同一份固定参数独立重生成（`generateSegmentAt`），必须与批量产出的该段逐字节一致；
3. 各段按序拼接，必须与一次性生成（`renderPattern`）逐字节一致；
4. 参数或图案缺失时在日志中逐条说明原因，不静默跳过。

全部通过后，分段结果才会原子写入 `frontend/generated-segments/<pattern>/`（`manifest.json` + 每段一个 `segment-NNN.txt`）；校验失败时旧产物保持不变。

## 分段复用与回放

画布下方的「▶ 分段回放」按钮可在界面上按绘制顺序逐段重放；命令行可复用落盘产物：

```bash
# 列出本地已保存的分段
npm run replay:segments -- list

# 按顺序回放整串（每帧 1 段，间隔 60ms）
npm run replay:segments -- replay spiral

# 只取第 3 段（复用单段），并包装成完整 SVG 写入文件
npm run replay:segments -- replay fractal --index 3 --svg --out frame.svg

# 每帧 10 段快速回放；本地缺产物时报错说明原因，加 --regen 才临时重生成
npm run replay:segments -- replay circles --step 10 --regen
```

## 生成器 API（`src/generators/patterns.ts`）

| API | 用途 |
| --- | --- |
| `generateSegments(pattern, params)` | 惰性逐段产出 `{ index, pattern, content }`，可边生成边回放 |
| `generateSegmentList(pattern, params)` | 一次性取得全部分段 |
| `generateSegmentAt(pattern, params, index)` | 从固定参数独立重生成指定段（复用单段/对比两次生成） |
| `renderPattern(pattern, params)` | 一次性生成整串（拼接校验的参照） |
| `getSegmentCount(pattern, params)` | 段总数 |
| `validatePatternParams(pattern, params)` | 返回参数/图案缺失等全部原因（空数组为通过） |
