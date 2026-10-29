/** 浏览器画布上限：单边 30000 px，整张约 1.4 亿像素，超过就会静默画不出来。 */
export const MAX_CANVAS_SIDE = 30000
export const MAX_CANVAS_PIXELS = 140_000_000

/** 优先 2 倍，长图逐档降倍率，保证超长工程不至于直接导不出来。 */
const EXPORT_SCALES = [2, 1.5, 1, 0.75, 0.5]

export interface CanvasPlan {
  scale: number
  pixelWidth: number
  pixelHeight: number
}

/** 返回还在浏览器上限内的最大倍率；连 0.5 倍都放不下时返回 null。 */
export function planCanvasSize(width: number, height: number): CanvasPlan | null {
  if (!(width > 0) || !(height > 0)) return null
  for (const scale of EXPORT_SCALES) {
    const pixelWidth = Math.ceil(width * scale)
    const pixelHeight = Math.ceil(height * scale)
    if (
      pixelWidth <= MAX_CANVAS_SIDE
      && pixelHeight <= MAX_CANVAS_SIDE
      && pixelWidth * pixelHeight <= MAX_CANVAS_PIXELS
    ) {
      return { scale, pixelWidth, pixelHeight }
    }
  }
  return null
}
