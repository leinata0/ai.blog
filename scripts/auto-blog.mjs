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
        max_tokens: 16384,
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

/** 摘要硬上限：汉字/标点等按 Unicode 字符计（码点），不超过 max */
function truncateSummaryText(s, max = 50) {
  const arr = Array.from(String(s || "").trim())
  if (arr.length <= max) return arr.join("")
  return arr.slice(0, max).join("")
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

  const title = String(post.title || "科技札记（自动生成fallback）").slice(0, 200)
  let summary = truncateSummaryText(post.summary || "", 50)
  if (summary.length < 1) summary = "自动发文摘要缺失，请在后端补写。"
  summary = truncateSummaryText(summary, 50)

  let content_md = String(post.content_md || "")
  if (content_md.length < 1) content_md = "## 内容\n\n（正文生成失败，请检查 LLM 返回。）"

  const rawTags = Array.isArray(post.tags) ? post.tags : ["ai"]
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

  return { title, slug, summary, content_md, tags: tags.length ? tags : ["ai"] }
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

  let newsContent = areadSearchAndRead(queryPrimary, 4)

  if (!newsContent || newsContent.length < 200) {
    console.log("⚠️ 搜索+阅读结果不足，尝试仅搜索（降级）...")
    newsContent = areadSearch(queryPrimary, 8)
  }

  const csRead = areadSearchAndRead(CS_TECH_SEARCH_READ_QUERY, 3)
  if (csRead && csRead.length > 80) {
    newsContent += `\n\n=== aread 搜索+阅读（计算机 / 工程 / 安全 / 云计算与算力）===\n\n${csRead}`
  }

  // 补充：aread 直接阅读固定资讯页（与上同属「阅读」管线）
  const techcrunchContent = areadRead("https://techcrunch.com/category/artificial-intelligence/")
  if (techcrunchContent) {
    newsContent += "\n\n=== TechCrunch AI 最新文章 ===\n\n" + techcrunchContent.slice(0, 6000)
  }

  newsContent = await gatherNewsWithFallback(newsContent)

  if (!newsContent || newsContent.length < 300) {
    throw new Error(
      "新闻内容采集不足（aread 与 Jina 后备均失败）。请检查 Actions 日志中 aread 的 stderr，或确认未拦截 r.jina.ai。"
    )
  }

  // 限制总长度（略放宽，便于写长文深度）
  if (newsContent.length > 24000) {
    newsContent = newsContent.slice(0, 24000)
  }

  console.log(`📊 采集到 ${newsContent.length} 字符新闻内容`)

  // 步骤2：调用硅基流动 DeepSeek 生成文章
  const systemPrompt = `你是「极客开发日志」的作者，根据 **aread 搜索+阅读** 原始材料，用**简体中文**写一篇**可以当博客直接发布**的长文：有头有尾、段落之间有承接，不是内部备忘录，也不是词条拼盘。

## 领域与事实边界
- 主线覆盖：**人工智能 / 大模型 / 智能应用**，并交织 **软件工程、基础设施、安全、云计算与算力** 等相关面向；篇幅允许侧重其中两三条线，但整篇要读得出一根主线。
- 禁止编造具体数字、未证实融资、虚构「内部条款」。信息弱时写短、写出不确定边界；需要延展的地方可做**有条件的推演**（标明「从工程常识推断」「更可能是…」），与新闻事实区分清楚。

## 篇幅（硬指标，对应 content_md；不含「参考来源」类章节）
- **正文汉字硬性下限：不少于 2800 字**；推荐写到 **3000～3800 字**。少一个字都算不合格——请在成稿前自行在心里点数并扩充：补背景、补机制解释、补工程 trade-off、补与读者工作的衔接，而不是叠形容词。
- **结构**：开头用 **2～3 段引子** 把问题抛出来（**不要**给引子加 \`#\` 标题）；随后 **至少 4 个**不同的 \`##\` 小节展开主线（议题名自拟，体现内容，不要「快讯一」体例）。每个核心小节约 **500～900 字** 的实质性论述为主，列表只作辅助。全文要有一两处「为什么从业者要在意」的落点。
- **深度**：每个核心议题至少交代：**现象/事实 → 机制或架构直觉（给开发者能听懂的一句原理/链条）→ 约束与取舍 → 对你我工作的含义**（部署、成本、安全、团队流程等任选相关角度）。

## 博客语感（避免不像博文）
- 段落之间用过渡句勾连；避免每段同一句式开头。
- 禁用：「综上所述」「值得期待」「在当今」「让我们拭目以待」「总而言之」等申论腔。
- 少用连续短句堆砌；**不要营销号腔和满屏感叹号**。

## Markdown
- CommonMark 即可；**禁止 HTML**。
- 正文从 \`##\` 起用小节标题，可按需加 \`###\`；**不要用正文一级 \`#\`\`**（列表页的标题用 JSON 的 title）。
- 链接在叙述中用 \`[说明](url)\`；参考以外的裸露长链不要单独成行。

## 文末
- 最后一个 \`##\` 集中列出参考链接（如 \`## 参考来源\`）。

## JSON（仅输出一个 JSON 对象，不要用 markdown 围栏包裹）
- \`title\`：成文后再写。**10～28 字**，概括全文主线或张力。**禁止**：「日报」「周刊」「速递」「AI 日报」及一切日期（含「${today}」、年月日、星期、「今日」）。
- \`slug\`：必须为 \`ai-daily-${today}\`（勿写入 title）。
- \`summary\`：**不超过 50 个汉字（含标点）的一句话**，无换行、**禁止**以「本文」「全文」「作者」开头，禁止逗号衔接超长复句凑长度；宁愿短也不要超 50 字。
- \`content_md\`：满足字数与结构的正文（含参考来源）。
- \`tags\`：小写英文 slug，**必须**含 \`ai\`，其余如 \`llm\`、\`infra\`、\`security\`、\`cloud\` 等，最多 8 个。

示意：{"title":"…","slug":"ai-daily-${today}","summary":"……","content_md":"…","tags":["ai",…]}`

  const userPrompt = `【素材日期 ${today}】以下为 **aread-cli 搜索并抓取正文** 的原始材料。请写成一篇**不少于 2800 汉字正文**的博客稿；summary 严守 ≤50 字；title 成文后自拟并遵守禁则。仅返回 JSON：

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
