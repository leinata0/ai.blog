#!/usr/bin/env node
/**
 * 自动博客生成脚本 v2
 * 架构：RSS 订阅源（EN + CN）拉最新条目 → Jina Reader 抓全文 → 素材预处理（去 boilerplate / 去重 / 标注来源）
 *       → 两阶段 LLM（选题大纲 → 正文成稿）→ 管理端发布。
 * LLM：硅基流动 OpenAI 兼容接口（默认 deepseek-ai/DeepSeek-V3）。
 * 环境变量：SILICONFLOW_API_KEY（必填）、SILICONFLOW_BASE_URL、SILICONFLOW_MODEL、
 *           ADMIN_PASSWORD、BLOG_API_BASE、ADMIN_USERNAME。
 */

import { XMLParser } from "fast-xml-parser"

// ── 配置 ──

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY?.trim()
const SILICONFLOW_BASE_URL = (
  process.env.SILICONFLOW_BASE_URL?.trim() || "https://api.siliconflow.cn/v1"
).replace(/\/$/, "")
const SILICONFLOW_MODEL =
  process.env.SILICONFLOW_MODEL?.trim() || "deepseek-ai/DeepSeek-V3"
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BLOG_API_BASE = process.env.BLOG_API_BASE || "https://api.563118077.xyz"

const DRY_RUN = process.argv.includes("--dry-run")

// ── RSS 订阅源 ──

const RSS_FEEDS = [
  // AI / LLM（英文）
  { url: "https://blog.openai.com/rss/", tag: "AI", lang: "en" },
  { url: "https://www.anthropic.com/feed", tag: "AI", lang: "en" },
  { url: "https://blog.google/technology/ai/rss/", tag: "AI", lang: "en" },
  { url: "https://huggingface.co/blog/feed.xml", tag: "AI/开源", lang: "en" },
  { url: "https://simonwillison.net/atom/everything/", tag: "AI/独立博主", lang: "en" },
  // Hacker News 高分
  { url: "https://hnrss.org/newest?points=100", tag: "HackerNews", lang: "en" },
  // GitHub Trending
  { url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", tag: "GitHub", lang: "en" },
  // 中文科技
  { url: "https://sspai.com/feed", tag: "少数派", lang: "zh" },
  { url: "https://www.ruanyifeng.com/blog/atom.xml", tag: "阮一峰", lang: "zh" },
  // TechCrunch AI
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", tag: "TechCrunch", lang: "en" },
]

// Jina Reader 直读后备页（RSS 全部失败时）
const FALLBACK_URLS = [
  "https://techcrunch.com/category/artificial-intelligence/",
  "https://www.reuters.com/technology/artificial-intelligence/",
]

// ── RSS 拉取 ──

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
})

/** 拉取单个 RSS/Atom feed，返回 [{ title, link, description, pubDate, source }] */
async function fetchFeed(feed) {
  try {
    const resp = await fetch(feed.url, {
      headers: { "User-Agent": "AutoBlogBot/2.0", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return []
    const xml = await resp.text()
    const parsed = xmlParser.parse(xml)

    // RSS 2.0
    const rssItems = parsed?.rss?.channel?.item
    // Atom
    const atomEntries = parsed?.feed?.entry

    const items = rssItems || atomEntries || []
    const arr = Array.isArray(items) ? items : [items]

    return arr.slice(0, 8).map((item) => ({
      title: item.title?.["#text"] || item.title || "",
      link: item.link?.["@_href"] || item.link || item.guid || "",
      description: item.description || item.summary?.["#text"] || item.summary || item.content?.["#text"] || "",
      pubDate: item.pubDate || item.published || item.updated || "",
      source: feed.tag,
    }))
  } catch (err) {
    console.log(`   ⚠️ RSS 拉取失败 [${feed.tag}]: ${String(err.message).slice(0, 120)}`)
    return []
  }
}

/** 并行拉取所有 RSS，按发布时间排序，取最新 N 条 */
async function fetchAllFeeds(maxItems = 30) {
  console.log(`📡 并行拉取 ${RSS_FEEDS.length} 个 RSS 源…`)
  const results = await Promise.all(RSS_FEEDS.map(fetchFeed))
  const all = results.flat()
  console.log(`   ✓ 共获取 ${all.length} 条 RSS 条目`)

  // 按时间降序（最新在前），无法解析的排后面
  all.sort((a, b) => {
    const da = new Date(a.pubDate).getTime() || 0
    const db = new Date(b.pubDate).getTime() || 0
    return db - da
  })
  return all.slice(0, maxItems)
}

// ── Jina Reader（全文抓取）──

async function jinaRead(url, maxLen = 5000) {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown", "X-No-Cache": "true" },
      signal: AbortSignal.timeout(20000),
    })
    if (!resp.ok) return ""
    const text = await resp.text()
    return text.slice(0, maxLen)
  } catch {
    return ""
  }
}

/** 对 RSS 条目列表，并行用 Jina 读取全文（限制并发 5），同时提取图片 */
async function enrichWithFullText(items, concurrency = 5) {
  console.log(`📖 Jina Reader 抓取 ${items.length} 篇全文（并发 ${concurrency}）…`)
  let done = 0
  const queue = [...items]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item.link) continue
      const fullText = await jinaRead(item.link, 5000)
      if (fullText.length > 100) {
        item.images = filterImages(extractImages(fullText))
        item.fullText = fullText
        done++
      }
    }
  })
  await Promise.all(workers)
  console.log(`   ✓ 成功抓取 ${done}/${items.length} 篇全文`)
  return items
}

// ── 素材预处理 ──

/** 去除 boilerplate：导航、页脚、cookie 提示、广告等常见噪音 */
function removeBoilerplate(text) {
  return text
    .replace(/^(Skip to (?:content|main)|Navigation|Menu|Cookie|Accept all|Sign up|Subscribe|Newsletter|Advertisement|Related Articles?)[\s\S]{0,200}$/gim, "")
    .replace(/^(©|Copyright|All rights reserved|Privacy Policy|Terms of Service).*$/gim, "")
    .replace(/^\[?(Share|Tweet|Pin|Email|Print|Facebook|Twitter|LinkedIn)\]?.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ── 图片处理 ──

const IMAGE_JUNK_PATTERNS = /\b(icon|logo|avatar|badge|pixel|tracking|favicon|sprite|button|banner-ad|ads?[_-]|\.svg|1x1|spacer|blank|loading|spinner|emoji|thumb[_-]?nail.{0,5}\.(?:png|gif))\b/i

/** 从 Markdown 文本中提取图片 URL 列表 */
function extractImages(markdown) {
  const matches = [...(markdown || "").matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)]
  return matches
    .map((m) => ({ alt: m[1] || "", url: m[2].trim() }))
    .filter((img) => img.url.startsWith("http"))
}

/** 过滤垃圾图片（图标、logo、tracking pixel 等） */
function filterImages(images) {
  return images.filter((img) => {
    if (IMAGE_JUNK_PATTERNS.test(img.url)) return false
    if (IMAGE_JUNK_PATTERNS.test(img.alt)) return false
    return true
  })
}

/** HEAD 请求验证图片可访问性（并发限制） */
async function validateImages(images, concurrency = 5) {
  const valid = []
  const queue = [...images]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const img = queue.shift()
      try {
        const resp = await fetch(img.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "AutoBlogBot/2.0" },
        })
        const ct = resp.headers.get("content-type") || ""
        if (resp.ok && ct.startsWith("image/")) {
          valid.push(img)
        }
      } catch { /* skip */ }
    }
  })
  await Promise.all(workers)
  return valid
}

/** 将图片 URL 替换为代理 URL */
function proxyImageUrl(url) {
  return `${BLOG_API_BASE}/proxy-image?url=${encodeURIComponent(url)}`
}

/** 替换 content_md 中所有图片 URL 为代理 URL */
function proxyAllImages(contentMd) {
  return contentMd.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    if (url.startsWith(BLOG_API_BASE)) return match
    return `![${alt}](${proxyImageUrl(url)})`
  })
}
function deduplicateContent(content) {
  const seen = new Set()
  return content
    .split(/\n{2,}/)
    .filter((block) => {
      const trimmed = block.trim()
      if (trimmed.length < 30) return true // 短段落保留
      const fingerprint = trimmed.slice(0, 80).toLowerCase().replace(/\s+/g, " ")
      if (seen.has(fingerprint)) return false
      seen.add(fingerprint)
      // URL 级去重
      const urlMatch = trimmed.match(/https?:\/\/[^\s)]+/)
      if (urlMatch) {
        const url = urlMatch[0].replace(/[#?].*$/, "")
        if (seen.has(url)) return false
        seen.add(url)
      }
      return true
    })
    .join("\n\n")
}

/** 将 RSS 条目格式化为带来源标注的素材文本（含图片信息） */
function formatMaterials(items) {
  return items
    .map((item) => {
      const header = `【来源: ${item.source}】${item.title}`
      const body = item.fullText || item.description || ""
      const cleanBody = removeBoilerplate(body)
      let text = cleanBody.length > 50 ? `${header}\n${cleanBody}` : `${header}\n${item.description || ""}`
      if (item.images?.length) {
        const imgList = item.images.slice(0, 3).map((img) => `  - ![${img.alt}](${img.url})`).join("\n")
        text += `\n【可用图片】\n${imgList}`
      }
      return text
    })
    .join("\n\n---\n\n")
}

/** 段落边界感知截断 */
function smartTruncate(text, maxLen = 26000) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf("\n\n", maxLen)
  return cut > maxLen * 0.5 ? text.slice(0, cut) : text.slice(0, maxLen)
}

// ── 硅基流动 LLM ──

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonFromLlm(raw) {
  let s = String(raw || "").trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/m, "")
  }
  return JSON.parse(s)
}

async function callLLM(systemPrompt, userPrompt, maxTokens = 16384) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error("未配置 SILICONFLOW_API_KEY")
  }

  const url = `${SILICONFLOW_BASE_URL}/chat/completions`
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let lastError = ""
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) {
      const sec = [0, 10, 30, 60][attempt - 1]
      console.log(`   ⏳ 第 ${attempt} 轮重试，等待 ${sec}s…`)
      await sleep(sec * 1000)
    }

    let response = null
    let errText = ""

    for (const jsonMode of [true, false]) {
      const body = {
        model: SILICONFLOW_MODEL,
        messages,
        temperature: 0.55,
        top_p: 0.9,
        max_tokens: maxTokens,
      }
      if (jsonMode) body.response_format = { type: "json_object" }

      console.log(`🤖 ${SILICONFLOW_MODEL}${jsonMode ? "（JSON mode）" : ""}`)
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      errText = await response.clone().text()

      if (response.ok) break
      if (jsonMode && response.status === 400) {
        console.log("   ⚠️ JSON mode 不支持，降级普通模式…")
        continue
      }
      break
    }

    if (!response.ok) {
      lastError = errText
      if (response.status === 401 || response.status === 403) {
        throw new Error(`鉴权失败 ${response.status}: ${errText.slice(0, 350)}`)
      }
      if (response.status === 429 || response.status >= 500) continue
      throw new Error(`API ${response.status}: ${errText.slice(0, 400)}`)
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content
    if (!raw) { lastError = "content 为空"; continue }
    try {
      return parseJsonFromLlm(raw)
    } catch {
      lastError = `JSON 解析失败: ${String(raw).slice(0, 200)}`
    }
  }

  throw new Error(`LLM 多次重试失败: ${lastError.slice(0, 500)}`)
}

// ── 两阶段生成 ──

/** 阶段一：选题 + 大纲（token 消耗极少） */
async function generateOutline(materials, today) {
  console.log("📝 阶段一：LLM 选题与大纲…")
  const system = `你是一位资深中文科技博主。从用户提供的多篇素材中，选出 1-2 个最有深度、最值得展开的话题作为主线，其余可作为简短提及。

大纲要求：
- 至少 5 个章节，使用中文序号格式：「## 一、章节标题」「## 二、章节标题」
- 重点章节可包含子标题：「### 子标题」
- 所有标题必须是中文，禁止英文标题
- 大纲应体现叙事逻辑，不是新闻条目罗列

返回 JSON：{"topic":"主线话题（一句话）","outline":["## 一、中文章节标题","### 子标题（可选）","## 二、中文章节标题",...],"key_sources":["相关素材标题或URL"],"tags":["ai","llm",...],"cover_image":"从素材【可用图片】中选一张最能代表主线话题的图片URL，如果没有合适的图片则留空字符串"}`
  const user = `【${today}】以下是今日抓取的素材，请选题并生成大纲：\n\n${materials.slice(0, 12000)}`
  return callLLM(system, user, 2048)
}

/** 阶段二：根据大纲 + 素材生成完整文章 */
async function generateArticle(outline, materials, today) {
  console.log("✍️ 阶段二：LLM 正文生成…")

  const system = `# Role
你是「极客开发日志」的博主，资深独立开发者与 AI 观察员。写出的文章直接贴博客，不是内部纪要。

# 输出格式
只返回一个 JSON（无 \`\`\`，无多余文字）。
键：title、slug、summary、content_md、tags。

# 硬性约束
- content_md：纯 Markdown 正文，禁止开头写 \`#\`（一级标题由系统渲染）。
- 正文不少于 2500 字，目标 3000-4000 字。
- title：10-28 字中文标题，概括主线。禁止「日报」「周刊」「速递」及任何日期。
- slug：必须为 \`ai-daily-${today}\`。
- summary：不超过 50 字一句话，勿以「本文」「全文」「作者」开头。
- tags：小写英文 slug，必含 \`ai\`，最多 8 个。
- 禁止编造数据。素材弱就写短、标注不确定性。
- content_md 禁止 HTML，代码用围栏代码块。

# 文章结构规范（严格遵守）
参考以下结构风格，这是博客的标准格式：

1. 章节标题用 \`## 一、中文标题\` 格式（带中文序号），例如：
   - \`## 一、AI 投资的现状与趋势\`
   - \`## 二、开源社区的新动向\`
   - \`## 五、写在最后\`
2. 重点章节内可用 \`###\` 子标题进一步拆分，例如：
   - \`### 关卡一：持久化磁盘的"付费墙"\`
   - \`### 技术细节：模型架构的改进\`
3. 善用 Markdown 排版元素增强可读性：
   - **加粗**强调关键概念和重点句
   - 适当使用表格对比技术方案或数据
   - 用 \`>\` 引用块做总结金句或引用原文观点
   - 用列表（- 或 1.）整理要点，但不要通篇都是列表
4. 每个 \`##\` 章节至少 2-3 段正文，每段 3-5 句话，充分展开
5. 最后一节用 \`## X、写在最后\` 做简短总结，可加一句引用块金句
6. 所有标题必须是中文，绝对禁止英文标题

# 写作风格
- 从素材中选出的主线话题贯穿全文，其余作为简短提及或「延伸阅读」。不要写成新闻罗列。
- 禁止：「值得关注的是」「不难发现」「总而言之」「在这个快速发展的时代」「让我们拭目以待」「众所周知」
- 鼓励：直接陈述观点，用「我觉得」「说白了」「有意思的是」等口语化表达。
- 每节末尾可附原文链接供读者深入。
- 每个章节要充分展开，不要只写一两句话就结束。深入分析、举例说明、给出自己的看法。

# 图片插入规则
- 素材中标注了【可用图片】，请在正文中自然地插入这些图片（使用 Markdown 格式 \`![描述](url)\`）。
- 图片放在相关段落之间，不要放在标题紧下方，也不要连续放两张图。
- 每篇文章插入 2-5 张图片，选择与当前段落内容最相关的图片。
- 图片的 alt 文本用中文简短描述图片内容。
- 只使用素材中提供的图片 URL，不要编造图片地址。
- 如果素材中没有合适的图片，宁可不插也不要硬插不相关的图。`

  const user = `【素材日期 ${today}】

选题与大纲：
${JSON.stringify(outline, null, 2)}

原始素材：
${materials}

请按大纲撰写正文，只返回 JSON。`

  return callLLM(system, user, 16384)
}

// ── 博客 API ──

async function getAdminToken() {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  })
  if (!resp.ok) throw new Error(`登录失败: ${resp.status}`)
  return (await resp.json()).access_token
}

async function checkSlugExists(slug) {
  try {
    return (await fetch(`${BLOG_API_BASE}/api/posts/${slug}`)).ok
  } catch {
    return false
  }
}

function truncateSummary(s, max = 50) {
  const arr = Array.from(String(s || "").trim())
  return arr.length <= max ? arr.join("") : arr.slice(0, max).join("")
}

function normalizeForApi(post, fixedSlug) {
  if (!post.title || !post.content_md) {
    throw new Error("LLM 返回数据不完整（缺少 title 或 content_md），跳过发布")
  }

  const slug =
    fixedSlug ||
    String(post.slug || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200) ||
    "ai-daily-post"

  const title = String(post.title).slice(0, 200)
  let summary = truncateSummary(post.summary || "", 50)
  if (summary.length < 1) summary = "AI 技术动态与开发者生态观察。"

  const rawTags = Array.isArray(post.tags) ? post.tags : ["ai"]
  const tags = rawTags
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 48))
    .filter(Boolean)
    .slice(0, 8)

  return { title, slug, summary, content_md: String(post.content_md), tags: tags.length ? tags : ["ai"] }
}

async function publishPost(token, payload, coverImage = "") {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      slug: payload.slug,
      summary: payload.summary,
      content_md: payload.content_md,
      tags: payload.tags,
      is_published: true,
      is_pinned: false,
      cover_image: coverImage,
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`发布失败: ${resp.status} ${err}`)
  }
  return resp.json()
}

// ── 主流程 ──

async function main() {
  console.log("🚀 自动博客 v2 开始")
  const today = new Date().toISOString().split("T")[0]
  console.log(`📅 日期: ${today}`)

  if (!SILICONFLOW_API_KEY) throw new Error("请配置 SILICONFLOW_API_KEY")
  if (!ADMIN_PASSWORD && !DRY_RUN) throw new Error("缺少 ADMIN_PASSWORD")

  const slug = `ai-daily-${today}`

  if (!DRY_RUN && (await checkSlugExists(slug))) {
    console.log(`⏭️ 今日文章已存在 (${slug})，跳过`)
    return
  }

  // 步骤1：RSS 拉取
  const feedItems = await fetchAllFeeds(30)

  // 步骤2：Jina Reader 抓全文（取前 15 条有链接的）
  const itemsWithLinks = feedItems.filter((i) => i.link).slice(0, 15)
  const enriched = await enrichWithFullText(itemsWithLinks)

  // 步骤3：素材预处理
  let materials = formatMaterials(enriched)
  materials = deduplicateContent(materials)

  // 步骤3.5：收集并验证所有图片
  const allImages = enriched.flatMap((item) => (item.images || []).map((img) => ({ ...img, source: item.source, itemTitle: item.title })))
  console.log(`🖼️ 共提取 ${allImages.length} 张候选图片，验证可访问性…`)
  const validImages = allImages.length > 0 ? await validateImages(allImages) : []
  console.log(`   ✓ ${validImages.length}/${allImages.length} 张图片可用`)

  // 后备：RSS 全部失败时用 Jina 直读
  if (materials.length < 300) {
    console.log("⚠️ RSS 素材不足，使用 Jina Reader 后备…")
    for (const url of FALLBACK_URLS) {
      const md = await jinaRead(url, 6000)
      if (md.length > 200) {
        materials += `\n\n---\n\n【来源: 后备】${url}\n${removeBoilerplate(md)}`
        console.log(`   ✓ 后备拉取 ${url}：${md.length} 字符`)
      }
      if (materials.length >= 300) break
    }
  }

  if (materials.length < 300) {
    throw new Error("素材采集不足（RSS 与 Jina 后备均失败）。请检查网络或 RSS 源可用性。")
  }

  materials = smartTruncate(materials, 26000)
  console.log(`📊 预处理后素材 ${materials.length} 字符`)

  // 步骤4：两阶段 LLM 生成
  const outline = await generateOutline(materials, today)
  console.log(`📋 选题: ${outline.topic}`)
  console.log(`📋 大纲: ${outline.outline?.join(" → ")}`)

  const post = await generateArticle(outline, materials, today)
  console.log(`✅ 生成完成: ${post.title}`)

  // 步骤4.5：代理所有图片 URL
  post.content_md = proxyAllImages(post.content_md || "")

  // 封面图：优先用 LLM 选的，兜底取第一张有效图片
  let coverImage = ""
  const llmCover = outline.cover_image || ""
  if (llmCover && validImages.some((img) => img.url === llmCover)) {
    coverImage = proxyImageUrl(llmCover)
    console.log(`🖼️ 封面图（LLM 选择）: ${llmCover.slice(0, 80)}`)
  } else if (validImages.length > 0) {
    coverImage = proxyImageUrl(validImages[0].url)
    console.log(`🖼️ 封面图（自动选择）: ${validImages[0].url.slice(0, 80)}`)
  }

  const apiBody = normalizeForApi(post, slug)

  if (DRY_RUN) {
    console.log("🏃 --dry-run 模式，跳过发布。")
    console.log(`📋 选题: ${outline.topic}`)
    console.log(`📋 大纲: ${JSON.stringify(outline.outline)}`)
    console.log(`🖼️ 封面: ${coverImage || "（无）"}`)
    console.log(JSON.stringify(apiBody, null, 2))
    return
  }

  // 步骤5：发布
  console.log("🔑 登录管理后台…")
  const token = await getAdminToken()

  console.log("📤 发布文章…")
  const result = await publishPost(token, apiBody, coverImage)
  console.log(`🎉 发布成功! ID: ${result.id}, slug: ${apiBody.slug}`)
}

main().catch((err) => {
  console.error(`❌ 致命错误: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
