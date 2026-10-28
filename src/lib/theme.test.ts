import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  DEFAULT_THEME,
  deriveCustomTheme,
  ensureContrast,
  ensureLightBackground,
  mixHex,
  parseHexColor,
  persistThemePreference,
  readThemePreference,
  relativeLuminance,
  resolveTheme,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  themeCssVars,
  toHexColor,
} from './theme'
import type { ThemePreference, ThemeTokens } from './theme'

/** ThemeTokens 共 24 个字段，CSS 变量必须与之一一对应。 */
const TOKEN_KEYS = [
  'ground',
  'workbench',
  'surface',
  'raised',
  'active',
  'frame',
  'frameInk',
  'border',
  'rule',
  'control',
  'inputRule',
  'text',
  'muted',
  'faint',
  'accent',
  'accentInk',
  'accentWash',
  'addressInk',
  'positive',
  'positiveWash',
  'negative',
  'negativeWash',
  'warning',
  'warningWash',
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/

/** CSS 自定义属性按短横线命名，accentInk -> --accent-ink。 */
function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
}

function createStorage(): {
  store: Map<string, string>
  storage: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
  }
} {
  const store = new Map<string, string>()
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  }
}

function expectReadable(tokens: ThemeTokens, label: string): void {
  expect(contrastRatio(tokens.text, tokens.surface), `${label} text/surface`).toBeGreaterThanOrEqual(7)
  expect(contrastRatio(tokens.muted, tokens.surface), `${label} muted/surface`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.faint, tokens.surface), `${label} faint/surface`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.faint, tokens.raised), `${label} faint/raised`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.accent, '#ffffff'), `${label} accent/white`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.accentInk, tokens.accentWash), `${label} accentInk/wash`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.text, tokens.ground), `${label} text/ground`).toBeGreaterThanOrEqual(7)
  // 状态胶囊是 10–13px 小字，正文级 4.5:1 才够。
  expect(contrastRatio(tokens.positive, tokens.positiveWash), `${label} positive/wash`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.negative, tokens.negativeWash), `${label} negative/wash`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(tokens.warning, tokens.warningWash), `${label} warning/wash`).toBeGreaterThanOrEqual(4.5)
}

describe('主题预设', () => {
  it('提供五套中文命名预设，原版绿排第一', () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual(['classic', 'ice', 'azure', 'mint', 'lilac'])
    expect(THEME_PRESETS.map((preset) => preset.name)).toEqual([
      '原版绿',
      '冰湖青',
      '晴空蓝',
      '薄荷绿',
      '晨雾紫',
    ])
    expect(THEME_PRESETS.map((preset) => preset.note)).toEqual([
      '最初版本，默认',
      '清透冷调',
      '干净利落，偏产品感',
      '柔和护眼，偏自然',
      '安静柔和，偏创作感',
    ])
    expect(THEME_PRESETS.map((preset) => preset.swatch)).toEqual([
      '#0f6b7a',
      '#0a7e93',
      '#1976d2',
      '#0a8478',
      '#7a5cd6',
    ])
  })

  it('每套预设的令牌齐全且都是小写 #rrggbb', () => {
    for (const preset of THEME_PRESETS) {
      expect(Object.keys(preset.tokens).sort(), preset.id).toEqual([...TOKEN_KEYS].sort())
      for (const [key, value] of Object.entries(preset.tokens)) {
        expect(value, `${preset.id}.${key}`).toMatch(HEX_COLOR)
      }
    }
  })

  it('五套预设的正文与次要文字都落在可读区间', () => {
    for (const preset of THEME_PRESETS) {
      expectReadable(preset.tokens, preset.id)
    }
  })

  it('DEFAULT_THEME 指向原版绿的原始颜色', () => {
    const classic = THEME_PRESETS[0]
    expect(classic.id).toBe('classic')
    expect(DEFAULT_THEME).toEqual({
      preset: 'classic',
      accent: classic.tokens.accent,
      ground: classic.tokens.ground,
    })
    expect(THEME_STORAGE_KEY).toBe('ladderlab.theme.v1')
  })

  it('原版绿保留最初那一套令牌颜色', () => {
    expect(THEME_PRESETS[0].tokens).toEqual({
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
    })
  })
})

describe('resolveTheme', () => {
  it('预设直接取对应令牌表', () => {
    for (const preset of THEME_PRESETS) {
      const tokens = resolveTheme({ preset: preset.id, accent: '#ff00aa', ground: '#00ff00' })
      expect(tokens).toEqual(preset.tokens)
    }
  })

  it('custom 走派生逻辑，忽略预设表', () => {
    const tokens = resolveTheme({ preset: 'custom', accent: '#ffe600', ground: '#f7f7f7' })
    expect(tokens).toEqual(deriveCustomTheme('#ffe600', '#f7f7f7'))
    expect(contrastRatio(tokens.accent, '#ffffff')).toBeGreaterThanOrEqual(4.6)
  })
})

describe('自定义主题的极端输入', () => {
  it('亮黄主色配高饱和粉底仍可读', () => {
    const tokens = deriveCustomTheme('#ffe600', '#ff0066')

    expect(relativeLuminance(tokens.ground)).toBeGreaterThanOrEqual(0.9)
    expect(relativeLuminance(ensureLightBackground('#ff0066'))).toBeGreaterThanOrEqual(0.9)
    expect(contrastRatio(tokens.text, '#ffffff')).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(tokens.accent, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.muted, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.faint, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.accentInk, tokens.accentWash)).toBeGreaterThanOrEqual(5.2)
    expect(contrastRatio(tokens.positive, tokens.positiveWash)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.negative, tokens.negativeWash)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.warning, tokens.warningWash)).toBeGreaterThanOrEqual(4.5)
    for (const [key, value] of Object.entries(tokens)) {
      expect(value, key).toMatch(HEX_COLOR)
    }
  })

  it('纯黑与纯白输入也保持完整令牌', () => {
    const dark = deriveCustomTheme('#000000', '#000000')
    const light = deriveCustomTheme('#ffffff', '#ffffff')
    expect(relativeLuminance(dark.ground)).toBeGreaterThanOrEqual(0.9)
    expect(dark.surface).toBe('#ffffff')
    expect(light.ground).toBe('#ffffff')
    expect(relativeLuminance(light.ground)).toBeGreaterThanOrEqual(0.9)
    for (const tokens of [dark, light]) {
      expect(contrastRatio(tokens.text, '#ffffff')).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(tokens.accent, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens.muted, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('非法颜色不抛异常，回退到原版绿再派生', () => {
    expect(() => deriveCustomTheme('nope', '')).not.toThrow()
    const fallback = deriveCustomTheme('', 'oops')
    expect(fallback.accent).toBe('#0f6b7a')
    // 原版绿底色低于 0.9 亮度，派生时会先提亮到浅底区间。
    expect(fallback.ground).toBe('#f3f4f2')
    expect(resolveTheme({ preset: 'custom', accent: 'rgb(1,2,3)', ground: '#fff' })).toEqual(fallback)
    expect(() => resolveTheme({ preset: 'custom', accent: '#GGGGGG', ground: '#12345' })).not.toThrow()
  })
})

describe('颜色工具', () => {
  it('parseHexColor 只接受 #rrggbb', () => {
    expect(parseHexColor('#0a7e93')).toEqual([10, 126, 147])
    expect(parseHexColor('  #FFFFFF ')).toEqual([255, 255, 255])
    expect(parseHexColor('#fff')).toBeNull()
    expect(parseHexColor('0a7e93')).toBeNull()
    expect(parseHexColor('#gggggg')).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })

  it('toHexColor 输出小写并把越界通道收敛到 0..255', () => {
    expect(toHexColor([10, 126, 147])).toBe('#0a7e93')
    expect(toHexColor([300, -20, 12.6])).toBe('#ff000d')
    expect(toHexColor([0, 0, 0])).toBe('#000000')
  })

  it('mixHex 按 b 的占比线性混合', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#123456', '#abcdef', 2)).toBe('#abcdef')
    expect(mixHex('#123456', '#abcdef', -1)).toBe('#123456')
  })

  it('亮度与对比度符合 WCAG 取值', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#112936', '#ffffff')).toBeGreaterThan(7)
  })
})

describe('对比度修正', () => {
  it('ensureContrast 达标时原样返回，不足时朝黑调整', () => {
    expect(ensureContrast('#112936', '#ffffff', 4.5)).toBe('#112936')
    const adjusted = ensureContrast('#f0f0f0', '#ffffff', 4.5)
    expect(adjusted).toMatch(HEX_COLOR)
    expect(contrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ensureContrast('#f0f0f0', '#808080', 21)).toBe('#000000')
  })

  it('ensureLightBackground 把深色底提亮到 0.9 以上', () => {
    const lightened = ensureLightBackground('#ff0066')
    expect(lightened).toMatch(HEX_COLOR)
    expect(relativeLuminance(lightened)).toBeGreaterThanOrEqual(0.9)
    expect(ensureLightBackground('#ffffff')).toBe('#ffffff')
    expect(ensureLightBackground('not-a-color')).toBe('#f3f4f2')
  })
})

describe('主题偏好持久化', () => {
  it('写入后原样读回', () => {
    const { store, storage } = createStorage()
    const pref: ThemePreference = { preset: 'lilac', accent: '#123456', ground: '#fafafa' }
    persistThemePreference(storage, pref)
    expect(store.has(THEME_STORAGE_KEY)).toBe(true)
    expect(readThemePreference(storage)).toEqual(pref)
  })

  it('读取时把十六进制统一成小写', () => {
    const { store, storage } = createStorage()
    store.set(
      THEME_STORAGE_KEY,
      JSON.stringify({ preset: 'mint', accent: '#ABCDEF', ground: '#F4FAF8' }),
    )
    expect(readThemePreference(storage)).toEqual({
      preset: 'mint',
      accent: '#abcdef',
      ground: '#f4faf8',
    })
  })

  it('损坏 JSON 与非法字段整体回退默认主题', () => {
    const { store, storage } = createStorage()
    const invalid = [
      '{',
      'null',
      '[]',
      JSON.stringify({ preset: 'neon', accent: '#123456', ground: '#fafafa' }),
      JSON.stringify({ preset: 'ice', accent: 'blue', ground: '#fafafa' }),
      JSON.stringify({ preset: 'ice', accent: '#123456', ground: '#fff' }),
      JSON.stringify({ preset: 'ice', accent: '#123456' }),
    ]
    for (const raw of invalid) {
      store.set(THEME_STORAGE_KEY, raw)
      expect(readThemePreference(storage), raw).toEqual(DEFAULT_THEME)
    }
  })

  it('storage 抛异常时读取回退、写入静默', () => {
    expect(readThemePreference({
      getItem: () => {
        throw new Error('blocked')
      },
    })).toEqual(DEFAULT_THEME)
    expect(() => persistThemePreference({
      setItem: () => {
        throw new Error('quota')
      },
    }, DEFAULT_THEME)).not.toThrow()
  })

  it('null storage 既不抛异常也不写入', () => {
    expect(readThemePreference(null)).toEqual(DEFAULT_THEME)
    expect(() => persistThemePreference(null, DEFAULT_THEME)).not.toThrow()
  })

  it('空字符串或缺失键回退默认主题', () => {
    const { store, storage } = createStorage()
    expect(readThemePreference(storage)).toEqual(DEFAULT_THEME)
    store.set(THEME_STORAGE_KEY, '   ')
    expect(readThemePreference(storage)).toEqual(DEFAULT_THEME)
  })

  it('返回副本，修改它不会污染 DEFAULT_THEME', () => {
    const first = readThemePreference(null)
    first.accent = '#000000'
    expect(DEFAULT_THEME.accent).toBe('#0f6b7a')
  })
})

describe('themeCssVars', () => {
  const tokens = THEME_PRESETS[0].tokens
  const vars = themeCssVars(tokens)

  it('键与 ThemeTokens 字段一一对应', () => {
    expect(Object.keys(vars)).toHaveLength(TOKEN_KEYS.length)
    expect(Object.keys(vars).sort()).toEqual(TOKEN_KEYS.map(cssVarName).sort())
  })

  it('所有键都以 -- 开头且值仍是颜色令牌', () => {
    for (const [key, value] of Object.entries(vars)) {
      expect(key.startsWith('--'), key).toBe(true)
      expect(value, key).toMatch(HEX_COLOR)
    }
    expect(vars['--ground']).toBe(tokens.ground)
    expect(vars['--warning-wash']).toBe(tokens.warningWash)
  })

  it('复合令牌使用短横线命名，供 CSS 直接消费', () => {
    for (const key of ['accentInk', 'accentWash', 'addressInk', 'frameInk', 'inputRule', 'positiveWash']) {
      expect(vars[cssVarName(key)], key).toMatch(HEX_COLOR)
      expect(vars[`--${key}`], `${key} 不应保留驼峰变量`).toBeUndefined()
    }
    expect(vars['--accent-ink']).toBe(tokens.accentInk)
    expect(vars['--input-rule']).toBe(tokens.inputRule)
  })
})
