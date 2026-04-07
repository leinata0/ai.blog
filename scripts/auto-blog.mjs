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
const XAI_API_KEY = process.env.XAI_API_KEY?.trim() || ""

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

/** 对 RSS 条目列表，并行用 Jina 读取全文（限制并发 5） */
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

/** 下载外部图片并上传到博客服务器，返回本地永久 URL；失败返回 null */
async function downloadAndUploadImage(imageUrl, token) {
  try {
    // 下载图片
    const resp = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoBlogBot/2.0)" },
    })
    if (!resp.ok) return null
    const ct = resp.headers.get("content-type") || ""
    if (!ct.startsWith("image/")) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length < 1000 || buffer.length > 5 * 1024 * 1024) return null

    // 构造文件名
    const ext = ct.includes("png") ? ".png" : ct.includes("gif") ? ".gif" : ct.includes("webp") ? ".webp" : ".jpg"
    const filename = `auto-blog-${Date.now()}${ext}`

    // 上传到博客后端
    const boundary = `----FormBoundary${Date.now()}`
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`
    const footer = `\r\n--${boundary}--\r\n`
    const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)])

    const uploadResp = await fetch(`${BLOG_API_BASE}/api/admin/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!uploadResp.ok) {
      console.log(`   ⚠️ 上传失败: ${uploadResp.status}`)
      return null
    }
    const data = await uploadResp.json()
    // 返回完整 URL
    const localUrl = data.url?.startsWith("http") ? data.url : `${BLOG_API_BASE}${data.url}`
    return localUrl
  } catch (err) {
    console.log(`   ⚠️ 图片下载/上传异常: ${err.message?.slice(0, 100)}`)
    return null
  }
}

/** 调用 xAI Grok Imagine 生成图片并上传到服务器（备选方案） */
async function generateImageWithGrok(prompt, token) {
  if (!XAI_API_KEY) return null
  try {
    const resp = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-2-image",
        prompt,
        n: 1,
        size: "1024x1024",
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!resp.ok) {
      console.log(`   ⚠️ Grok 生图失败: ${resp.status} ${(await resp.text()).slice(0, 200)}`)
      return null
    }
    const data = await resp.json()
    const grokUrl = data.data?.[0]?.url
    if (!grokUrl) return null
    console.log(`   ✓ Grok 生图成功，上传到服务器…`)
    // 下载 Grok 图片并上传到自己服务器
    const localUrl = await downloadAndUploadImage(grokUrl, token)
    return localUrl
  } catch (err) {
    console.log(`   ⚠️ Grok 生图异常: ${err.message}`)
    return null
  }
}

/** 将图片程序化插入 Markdown 正文（在 ## 章节的第一段之后） */
function insertImagesIntoMarkdown(contentMd, imageUrls) {
  if (!imageUrls.length) return contentMd
  const lines = contentMd.split("\n")
  const insertPoints = [] // 找到每个 ## 章节第一个空行的位置
  let inSection = false
  let foundParagraph = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      inSection = true
      foundParagraph = false
      continue
    }
    if (inSection && !foundParagraph && lines[i].trim().length > 0) {
      foundParagraph = true
      continue
    }
    if (inSection && foundParagraph && lines[i].trim() === "") {
      insertPoints.push(i)
      inSection = false
    }
  }
  // 均匀分配图片到插入点，跳过最后一个章节（写在最后）
  const usablePoints = insertPoints.slice(0, -1)
  if (usablePoints.length === 0) return contentMd
  const result = [...lines]
  let inserted = 0
  for (let idx = 0; idx < imageUrls.length && idx < usablePoints.length; idx++) {
    const pos = usablePoints[idx] + inserted
    const imgMd = `\n![配图](${imageUrls[idx]})\n`
    result.splice(pos + 1, 0, imgMd)
    inserted++
  }
  return result.join("\n")
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

/** 将 RSS 条目格式化为带来源标注的素材文本 */
function formatMaterials(items) {
  return items
    .map((item) => {
      const header = `【来源: ${item.source}】${item.title}`
      const body = item.fullText || item.description || ""
      const cleanBody = removeBoilerplate(body)
      return cleanBody.length > 50 ? `${header}\n${cleanBody}` : `${header}\n${item.description || ""}`
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

返回 JSON：{"topic":"主线话题（一句话）","outline":["## 一、中文章节标题","### 子标题（可选）","## 二、中文章节标题",...],"key_sources":["相关素材标题或URL"],"tags":["ai","llm",...],"image_prompts":["English prompt for generating an illustration related to the main topic","English prompt for a second illustration","English prompt for a third illustration"]}`
  const user = `【${today}】以下是今日抓取的素材，请选题并生成大纲：\n\n${materials.slice(0, 12000)}`
  return callLLM(system, user, 2048)
}

/** 阶段二：根据大纲 + 素材生成完整文章 */
async function generateArticle(outline, materials, today) {
  console.log("✍️ 阶段二：LLM 正文生成…")

  const system = `# Role
你是「极客开发日志」的博主，资深独立开发者与 AI 观察员。写出的文章直接贴博客，不是内部纪要。

# 输出格式
只返回一个 JSON（无 \`\`\`，无多余文字）。键：title、slug、summary、content_md、tags。

# 核心要求
1. content_md 正文 3000-4500 字，字数不够不合格
2. 每个 ## 章节至少 3 段完整段落，每段 4-6 句话
3. 不要用列表凑字数，要写有深度的完整段落
4. title 10-28 字中文，禁止「日报」「周刊」「速递」及日期
5. slug 必须为 \`ai-daily-${today}\`
6. summary 不超过 50 字，勿以「本文」开头
7. tags 小写英文，必含 ai，最多 8 个
8. 禁止编造数据，禁止 HTML，不要插入图片

# 文章范例（模仿这个风格和深度）

\`\`\`markdown
## 一、极客起航：为什么要自己造一个博客？

作为一名大一计算机专业的学生，我的课余时间几乎都泡在终端和编辑器里。用 Python 写 Selenium + Pandas 自动化脚本抓数据、啃 C/C++ 的指针与内存管理、研究 OpenClaw 开源项目的私有化部署——这些"硬核折腾"构成了我大学生活的主旋律。

零散的笔记越攒越多，我迫切需要一个属于自己的发布平台——不是在第三方博客上写，而是从前端到后端、从数据库到部署，全部自己掌控。

## 二、架构大图：三层分离，各司其职

经过调研，我选定了一套轻量但完整的技术栈：

| 层级 | 技术选型 | 托管平台 |
|------|---------|---------|
| 前端 | React + Vite + Tailwind CSS | Vercel |
| 后端 | Python FastAPI + SQLAlchemy ORM | Render |
| 数据库 | SQLite（文件型，零运维） | Render 持久化磁盘 |

**前端**使用 React 搭配 Vite 构建，Tailwind CSS 负责极客风格的暗色主题 UI。通过 Vercel 的 Git 集成，每次 push 自动触发构建部署，体验丝滑。

**后端**选择 FastAPI，原因很简单：Python 是我最熟悉的语言，FastAPI 的异步性能和自动生成 API 文档的能力让开发效率拉满。SQLAlchemy 作为 ORM 层，让我不用手写 SQL 就能完成数据建模。

## 三、踩坑与反杀：部署的三重关卡

本地开发一路顺畅，真正的挑战从部署开始。

### 关卡一：持久化磁盘的"付费墙"

SQLite 的数据存储在文件里，而 Render 免费实例每次重启都会重置文件系统。这意味着——每次服务休眠唤醒，我的博客文章就全没了。

解决方案是挂载 Render 的 Persistent Disk，把 \`blog.db\` 放到持久化路径 \`/data\` 下。但这个功能需要 Starter Plan 起步，于是我绑定了支付方式升级到付费计划。

### 关卡二：配置文件的连环修改

挂载磁盘后，需要同步修改多处配置：

- \`render.yaml\`：声明 disk 挂载点和容量
- \`Dockerfile\`：确保数据目录存在并设置正确权限
- \`db.py\`：通过环境变量 \`DATABASE_URL\` 指向 \`/data/blog.db\`

任何一处遗漏都会导致服务启动失败或数据写入临时目录。我前后调试了好几轮，这个过程让我深刻体会到：**版本控制不是可选项，而是救命绳。**

## 四、写在最后

> 工具会迭代，但解决问题的思维方式不会过时。
\`\`\`

注意范例中的特点，你必须模仿：
- 段落饱满，每段 4-6 句话，有具体细节和个人感受
- 表格对比技术方案
- ### 子标题拆分复杂章节（如"关卡一""关卡二"）
- **加粗**关键概念
- 口语化表达（"体验丝滑""效率拉满""心态差点崩了"）
- > 引用块做金句
- 代码用反引号标注
- 不是新闻罗列，而是有主线叙事的深度分析文章`

  const user = `【素材日期 ${today}】

选题与大纲：
${JSON.stringify(outline, null, 2)}

原始素材：
${materials}

请按大纲撰写正文，模仿范例的风格和深度，只返回 JSON。`

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

  // 步骤4：两阶段 LLM 生成（不含图片，LLM 专注写作质量）
  const outline = await generateOutline(materials, today)
  console.log(`📋 选题: ${outline.topic}`)
  console.log(`📋 大纲: ${outline.outline?.join(" → ")}`)

  const post = await generateArticle(outline, materials, today)
  console.log(`✅ 生成完成: ${post.title}`)

  // 步骤4.5：提前登录（图片上传需要 token）
  let token = null
  if (!DRY_RUN) {
    console.log("🔑 登录管理后台…")
    token = await getAdminToken()
  }

  // 步骤5：Grok 生图（仅在配置 XAI_API_KEY 时启用）
  const imageUrls = []
  if (XAI_API_KEY && token) {
    const prompts = Array.isArray(outline.image_prompts) ? outline.image_prompts : []
    if (prompts.length > 0) {
      console.log(`🎨 Grok 生图（${prompts.length} 张）…`)
      for (const prompt of prompts.slice(0, 3)) {
        const localUrl = await generateImageWithGrok(prompt, token)
        if (localUrl) imageUrls.push(localUrl)
      }
      console.log(`   ✓ 成功生成 ${imageUrls.length} 张图片`)
    }
  } else if (!XAI_API_KEY) {
    console.log(`ℹ️ 未配置 XAI_API_KEY，跳过图片生成（纯文字发布）`)
  }

  // 程序化插入图片到正文（图片已在自己服务器，永久可用）
  let contentMd = post.content_md || ""
  if (imageUrls.length > 0) {
    contentMd = insertImagesIntoMarkdown(contentMd, imageUrls)
    console.log(`   ✓ 已插入 ${Math.min(imageUrls.length, 3)} 张图片到正文`)
  }
  post.content_md = contentMd

  // 封面图：第一张上传的图片
  const coverImage = imageUrls.length > 0 ? imageUrls[0] : ""
  if (coverImage) console.log(`🖼️ 封面图: ${coverImage}`)

  const apiBody = normalizeForApi(post, slug)

  if (DRY_RUN) {
    console.log("🏃 --dry-run 模式，跳过发布。")
    console.log(`📋 选题: ${outline.topic}`)
    console.log(`📋 大纲: ${JSON.stringify(outline.outline)}`)
    console.log(`🖼️ 封面: ${coverImage || "（无）"}`)
    console.log(JSON.stringify(apiBody, null, 2))
    return
  }

  // 步骤6：发布
  console.log("📤 发布文章…")
  const result = await publishPost(token, apiBody, coverImage)
  console.log(`🎉 发布成功! ID: ${result.id}, slug: ${apiBody.slug}`)
}

main().catch((err) => {
  console.error(`❌ 致命错误: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
