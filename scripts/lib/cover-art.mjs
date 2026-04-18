import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const COVER_ART_CONFIG_PATH = resolve(__dirname, '..', 'config', 'cover-art-direction.json')
const MANUAL_PROMPT_PREFIX_RE = /^(?:wide|horizontal|landscape|vertical|4:5|banner|poster|cinematic|high quality|premium|homepage hero)[^:]*:\s*/i

let coverArtConfigCache = null

export function loadCoverArtConfig() {
  if (coverArtConfigCache) return coverArtConfigCache

  let parsed = {}
  try {
    parsed = JSON.parse(readFileSync(COVER_ART_CONFIG_PATH, 'utf8'))
  } catch {
    parsed = {}
  }

  const presets = parsed?.presets && typeof parsed.presets === 'object' ? parsed.presets : {}
  coverArtConfigCache = {
    version: String(parsed?.version || '2026-04-editorial-tech-v1').trim(),
    brand_palette: Array.isArray(parsed?.brand_palette) ? parsed.brand_palette.map((item) => String(item || '').trim()).filter(Boolean) : [],
    brand_motifs: Array.isArray(parsed?.brand_motifs) ? parsed.brand_motifs.map((item) => String(item || '').trim()).filter(Boolean) : [],
    layout_rules: Array.isArray(parsed?.layout_rules) ? parsed.layout_rules.map((item) => String(item || '').trim()).filter(Boolean) : [],
    negative_rules: Array.isArray(parsed?.negative_rules) ? parsed.negative_rules.map((item) => String(item || '').trim()).filter(Boolean) : [],
    presets: Object.fromEntries(
      Object.entries(presets)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([key, value]) => [
          key,
          {
            label: String(value.label || '').trim(),
            orientation: String(value.orientation || '').trim(),
            framing_hint: String(value.framing_hint || '').trim(),
            prompt_clause: String(value.prompt_clause || '').trim(),
            safe_area_clause: String(value.safe_area_clause || '').trim(),
          },
        ]),
    ),
  }
  return coverArtConfigCache
}

export function coverArtVersion() {
  return String(loadCoverArtConfig().version || '').trim()
}

export function presetFramingHint(preset) {
  const details = loadCoverArtConfig().presets?.[preset]
  return String(details?.framing_hint || '').trim() || 'Wide landscape editorial banner, high quality'
}

export function sanitizeCoverPrompt(prompt) {
  return String(prompt || '')
    .trim()
    .replace(/\n/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(MANUAL_PROMPT_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripMarkdown(value, maxChars = 320) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}...`
}

export function extractHeadings(contentMd, limit = 6) {
  const headings = String(contentMd || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^##+\s+(.*)$/)?.[1]?.trim() || '')
    .filter(Boolean)
  return headings.slice(0, limit)
}

export function buildPromptContext(post = {}) {
  return {
    title: String(post?.title || '').trim(),
    summary: stripMarkdown(post?.summary || '', 220),
    headings: extractHeadings(post?.content_md || '', 4),
    tags: Array.isArray(post?.tags)
      ? post.tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name || tag?.slug || '')).map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    contentType: String(post?.content_type || 'post').trim(),
    topicKey: String(post?.topic_key || '').trim(),
    bodyPreview: stripMarkdown(post?.content_md || '', 600),
  }
}

function buildBrandClause(config) {
  const palette = config.brand_palette.join(', ')
  const motifs = config.brand_motifs.join(', ')
  const layout = config.layout_rules.join(', ')
  return `Use a blue-white editorial technology aesthetic with ${palette}. Include ${motifs}. Keep ${layout}.`
}

function buildNegativeClause(config) {
  return `Strictly exclude ${config.negative_rules.join(', ')}.`
}

function buildContentClause(preset, contentHint, extraHints = []) {
  const defaults = {
    site_hero: 'Express a curated AI editorial identity instead of a literal product advertisement.',
    post_cover: 'Translate the article topic into one strong abstract visual metaphor rather than a literal screenshot.',
    series_cover: 'Express a stable recurring content lane instead of a one-off news event.',
    topic_cover: 'Express continuity, momentum, and long-term topic tracking instead of a single news moment.',
  }
  return [
    defaults[preset] || 'Use one polished editorial visual metaphor.',
    contentHint,
    ...extraHints.filter(Boolean),
  ].filter(Boolean).join(' ')
}

export function buildCoverPrompt(preset, { manualPrompt = '', contentHint = '', extraHints = [] } = {}) {
  const config = loadCoverArtConfig()
  const presetDetails = config.presets?.[preset] || {}
  const sanitizedManual = sanitizeCoverPrompt(manualPrompt)
  return [
    presetDetails.prompt_clause || '',
    buildBrandClause(config),
    presetDetails.safe_area_clause || '',
    buildContentClause(preset, sanitizedManual || contentHint, extraHints),
    buildNegativeClause(config),
  ].filter(Boolean).join(' ').trim()
}

export function buildSiteHeroPrompt(settings = {}, { manualPrompt = '' } = {}) {
  const extraHints = []
  if (String(settings?.author_name || '').trim()) {
    extraHints.push(`Brand voice: curated by ${String(settings.author_name).trim()}.`)
  }
  if (String(settings?.bio || '').trim()) {
    extraHints.push(`Editorial character: ${stripMarkdown(settings.bio, 180)}.`)
  }
  return buildCoverPrompt('site_hero', {
    manualPrompt,
    contentHint: 'Show a calm, premium editorial signal wall with depth, glow, and a single strong focal structure.',
    extraHints,
  })
}

export function buildSeriesCoverPrompt(series = {}, recentPost = null, { manualPrompt = '' } = {}) {
  const extraHints = []
  if (String(series?.title || '').trim()) extraHints.push(`Series title: ${String(series.title).trim()}.`)
  if (String(series?.description || '').trim()) extraHints.push(`Series description: ${stripMarkdown(series.description, 180)}.`)
  if (String(recentPost?.title || '').trim()) extraHints.push(`Representative article: ${String(recentPost.title).trim()}.`)
  return buildCoverPrompt('series_cover', {
    manualPrompt,
    contentHint: 'Build a stable editorial banner that feels like a recurring reading lane with layered information flow.',
    extraHints,
  })
}

export function buildTopicCoverPrompt(profile = {}, recentPost = null, { manualPrompt = '' } = {}) {
  const aliases = Array.isArray(profile?.aliases)
    ? profile.aliases
    : (() => {
        try {
          return JSON.parse(profile?.aliases_json || '[]')
        } catch {
          return []
        }
      })()

  const topicName = String(profile?.title || profile?.topic_key || '').trim()
  const extraHints = []
  if (topicName) extraHints.push(`Topic: ${topicName}.`)
  if (String(profile?.description || '').trim()) extraHints.push(`Topic description: ${stripMarkdown(profile.description, 180)}.`)
  if (aliases.length > 0) extraHints.push(`Aliases: ${aliases.map((item) => String(item || '').trim()).filter(Boolean).join(', ')}.`)
  if (String(recentPost?.title || '').trim()) extraHints.push(`Recent article: ${String(recentPost.title).trim()}.`)
  if (String(recentPost?.summary || '').trim()) extraHints.push(`Recent summary: ${stripMarkdown(recentPost.summary, 180)}.`)
  return buildCoverPrompt('topic_cover', {
    manualPrompt,
    contentHint: 'Show long-term tracking energy, momentum, and structured signal flow rather than a single literal event.',
    extraHints,
  })
}

export function buildPostCoverPrompt(post = {}, { manualPrompt = '', artifactPrompt = '' } = {}) {
  const context = buildPromptContext(post)
  const extraHints = []
  if (context.title) extraHints.push(`Article title: ${context.title}.`)
  if (context.summary) extraHints.push(`Summary: ${context.summary}.`)
  if (context.headings.length > 0) extraHints.push(`Key angles: ${context.headings.slice(0, 3).join('; ')}.`)
  if (context.topicKey) extraHints.push(`Topic line: ${context.topicKey}.`)
  if (context.tags.length > 0) extraHints.push(`Signal hints: ${context.tags.slice(0, 4).join(', ')}.`)
  return buildCoverPrompt('post_cover', {
    manualPrompt: manualPrompt || artifactPrompt,
    contentHint: 'Translate the article into one clear abstract editorial metaphor that feels native to a polished tech publication.',
    extraHints,
  })
}
