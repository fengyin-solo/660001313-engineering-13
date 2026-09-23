export type PatternType = 'spiral' | 'fractal' | 'wave' | 'circles' | 'noise'

export interface DesignParams {
  pattern: PatternType
  seed: number
  iterations: number
  scale: number
  rotation: number
  strokeWidth: number
  opacity: number
  bgColor: string
  palette: string[]
  width: number
  height: number
}

export interface ColorTheme {
  id: string
  name: string
  colors: string[]
}
