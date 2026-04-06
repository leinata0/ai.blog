#!/usr/bin/env node
/**
 * 自动博客生成脚本
 * 架构：aread「搜索 + 阅读」（必要时降级仅搜索）→ 汇总素材 → LLM API 生成中文 Markdown 博文 → 管理端发布。
 * LLM：硅基流动 OpenAI 兼容接口（默认 deepseek-ai/DeepSeek-V3）。
 * 环境变量：SILICONFLOW_API_KEY（必填）、SILICONFLOW_BASE_URL、SILICONFLOW_MODEL、
 * ADMIN_PASSWORD、BLOG_API_BASE、ADMIN_USERNAME。
 */

import { execSync } from "child_process"

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY?.trim()
/** 国内默认 .cn；海外可用 https://api.siliconflow.com/v1 */
const SILICONFLOW_BASE_URL = (
  process.env.SILICONFLOW_BASE_URL?.trim() || "https://api.siliconflow.cn/v1"
).replace(/\/$/, "")
const SILICONFLOW_MODEL =
  process.env.SILICONFLOW_MODEL?.trim() || "deepseek-ai/DeepSeek-V3"
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BLOG_API_BASE = process.env.BLOG_API_BASE || "https://api.563118077.xyz"

const SEARCH_QUERIES = [
  "AI artificial intelligence breaking news today",
  "LLM large language model latest release 2026",
  "OpenAI Anthropic Google AI announcement",
  "AI open source model new release",
  "AI agent coding tool update 2026",
  "machine learning research paper breakthrough",
  "multimodal AI model progress 2026",
  "AI startup funding product launch",
]

/** 第二路「搜索+阅读」查询：计算机 / 工程 / 安全 / 云计算 / 算力等（与主路 AI 素材分列，仍走 aread --read） */
const CS_TECH_SEARCH_READ_QUERY =
  "cloud computing cybersecurity software engineering devops semiconductor data center tech news 2026"

// ── aread（与 Crosery/aread 同源：Jina Reader + DuckDuckGo）──
// 使用 npx，避免 GitHub Actions 全局安装后 PATH 找不到 aread-cli

const AREAD_CMD = "npx --yes aread-cli"

function runCommand(cmd, timeoutMs = 60000) {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return output
  } catch (err) {
    const stderr =
      err.stderr != null
        ? String(err.stderr).slice(0, 400)
        : err.message || ""
    console.log(`   ⚠️ 命令出错: ${String(err.message || err).slice(0, 200)}`)
    if (stderr) console.log(`   stderr: ${stderr}`)
    return ""
  }
}

function areadSearch(query, num = 8) {
  console.log(`🔍 aread 搜索: ${query}`)
  const safe = query.replace(/"/g, '\\"')
  return runCommand(`${AREAD_CMD} -r -s "${safe}" -n ${num}`, 90000)
}

function areadSearchAndRead(query, num = 3) {
  console.log(`🔍📖 aread 搜索+阅读: ${query}`)
  const safe = query.replace(/"/g, '\\"')
  return runCommand(`${AREAD_CMD} -r -s "${safe}" --read -n ${num}`, 240000)
}

function areadRead(url) {
  console.log(`📖 aread 阅读: ${url}`)
  const safe = url.replace(/"/g, '\\"')
  return runCommand(`${AREAD_CMD} -r "${safe}"`, 90000)
}

/** Jina Reader 后备（与 aread「阅读」能力一致），CI 上 aread 失败时仍可用 */
async function jinaReadMarkdown(url, maxLen = 5000) {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true",
      },
    })
    if (!resp.ok) return ""
    const text = await resp.text()
    return text.slice(0, maxLen)
  } catch {
    return ""
  }
}

const FALLBACK_NEWS_URLS = [
  "https://techcrunch.com/category/artificial-intelligence/",
  "https://www.reuters.com/technology/artificial-intelligence/",
  "https://www.artificialintelligence-news.com/",
]

async function gatherNewsWithFallback(newsContent) {
  let combined = newsContent || ""
  if (combined.length >= 300) return combined

  console.log("⚠️ aread 内容不足，使用 Jina Reader 后备拉取 AI 新闻页…")
  for (const u of FALLBACK_NEWS_URLS) {
    const md = await jinaReadMarkdown(u, 6000)
    if (md.length > 200) {
      combined += `\n\n=== ${u} ===\n\n${md}`
      console.log(`   ✓ Jina 拉取 ${u}：${md.length} 字符`)
    }
    if (combined.length >= 300) break
  }
  return combined
}

// ── 硅基流动 SiliconFlow（OpenAI 兼容 POST /v1/chat/completions）──

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonFromLlmContent(raw) {
  let s = String(raw || "").trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/m, "")
  }
  return JSON.parse(s)
}

async function callSiliconFlowChat(systemPrompt, userPrompt) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error("未配置 SILICONFLOW_API_KEY（请在硅基流动控制台创建 API Key）")
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
      console.log(`   ⏳ 第 ${attempt} 轮请求，等待 ${sec}s…`)
      await sleep(sec * 1000)
    }

    let response = null
    let errText = ""

    for (const jsonMode of [true, false]) {
      const body = {
        model: SILICONFLOW_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 8192,
      }
      if (jsonMode) body.response_format = { type: "json_object" }

      console.log(
        `🤖 硅基流动 ${SILICONFLOW_MODEL}${jsonMode ? "（response_format: json_object）" : ""}`
      )
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
        console.log("   ⚠️ JSON 模式被拒或未启用，改用普通补全再试…")
        continue
      }
      break
    }

    if (!response.ok) {
      lastError = errText
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `硅基流动鉴权失败 ${response.status}: ${errText.slice(0, 350)}`
        )
      }
      if (response.status === 429 || response.status >= 500) continue
      throw new Error(`硅基流动 API ${response.status}: ${errText.slice(0, 400)}`)
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content
    if (!raw) {
      lastError = "模型返回 content 为空"
      continue
    }
    try {
      console.log("   ✓ 模型返回已解析为 JSON")
      return parseJsonFromLlmContent(raw)
    } catch {
      lastError = `JSON 解析失败: ${String(raw).slice(0, 200)}`
    }
  }

  throw new Error(`硅基流动 API 多次重试仍失败: ${lastError.slice(0, 500)}`)
}

/** 生成博文 JSON（title / slug / summary / content_md / tags） */
async function generatePostJson(systemPrompt, userPrompt) {
  return callSiliconFlowChat(systemPrompt, userPrompt)
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

/** 符合后端 PostCreateRequest：slug 仅小写字母数字与连字符 */
function normalizeForApi(post, fixedSlug) {
  const slug =
    fixedSlug ||
    String(post.slug || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200) ||
    "ai-daily-post"

  const title = String(post.title || "AI 日报").slice(0, 200)
  let summary = String(post.summary || "").slice(0, 300)
  if (summary.length < 1) summary = "今日 AI 领域热点摘要（自动生成）。".slice(0, 300)

  let content_md = String(post.content_md || "")
  if (content_md.length < 1) content_md = "## 内容\n\n（正文生成失败，请检查 LLM 返回。）"

  const rawTags = Array.isArray(post.tags) ? post.tags : ["ai", "daily"]
  const tags = rawTags
    .map((t) =>
      String(t)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
    )
    .filter(Boolean)
    .slice(0, 8)

  return { title, slug, summary, content_md, tags: tags.length ? tags : ["ai", "daily"] }
}

async function publishPost(token, payload) {
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
      cover_image: "",
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
  console.log("🚀 自动博客生成开始")
  console.log(`📅 日期: ${new Date().toISOString().split("T")[0]}`)

  if (!SILICONFLOW_API_KEY) {
    throw new Error("请配置 SILICONFLOW_API_KEY（硅基流动）")
  }
  if (!ADMIN_PASSWORD) throw new Error("缺少 ADMIN_PASSWORD 环境变量")

  const today = new Date().toISOString().split("T")[0]
  const slug = `ai-daily-${today}`

  // 检查是否已发布
  if (await checkSlugExists(slug)) {
    console.log(`⏭️ 今日文章已存在 (${slug})，跳过`)
    return
  }

  // 步骤1：aread 搜索+阅读（主架构）→ 失败则降级仅搜索；第二路仍用搜索+阅读以覆盖工程/云安全等
  const queryIndex = new Date().getDate() % SEARCH_QUERIES.length
  const queryPrimary = SEARCH_QUERIES[queryIndex]

  let newsContent = areadSearchAndRead(queryPrimary, 3)

  if (!newsContent || newsContent.length < 200) {
    console.log("⚠️ 搜索+阅读结果不足，尝试仅搜索（降级）...")
    newsContent = areadSearch(queryPrimary, 8)
  }

  const csRead = areadSearchAndRead(CS_TECH_SEARCH_READ_QUERY, 2)
  if (csRead && csRead.length > 80) {
    newsContent += `\n\n=== aread 搜索+阅读（计算机 / 工程 / 安全 / 云计算与算力）===\n\n${csRead}`
  }

  // 补充：aread 直接阅读固定资讯页（与上同属「阅读」管线）
  const techcrunchContent = areadRead("https://techcrunch.com/category/artificial-intelligence/")
  if (techcrunchContent) {
    newsContent += "\n\n=== TechCrunch AI 最新文章 ===\n\n" + techcrunchContent.slice(0, 4000)
  }

  newsContent = await gatherNewsWithFallback(newsContent)

  if (!newsContent || newsContent.length < 300) {
    throw new Error(
      "新闻内容采集不足（aread 与 Jina 后备均失败）。请检查 Actions 日志中 aread 的 stderr，或确认未拦截 r.jina.ai。"
    )
  }

  // 限制总 token 量
  if (newsContent.length > 15000) {
    newsContent = newsContent.slice(0, 15000)
  }

  console.log(`📊 采集到 ${newsContent.length} 字符新闻内容`)

  // 步骤2：调用硅基流动 DeepSeek 生成文章
  const systemPrompt = `你是「极客开发日志」的技术编辑，根据用户附带的 **aread 搜索+阅读** 原始摘要，用**简体中文**撰写一篇「AI & 科技」日报。

## 内容范围（须覆盖，尽量从素材中取材）
- **人工智能 / 大模型 / 智能应用** 等与 AI 直接相关的话题；
- **计算机与软件工程、基础设施、网络安全、云计算与算力** 等（可与 AI 弱相关，但须是素材中可支撑的点）。
若某类素材薄弱，可简短一笔带过并加一句「公开信息有限，待后续验证」，禁止编造具体数字、产品版本或「内部消息」。

## 文章结构（对应字段 content_md）
1. **今日速览**：1 个短段落（约 80～120 字），不加 # 级标题，段后空一行。
2. **3～4 条独立快讯**：每条必须与其它条在主题/事件上不重复。依次使用二级标题：
   - \`## 快讯一：……\`、\`## 快讯二：……\`（依此类推，最多到「快讯四」）。
   - 每条下固定三个 **三级标题**（必须按顺序出现）：
     - \`### 事件概述\`：2～4 句；
     - \`### 要点梳理\`：3～6 条无序列表（\`-\` 开头，每行一条）；
     - \`### 可能影响\`：1～3 句。
3. \`## 总结与展望\`：一段话收束，可含对读者的简要建议（如关注合规、观测后续发布等）。
4. \`## 参考来源\`：\`-\` 列表；每条若是链接请用 Markdown 链接语法 \`[站点或标题](https://…)\`；素材无明确 URL 时写站点名或「检索摘要未含直链」。

## Markdown 严格规范（违反则视为不合格输出）
- 正文 **仅使用** CommonMark 风格 Markdown：**不要**输出 HTML 标签（禁止 \`<div>\`、\`<br>\` 等）。
- 标题层级：文中从 \`##\` 起用，顺序为 \`##\` → \`###\`，**不要**跳过层级，**不要**用一级 \`#\` 作为正文标题（文章主标题由 JSON 的 title 字段承担）。
- 列表：无序列表行首必须是 \`-\` 后接空格；列举用列表，不要伪造成段落里的「1)」混排。
- 强调：关键术语用 \`**加粗**\`，勿整段加粗。
- 引用：需要批注时使用 \`>\` 引用块，单独成段，前后各空一行。
- 代码与命令：仅当确有必要时使用围栏代码块：单独一行写三个反引号紧接语言名（如 bash），代码结束再单独一行三个反引号；否则不要滥用代码块。
- 链接：**裸露 URL 禁止单独成行**（除参考来源列表内外层已用链接语法）；正文叙述中链接一律 \`[说明](url)\`。
- 空白：每个 \`##\` / \`###\` 标题前后各空一行；段落之间空一行。

## JSON 输出（仅输出一个 JSON 对象，不要用 markdown 代码围栏包裹整个 JSON）
- \`title\`：格式严格为 \`AI 日报 | ${today}：关键词1、关键词2\`（2～4 个短语，逗号分隔，与正文快讯呼应）。
- \`slug\`：必须为 \`ai-daily-${today}\`。
- \`summary\`：80 字以内中文，概括 3～4 条快讯，无换行。
- \`content_md\`：符合上文结构与 Markdown 规范的正文全文。
- \`tags\`：小写英文 slug，含 \`ai\`、\`daily\`，并酌情添加如 \`llm\`、\`cloud\`、\`security\` 等，最多 8 个。

输出示例结构（示意，勿照抄措辞）：
{"title":"…","slug":"ai-daily-${today}","summary":"…","content_md":"…","tags":["ai","daily",…]}`

  const userPrompt = `日期：${today}。以下为 **aread-cli 搜索并抓取正文** 得到的原始素材（可能含多段拼接）。请严格按系统说明撰写 content_md 并返回 JSON：

${newsContent}`

  const post = await generatePostJson(systemPrompt, userPrompt)
  console.log(`✅ AI 生成完成: ${post.title}`)

  const apiBody = normalizeForApi(post, slug)

  // 步骤3：发布
  console.log("🔑 登录管理后台...")
  const token = await getAdminToken()

  console.log("📤 发布文章...")
  const result = await publishPost(token, apiBody)
  console.log(`🎉 发布成功! ID: ${result.id}, slug: ${apiBody.slug}`)
}

main().catch((err) => {
  console.error(`❌ 致命错误: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
