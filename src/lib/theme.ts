/** 主题令牌与配色派生。全部是纯函数：同样的输入永远得到同样的 #rrggbb，不读写 DOM。 */

export type ThemeId = 'classic' | 'ice' | 'azure' | 'mint' | 'lilac' | 'custom'

export interface ThemePreference {
  preset: ThemeId
  /** 自定义主色，始终是 #rrggbb */
  accent: string
  /** 自定义背景，始终是 #rrggbb */
  ground: string
}

export interface ThemeTokens {
  ground: string
  workbench: string
  surface: string
  raised: string
  active: string
  frame: string
  frameInk: string
  border: string
  rule: string
  control: string
  inputRule: string
  text: string
  muted: string
  faint: string
  accent: string
  accentInk: string
  accentWash: string
  addressInk: string
  positive: string
  positiveWash: string
  negative: string
  negativeWash: string
  warning: string
  warningWash: string
}

export const THEME_STORAGE_KEY = 'ladderlab.theme.v1'

export const DEFAULT_THEME: ThemePreference = {
  preset: 'classic',
  accent: '#0f6b7a',
  ground: '#f0f1ef',
}

const WHITE = '#ffffff'
const BLACK = '#000000'
const INK_BASE = '#0b1a20'
/** 自定义主题遇到非法输入时的兜底颜色，与默认主题保持一致。 */
const DEFAULT_ACCENT = '#0f6b7a'
const DEFAULT_GROUND = '#f0f1ef'
const LIGHT_GROUND_LUMINANCE = 0.9
/** 二分查找使用固定迭代次数，结果不随设备性能变化。 */
const SEARCH_STEPS = 30

export const THEME_PRESETS: ReadonlyArray<{
  id: Exclude<ThemeId, 'custom'>
  name: string
  note: string
  swatch: string
  tokens: ThemeTokens
}> = [
  {
    id: 'classic',
    name: '原版绿',
    note: '最初版本，默认',
    swatch: '#0f6b7a',
    tokens: {
      ground: '#f0f1ef',
      workbench: '#e4e8e1',
      surface: '#ffffff',
      raised: '#f6f7f5',
      active: '#eaebe8',
      frame: '#e9ebe8',
      frameInk: '#151816',
      border: '#dcdfda',
      rule: '#e8eae5',
      control: '#c2c7c0',
      inputRule: '#a3ada5',
      text: '#151816',
      muted: '#49504b',
      faint: '#697069',
      accent: '#0f6b7a',
      accentInk: '#0a4c58',
      accentWash: '#e3eef0',
      addressInk: '#2f847c',
      positive: '#157347',
      positiveWash: '#e8f3ec',
      negative: '#b3261e',
      negativeWash: '#f8e8e6',
      warning: '#8a5a13',
      warningWash: '#f7f0e2',
    },
  },
  {
    id: 'ice',
    name: '冰湖青',
    note: '清透冷调',
    swatch: '#0a7e93',
    tokens: {
      ground: '#f2f8fb',
      workbench: '#e6f1f7',
      surface: '#ffffff',
      raised: '#f7fbfd',
      active: '#e8f3f7',
      frame: '#fbfdff',
      frameInk: '#102936',
      border: '#d5e5ed',
      rule: '#e8f2f6',
      control: '#afc8d3',
      inputRule: '#8ca7b3',
      text: '#112936',
      muted: '#4b6270',
      faint: '#5b7180',
      accent: '#0a7e93',
      accentInk: '#075d6a',
      accentWash: '#e1f4f8',
      addressInk: '#0a7e93',
      positive: '#0a7a57',
      positiveWash: '#e6f7ef',
      negative: '#c03d4b',
      negativeWash: '#fdeff1',
      warning: '#9a5f10',
      warningWash: '#fdf5e7',
    },
  },
  {
    id: 'azure',
    name: '晴空蓝',
    note: '干净利落，偏产品感',
    swatch: '#1976d2',
    tokens: {
      ground: '#f3f8ff',
      workbench: '#e7f0fc',
      surface: '#ffffff',
      raised: '#f8fbff',
      active: '#e9f2ff',
      frame: '#fbfdff',
      frameInk: '#122a3e',
      border: '#d6e4f4',
      rule: '#e9f1fb',
      control: '#b3c9e3',
      inputRule: '#8fa9c6',
      text: '#122a3e',
      muted: '#4d6378',
      faint: '#5b7287',
      accent: '#1976d2',
      accentInk: '#0c549e',
      accentWash: '#e5f1ff',
      addressInk: '#1477b9',
      positive: '#0a7a57',
      positiveWash: '#e7f7f0',
      negative: '#c03d4b',
      negativeWash: '#fdeff1',
      warning: '#9a5f10',
      warningWash: '#fbf4e6',
    },
  },
  {
    id: 'mint',
    name: '薄荷绿',
    note: '柔和护眼，偏自然',
    swatch: '#0a8478',
    tokens: {
      ground: '#f4faf8',
      workbench: '#e7f3ef',
      surface: '#ffffff',
      raised: '#f9fcfb',
      active: '#eaf5f1',
      frame: '#fbfdfc',
      frameInk: '#112c28',
      border: '#d8e8e3',
      rule: '#eaf5f1',
      control: '#b0cbc3',
      inputRule: '#8fada4',
      text: '#112c28',
      muted: '#4c6660',
      faint: '#5c7069',
      accent: '#0a8478',
      accentInk: '#076158',
      accentWash: '#e2f7f2',
      addressInk: '#0a8478',
      positive: '#0a7a57',
      positiveWash: '#e7f7f0',
      negative: '#c03d4b',
      negativeWash: '#fdeff1',
      warning: '#9a5f10',
      warningWash: '#fbf4e6',
    },
  },
  {
    id: 'lilac',
    name: '晨雾紫',
    note: '安静柔和，偏创作感',
    swatch: '#7a5cd6',
    tokens: {
      ground: '#f7f6fc',
      workbench: '#eceaf8',
      surface: '#ffffff',
      raised: '#fbfaff',
      active: '#f0edfa',
      frame: '#fcfbff',
      frameInk: '#201a35',
      border: '#ded8ee',
      rule: '#eeeaf7',
      control: '#b9b2d0',
      inputRule: '#9a93b3',
      text: '#201a35',
      muted: '#565072',
      faint: '#6c6688',
      accent: '#7a5cd6',
      accentInk: '#5940ad',
      accentWash: '#f0ecfe',
      addressInk: '#7a5cd6',
      positive: '#0a7a57',
      positiveWash: '#eaf7f2',
      negative: '#c03d4b',
      negativeWash: '#fdeff1',
      warning: '#9a5f10',
      warningWash: '#fbf4e6',
    },
  },
]

const HEX_PATTERN = /^#[0-9a-f]{6}$/i
const THEME_IDS: ReadonlyArray<ThemeId> = ['classic', 'ice', 'azure', 'mint', 'lilac', 'custom']

/** 只接受 #rrggbb；简写、缺井号、非十六进制一律返回 null。 */
export function parseHexColor(value: string): [number, number, number] | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!HEX_PATTERN.test(text)) return null
  const numeric = Number.parseInt(text.slice(1), 16)
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff]
}

function channelHex(value: number): string {
  const safe = Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0
  return safe.toString(16).padStart(2, '0')
}

export function toHexColor(rgb: [number, number, number]): string {
  return `#${channelHex(rgb[0])}${channelHex(rgb[1])}${channelHex(rgb[2])}`
}

function linearize(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x 相对亮度；无法解析的颜色按黑色处理，调用方不会收到 NaN。 */
export function relativeLuminance(color: string): number {
  const rgb = parseHexColor(color)
  if (!rgb) return 0
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/** weight 是 b 的占比（0..1），越界与非法值收敛到合法区间。 */
export function mixHex(a: string, b: string, weight: number): string {
  const from = parseHexColor(a) ?? [0, 0, 0]
  const to = parseHexColor(b) ?? [0, 0, 0]
  const ratio = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0
  return toHexColor([
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ])
}

/** 朝黑或白二分调整，直到前景色在给定背景上达到 minRatio。 */
export function ensureContrast(fg: string, bg: string, minRatio: number): string {
  const background = parseHexColor(bg)
  const backgroundHex = background ? toHexColor(background) : WHITE
  const foreground = parseHexColor(fg)
  const start = foreground ? toHexColor(foreground) : BLACK
  const target = Number.isFinite(minRatio) ? Math.max(1, minRatio) : 4.5
  if (contrastRatio(start, backgroundHex) >= target) return start

  const towardBlack = contrastRatio(BLACK, backgroundHex) >= contrastRatio(WHITE, backgroundHex)
  const extreme = towardBlack ? BLACK : WHITE
  if (contrastRatio(extreme, backgroundHex) < target) return extreme

  let low = 0
  let high = 1
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2
    if (contrastRatio(mixHex(start, extreme, middle), backgroundHex) >= target) high = middle
    else low = middle
  }
  const candidate = mixHex(start, extreme, high)
  return contrastRatio(candidate, backgroundHex) >= target ? candidate : extreme
}

/** 往白色里混，直到相对亮度达标，浅色底上的深色文字才稳。 */
export function ensureLightBackground(color: string): string {
  const parsed = parseHexColor(color)
  const start = parsed ? toHexColor(parsed) : DEFAULT_GROUND
  if (relativeLuminance(start) >= LIGHT_GROUND_LUMINANCE) return start

  let low = 0
  let high = 1
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2
    if (relativeLuminance(mixHex(start, WHITE, middle)) >= LIGHT_GROUND_LUMINANCE) high = middle
    else low = middle
  }
  const candidate = mixHex(start, WHITE, high)
  return relativeLuminance(candidate) >= LIGHT_GROUND_LUMINANCE ? candidate : WHITE
}

/** 自定义主题：先把用户颜色收敛到可读区间，再按固定配比派生整套令牌。 */
export function deriveCustomTheme(accent: string, ground: string): ThemeTokens {
  const accentSource = parseHexColor(accent) ? accent.trim() : DEFAULT_ACCENT
  const groundSource = parseHexColor(ground) ? ground.trim() : DEFAULT_GROUND
  const accentSafe = ensureContrast(accentSource, WHITE, 4.6)
  const groundSafe = ensureLightBackground(groundSource)
  const text = ensureContrast(mixHex(accentSafe, INK_BASE, 0.88), WHITE, 14)
  const positive = '#0a7a57'
  const negative = '#c03d4b'
  const warning = '#9a5f10'
  const accentWash = mixHex(accentSafe, WHITE, 0.92)

  return {
    ground: groundSafe,
    workbench: mixHex(groundSafe, accentSafe, 0.10),
    surface: WHITE,
    raised: mixHex(groundSafe, WHITE, 0.55),
    active: mixHex(groundSafe, accentSafe, 0.12),
    frame: mixHex(groundSafe, WHITE, 0.70),
    frameInk: ensureContrast(mixHex(accentSafe, INK_BASE, 0.85), WHITE, 12),
    border: mixHex(groundSafe, accentSafe, 0.22),
    rule: mixHex(groundSafe, accentSafe, 0.10),
    control: mixHex(groundSafe, accentSafe, 0.42),
    inputRule: mixHex(groundSafe, accentSafe, 0.55),
    text,
    muted: ensureContrast(mixHex(text, groundSafe, 0.55), WHITE, 4.8),
    faint: ensureContrast(mixHex(text, groundSafe, 0.42), WHITE, 4.5),
    accent: accentSafe,
    accentInk: ensureContrast(accentSafe, accentWash, 5.2),
    accentWash,
    addressInk: ensureContrast(accentSafe, WHITE, 4.5),
    positive,
    positiveWash: mixHex(positive, WHITE, 0.90),
    negative,
    negativeWash: mixHex(negative, WHITE, 0.92),
    warning,
    warningWash: mixHex(warning, WHITE, 0.90),
  }
}

export function resolveTheme(pref: ThemePreference): ThemeTokens {
  if (pref.preset === 'custom') return deriveCustomTheme(pref.accent, pref.ground)
  const preset = THEME_PRESETS.find((entry) => entry.id === pref.preset)
  return { ...(preset ?? THEME_PRESETS[0]).tokens }
}

/** 每个令牌对应一个 --kebab-case 变量，供 CSS 变量表直接展开。 */
export function themeCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(tokens)) {
    vars[`--${toKebabCase(key)}`] = value
  }
  return vars
}

/** accentInk -> accent-ink，CSS 自定义属性只认短横线式命名。 */
function toKebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId)
}

function normalizePreference(value: unknown): ThemePreference | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isThemeId(record.preset)) return null
  const accent = typeof record.accent === 'string' ? parseHexColor(record.accent) : null
  const ground = typeof record.ground === 'string' ? parseHexColor(record.ground) : null
  if (!accent || !ground) return null
  return {
    preset: record.preset,
    accent: toHexColor(accent),
    ground: toHexColor(ground),
  }
}

/** 读取失败、内容损坏或字段非法都整体回退默认主题，绝不抛异常。 */
export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | null,
): ThemePreference {
  if (!storage) return { ...DEFAULT_THEME }
  let raw: string | null
  try {
    raw = storage.getItem(THEME_STORAGE_KEY)
  } catch {
    return { ...DEFAULT_THEME }
  }
  if (raw === null || raw.trim() === '') return { ...DEFAULT_THEME }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_THEME }
  }
  return normalizePreference(parsed) ?? { ...DEFAULT_THEME }
}

export function persistThemePreference(
  storage: Pick<Storage, 'setItem'> | null,
  pref: ThemePreference,
): void {
  if (!storage) return
  try {
    storage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preset: pref.preset, accent: pref.accent, ground: pref.ground }),
    )
  } catch {
    // 隐私模式或配额用尽时主题仍然可用，只是不记住选择。
  }
}
