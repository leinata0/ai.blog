import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * 色板对比度回归护栏。
 *
 * 背景：认证页/后台的错误文字长期硬编码 #ef4444 配 var(--danger-soft) 底，
 * 实测亮色 3.00:1、暗色 4.00:1，都低于 WCAG AA 正文要求的 4.5:1。
 * 修法是在 index.css 引入 --danger-text / --success-text / --warning-text /
 * --highlight-text 四组分主题令牌，调用点一律走令牌。
 *
 * 这个文件把「对比度计算本身」变成断言：直接读 index.css 与 auth-surface.css 的令牌值
 * → 与各自主题的画布/表面底色做 alpha 合成 → 按 WCAG 2.x 相对亮度公式算比值
 * → 断言 >= 4.5。以后任何人改色板会立刻红，不需要靠人眼复核。
 */

// 不要写成 new URL('../src', import.meta.url)：Vite 会把这个写法当成资源引用改写成
// http://localhost:3000/src，fileURLToPath 随即报 "The URL must be of scheme file"。
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const INDEX_CSS = join(SRC_DIR, 'index.css')
const AUTH_CSS = join(SRC_DIR, 'styles', 'auth-surface.css')

const AA_BODY = 4.5
const AA_LARGE = 3

// ---------------------------------------------------------------- color math

function parseColor(value) {
  const raw = String(value).trim()
  if (raw.startsWith('#')) {
    const hex = raw.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      1,
    ]
  }
  const match = raw.match(/rgba?\(([^)]+)\)/)
  if (!match) throw new Error(`无法解析颜色：${raw}`)
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
}

/** 半透明前景与不透明底色做 source-over 合成，返回不透明 RGB。 */
function composite(foreground, backgroundRgb) {
  const fg = parseColor(foreground)
  const alpha = fg[3]
  if (alpha === 1) return fg.slice(0, 3)
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + backgroundRgb[i] * (1 - alpha)))
}

/** WCAG 2.x 相对亮度。 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function opaque(value) {
  const parsed = parseColor(value)
  if (parsed[3] !== 1) throw new Error(`期望不透明颜色，实际：${value}`)
  return parsed.slice(0, 3)
}

// --------------------------------------------------------------- css parsing

function readTokenBlock(cssPath, selector) {
  const css = readFileSync(cssPath, 'utf8')
  const index = css.indexOf(selector)
  expect(index, `${cssPath} 里找不到选择器 ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', index)
  const close = css.indexOf('\n}', open)
  const body = css.slice(open + 1, close)
  const tokens = {}
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim()
  }
  return tokens
}

const baseLight = readTokenBlock(INDEX_CSS, ':root {')
const baseDark = readTokenBlock(INDEX_CSS, '[data-theme="dark"] {')
const authLight = readTokenBlock(AUTH_CSS, ':root[data-surface="auth"] {')
const authDark = readTokenBlock(AUTH_CSS, ':root[data-theme="dark"][data-surface="auth"] {')

const SURFACE_TOKENS = [
  '--bg-canvas',
  '--bg-canvas-deep',
  '--bg-surface',
  '--bg-surface-strong',
  '--bg-surface-muted',
  '--bg-elevated',
]

/**
 * 把一组令牌里的表面色解析成不透明 RGB。
 * index.css 的 --bg-surface / --bg-surface-muted 本身是半透明的，必须先压在 --bg-canvas 上，
 * 否则算出来的对比度偏乐观；auth-surface.css 里它们是实色，直接用。
 */
function surfacesOf(tokens, label) {
  const canvas = opaque(tokens['--bg-canvas'])
  const surfaces = {}
  for (const name of SURFACE_TOKENS) {
    const value = tokens[name]
    if (!value) continue
    surfaces[`${label}:${name}`] = composite(value, canvas)
  }
  return surfaces
}

/**
 * 状态色令牌只在 index.css 定义，auth 主题不覆盖它们 —— 但 auth 主题会覆盖画布，
 * 所以同一组状态色必须同时扛住 base 与 auth 两套表面。
 */
const THEMES = [
  {
    name: 'light',
    tokens: baseLight,
    surfaces: { ...surfacesOf(baseLight, 'base'), ...surfacesOf(authLight, 'auth') },
  },
  {
    name: 'dark',
    tokens: baseDark,
    surfaces: { ...surfacesOf(baseDark, 'base'), ...surfacesOf(authDark, 'auth') },
  },
]

/** 每组 = 文字令牌 + 与之配对的半透明色块令牌。 */
const STATUS_PAIRS = [
  { text: '--danger-text', soft: '--danger-soft' },
  { text: '--success-text', soft: '--success-soft' },
  { text: '--warning-text', soft: '--warning-soft' },
  { text: '--highlight-text', soft: '--highlight-soft' },
]

function worstRatios(tokens, surfaces, textToken, softToken) {
  const foreground = opaque(tokens[textToken])
  const rows = []
  for (const [surfaceName, surfaceRgb] of Object.entries(surfaces)) {
    // 1) 文字压在状态色块上（色块半透明，先与该表面合成）
    rows.push([`${surfaceName}+soft`, contrastRatio(foreground, composite(tokens[softToken], surfaceRgb))])
    // 2) 文字直接压在表面上（删除按钮之类没有色块底的场景）
    rows.push([surfaceName, contrastRatio(foreground, surfaceRgb)])
  }
  return rows
}

describe('状态色令牌在两套主题下都满足 WCAG AA', () => {
  it.each(THEMES)('$name 主题定义了全部状态色令牌', ({ tokens }) => {
    for (const { text, soft } of STATUS_PAIRS) {
      expect(tokens[text], `缺少 ${text}`).toBeTruthy()
      expect(tokens[soft], `缺少 ${soft}`).toBeTruthy()
    }
  })

  it('两套主题都覆盖到了 base 与 auth 的画布（防止漏测新表面）', () => {
    for (const { name, surfaces } of THEMES) {
      const keys = Object.keys(surfaces)
      expect(keys.some((k) => k.startsWith('base:')), `${name} 缺 base 表面`).toBe(true)
      expect(keys.some((k) => k.startsWith('auth:')), `${name} 缺 auth 表面`).toBe(true)
      expect(keys.length).toBeGreaterThanOrEqual(9)
    }
  })

  for (const { name, tokens, surfaces } of THEMES) {
    for (const { text, soft } of STATUS_PAIRS) {
      it(`${name} / ${text} 配 ${soft} 及所有画布 >= ${AA_BODY}:1`, () => {
        const failures = worstRatios(tokens, surfaces, text, soft)
          .filter(([, ratio]) => ratio < AA_BODY)
          .map(([label, ratio]) => `${label}=${ratio.toFixed(2)}`)

        expect(failures, `${name} ${text} 低于 AA 的组合：${failures.join(', ')}`).toEqual([])
      })
    }
  }

  it('文字令牌同时满足大字号/图标的 3:1 下限，因此不需要额外的 --danger-strong', () => {
    for (const { tokens, surfaces } of THEMES) {
      for (const { text, soft } of STATUS_PAIRS) {
        for (const [, ratio] of worstRatios(tokens, surfaces, text, soft)) {
          expect(ratio).toBeGreaterThanOrEqual(AA_LARGE)
        }
      }
    }
  })

  it('修复前的旧硬编码色确实不达标（说明这组令牌不是多余的）', () => {
    const light = THEMES[0]
    const dark = THEMES[1]

    // 亮色：#ef4444 压在 --danger-soft/--bg-canvas 上约 3.0:1
    const legacyLight = contrastRatio(
      opaque('#ef4444'),
      composite(light.tokens['--danger-soft'], light.surfaces['base:--bg-canvas']),
    )
    expect(legacyLight).toBeLessThan(AA_BODY)

    // 暗色：#ef4444 压在 --danger-soft/--bg-surface-strong 上约 4.0:1
    const legacyDark = contrastRatio(
      opaque('#ef4444'),
      composite(dark.tokens['--danger-soft'], dark.surfaces['base:--bg-surface-strong']),
    )
    expect(legacyDark).toBeLessThan(AA_BODY)
  })

  /**
   * --accent 是品牌主色，不在这次状态色收口的改动范围内。
   * 已知缺口：亮色下 --accent 压在 --accent-soft 上，base 的 --bg-canvas-deep 为 4.31:1、
   * auth 的 --bg-canvas-deep 为 3.27:1，都不到 AA 正文线。实际调用点（section-kicker /
   * term-tag / 页脚小标题）基本是大字号或加粗短标签，先按 3:1 兜底锁住，避免继续劣化；
   * 是否调整品牌主色是设计决策，留给后续单独一轮处理。
   */
  it('--accent 至少守住 3:1（品牌主色的 AA 缺口是已知项，另行处理）', () => {
    for (const { name, tokens, surfaces } of THEMES) {
      const failures = worstRatios(tokens, surfaces, '--accent', '--accent-soft')
        .filter(([, ratio]) => ratio < AA_LARGE)
        .map(([label, ratio]) => `${label}=${ratio.toFixed(2)}`)
      expect(failures, `${name} --accent 跌破 3:1：${failures.join(', ')}`).toEqual([])
    }
  })
})

// ------------------------------------------------------------- source sweep

function collectSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc)
    else if (/\.(jsx|js)$/.test(entry)) acc.push(full)
  }
  return acc
}

/** 注释里会引用旧色值做说明，扫描时要先剔除，否则文档本身会把用例弄红。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * 这些十六进制值曾经被当作「前景色」硬编码在组件里，配的都是半透明色块或主题表面，
 * 换主题就会掉到 AA 以下。它们必须走令牌，不允许再裸写。
 */
const BANNED_FOREGROUND_HEX = [
  // danger
  '#ef4444', '#f87171', '#fca5a5', '#991b1b',
  // success
  '#047857', '#16a34a', '#22c55e', '#10b981', '#34d399', '#065f46',
  // warning
  '#b45309', '#a16207', '#d97706', '#92400e',
  // 品牌蓝高亮药丸（周报标签 / 精选主题 / 订阅 CTA）
  '#1d4ed8', '#2563eb',
]

/**
 * 白名单 = 有意保留的硬编码色。
 *
 * 判据：底色是**不透明且不随主题变化**的（实色填充 / 不透明渐变）。这类地方换成主题令牌，
 * 反而会在另一个主题下失衡 —— 例如把 --danger-text 用到实色红按钮上，暗色主题会变成
 * 浅红底配白字（约 1.7:1）。同类先例：白底药丸上的 #2563eb 保留硬编码，因为 --accent
 * 在暗色下是青色。
 */
const ALLOWED_HARDCODED = [
  {
    file: 'components/ui/ConfirmDialog.jsx',
    hexes: ['#dc2626', '#b91c1c'],
    reason: '危险操作按钮是不透明实色填充 + 固定白字，两个主题渲染一致；白字对 #dc2626 为 4.83:1、对 hover 的 #b91c1c 为 6.47:1。',
  },
  {
    file: 'pages/PostDetailPage.jsx',
    hexes: ['#FEF3C7', '#FBBF24', '#78350F'],
    reason: '「编辑推荐」药丸是不透明琥珀渐变，不随主题变化；#78350F 在渐变两端为 8.15:1 / 5.43:1。',
  },
  {
    file: 'components/SeriesEditorialStack.jsx',
    hexes: ['#2563eb'],
    reason: '这颗药丸压在封面图上的 rgba(255,255,255,0.84) 近白底，不随主题变化，换成 --highlight-text 在暗色下会变成浅蓝配近白底。注意：它本身随封面图明暗在 3.76~5.17:1 之间浮动，属于既有问题，已在收口报告中单列。',
  },
]

describe('源码里不再裸写需要走令牌的状态色', () => {
  it('src/**/*.{jsx,js} 中没有未白名单的硬编码状态色', () => {
    const offenders = []

    for (const file of collectSourceFiles(SRC_DIR)) {
      const rel = relative(SRC_DIR, file).replace(/\\/g, '/')
      const allowed = ALLOWED_HARDCODED.find((entry) => entry.file === rel)
      const source = stripComments(readFileSync(file, 'utf8'))

      for (const hex of BANNED_FOREGROUND_HEX) {
        if (!new RegExp(hex, 'i').test(source)) continue
        if (allowed?.hexes.some((allowedHex) => allowedHex.toLowerCase() === hex.toLowerCase())) continue
        offenders.push(`${rel} -> ${hex}`)
      }
    }

    expect(offenders, `这些位置应改用 --danger-text / --success-text / --warning-text：\n${offenders.join('\n')}`).toEqual([])
  })

  it('白名单里保留的固定底色配色仍然达标', () => {
    // ConfirmDialog：实色按钮 + 白字
    expect(contrastRatio([255, 255, 255], opaque('#dc2626'))).toBeGreaterThanOrEqual(AA_BODY)
    expect(contrastRatio([255, 255, 255], opaque('#b91c1c'))).toBeGreaterThanOrEqual(AA_BODY)

    // PostDetailPage：琥珀渐变两端 + 深棕字
    expect(contrastRatio(opaque('#78350F'), opaque('#FEF3C7'))).toBeGreaterThanOrEqual(AA_BODY)
    expect(contrastRatio(opaque('#78350F'), opaque('#FBBF24'))).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('白名单条目都写了保留理由，且对应文件仍然存在', () => {
    const files = new Set(
      collectSourceFiles(SRC_DIR).map((file) => relative(SRC_DIR, file).replace(/\\/g, '/')),
    )
    for (const entry of ALLOWED_HARDCODED) {
      expect(files.has(entry.file), `白名单指向了不存在的文件：${entry.file}`).toBe(true)
      expect(entry.reason.length).toBeGreaterThan(10)
    }
  })

  it('白名单文件确实写了保留理由的注释（防止后人误删硬编码色）', () => {
    for (const entry of ALLOWED_HARDCODED) {
      const source = readFileSync(join(SRC_DIR, entry.file), 'utf8')
      expect(source, `${entry.file} 缺少「保留固定色」的说明注释`).toMatch(/保留固定色/)
    }
  })
})
