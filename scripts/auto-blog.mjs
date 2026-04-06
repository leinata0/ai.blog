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
        max_tokens: 12000,
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

  const title = String(post.title || "科技札记（自动生成fallback）").slice(0, 200)
  let summary = String(post.summary || "").slice(0, 300)
  if (summary.length < 1) summary = "本文由脚本自动生成摘要占位，请检查模型返回字段 summary。".slice(0, 300)

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
  const systemPrompt = `你是「极客开发日志」的专栏作者，根据用户附带的 **aread 搜索+阅读** 原始摘要，用**简体中文**写一篇偏「科技幕后与工程视角」的长文笔记。读者是同行开发者，需要**信息密度**和**可复盘的判断**，而不是通稿口吻。

## 领域与事实边界（素材优先）
- 覆盖尽量包含：**人工智能 / 大模型 / 智能应用**，以及 **软件工程、基础设施、安全、云计算与算力** 等相关议题；几条线可以穿插，不必机械平均分配篇幅。
- 素材不足就写短、写谨慎。禁止捏造版本号/融资额/未公开的「协议细节」；不确定之处用一句点明「公开信息有限」即可，不要硬编。

## 篇幅与深度（对应 content_md）
- **正文以约 2400～2800 个汉字为目标**（不含「参考来源」类小结）；不要低于约 2200 字硬凑，也不要用空话灌到明显超过 3000 字。
- **深度优先**：每个主要议题要写清「发生了什么 → 技术或机制上为什么重要 → 谁在博弈/约束条件 → 对开发者或团队的实际意味」，必要时可加一两句克制的个人判断（少用「我认为」重复，避免口号）。
- **禁止固定目录八股**：不要出现「快讯一」「快讯二」「Part 1」「事件概述」「要点梳理」等栏目化标题，也不要用对称的小节骨架。用 \`##\` 小标题概括**议题本身**（命题、矛盾、工程难点都行），下面可自由混用段落、少量列表、偶尔引用；**各节不必同构**，允许某一节以长论述为主、另一节以短列表收口。

## 去「机翻 / AI 综述」味（文风）
- 禁用或尽量少用：「综上所述」「值得一提」「在当今时代」「让我们拭目以待」「总而言之」等模板句。
- 少用空洞形容词；多写**具体名词、因果、trade-off、边界条件**。
- 语气像熟人在讲清楚一件事，**不要营销号腔、不要连续感叹号**。

## Markdown 规范
- 仅 CommonMark；**禁止 HTML 标签**。
- 正文小节从 \`##\` 起用，可按需使用 \`###\`；**不要用正文一级 \`#\`\`**（主标题只放在 JSON 的 title）。
- 列表用 \`-\`；叙述中的链接用 \`[说明](url)\`；参考来源小节外避免裸露 URL 独占一行。
- 代码仅在有必要时用围栏块并带语言标签。

## 文末
- 正文论述结束后，用最后一个 \`##\` 集中列素材链接（标题可自拟，如 \`## 参考来源\` 或 \`## 参考与链接\`）；无直链时诚实写「摘要未收录 URL」。

## JSON（仅输出一个 JSON 对象，不要用 markdown 围栏包裹）
- \`title\`：**全文写完后**再拟。用一句中文概括**主线或核心张力**，约 10～26 字。**禁止**出现：「AI 日报」「日报」「周刊」「速递」及任何形式日期（含「${today}」、\`YYYY-MM-DD\`、年月日、星期几、「今日」）。不要直接复制素材标题。
- \`slug\`：必须为 \`ai-daily-${today}\`（仅站内去重用，勿写进 title）。
- \`summary\`：90～120 字，**一整段**交代全文脉络与判断，无换行、不用分点枚举腔。
- \`content_md\`：满足上述篇幅与结构的正文（含参考来源小节）。
- \`tags\`：小写英文 slug，**必须**含 \`ai\`，其余如 \`llm\`、\`infra\`、\`security\`、\`cloud\` 等据内容选，最多 8 个（不强制 \`daily\`）。

示意：{"title":"…","slug":"ai-daily-${today}","summary":"…","content_md":"…","tags":["ai",…]}`

  const userPrompt = `【素材日期 ${today}】以下为 **aread-cli 搜索并抓取正文** 得到的原始材料（可能多段拼接）。请先内化再写作；**title 须在成文后根据全文自拟**，并遵守系统说明中的标题禁则。返回 JSON：

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
