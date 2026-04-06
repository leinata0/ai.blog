#!/usr/bin/env node
/**
 * 自动博客生成脚本
 * 架构：aread「搜索 + 阅读」优先拉**最新**素材（AI / LLM / 计科 / Web·Vercel·Render / 开源 / 泛科技）→ 汇总 → LLM 成文 → 管理端发布。
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

/**
 * aread 主检索查询种子：每条均含 latest / breaking / this week 等偏「新」的关键词；运行时会在 main 里再拼当年份。
 * 覆盖：人工智能（AI）、大语言模型（LLM）、计算机科学、Web 架构（Vercel / Render）、开源、泛互联网科技趋势。
 */
const SEARCH_QUERIES = [
  "artificial intelligence AI breaking news latest today",
  "large language model LLM new release benchmark latest week",
  "OpenAI Anthropic Google Gemini Claude AI announcement latest",
  "open source AI model weights Hugging Face GitHub license latest release",
  "AI coding agent Cursor IDE developer tool latest update",
  "computer science algorithms systems programming language news latest",
  "machine learning deep learning research paper latest",
  "Vercel Next.js edge serverless deployment developer latest",
  "Render.com PaaS web service cold start developer latest",
  "internet tech startup platform regulation trend latest",
]

/** 第二路「搜索+阅读」：计算机科学 / 安全 / 云与基础设施（强调最新） */
const CS_TECH_SEARCH_READ_QUERY =
  "computer science cybersecurity cloud computing DevOps Kubernetes infrastructure latest news"

/** 第三路「搜索+阅读」：Web 开发架构（Vercel、Render 等）与开源生态（强调最新） */
const WEB_ARCH_OSS_SEARCH_READ_QUERY =
  "Vercel Render Netlify web app architecture serverless open source GitHub trending latest"

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

  // 步骤1：aread —— 主检索 + 计科/云基建 + Web·开源；查询字符串均带「最新」导向并在文末拼当年份，利于搜索引擎偏新结果
  const year = new Date().getFullYear()
  const queryIndex = new Date().getDate() % SEARCH_QUERIES.length
  const queryPrimary = `${SEARCH_QUERIES[queryIndex]} ${year}`.trim()

  console.log(`📌 aread 主检索（轮换 ${queryIndex + 1}/${SEARCH_QUERIES.length}，强调最新）`)

  let newsContent = areadSearchAndRead(queryPrimary, 4)

  if (!newsContent || newsContent.length < 200) {
    console.log("⚠️ 搜索+阅读结果不足，尝试仅搜索（降级）...")
    newsContent = areadSearch(queryPrimary, 8)
  }

  const csRead = areadSearchAndRead(`${CS_TECH_SEARCH_READ_QUERY} ${year}`, 3)
  if (csRead && csRead.length > 80) {
    newsContent += `\n\n=== aread 搜索+阅读（计算机科学 / 安全 / 云与基础设施·最新）===\n\n${csRead}`
  }

  const webOssRead = areadSearchAndRead(`${WEB_ARCH_OSS_SEARCH_READ_QUERY} ${year}`, 2)
  if (webOssRead && webOssRead.length > 80) {
    newsContent += `\n\n=== aread 搜索+阅读（Web 架构·Vercel / Render 等 / 开源·最新）===\n\n${webOssRead}`
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

  if (newsContent.length > 26000) {
    newsContent = newsContent.slice(0, 26000)
  }

  console.log(`📊 采集到 ${newsContent.length} 字符新闻内容`)

  // 步骤2：调用硅基流动 DeepSeek 生成文章（用户自定义提示词：博主人格 + TOC 叙事标题 + 排版规范；输出仍为 JSON 供 API 发布）
  const systemPrompt = `# Role
你是一位资深的独立开发者、科技博主和人工智能观察员，笔调归属「极客开发日志」。你有扎实的计算机科学背景，对代码、开源生态和 AI 行业动态敏感；写出的东西要能直接贴到博客上，而不是内部纪要。

# Task
用户会给你多篇近期通过工具抓取、拼接的科技资讯或技术线索。请阅读、交叉比对、整合提炼成**一篇**结构严谨、见解独到、排版漂亮的 **Markdown 技术长文**。正文写在 JSON 的 \`content_md\` 字段里。

# Topic Focus（内容焦点）
核心围绕：**人工智能（AI）、大语言模型（LLM）、计算机科学**、**Web / 基础设施与部署**（如 Vercel、Render、冷启动与成本）、**开源项目**及泛互联网科技趋势；可从素材中自选主线，但禁止离题成纯娱乐。

# 事实与边界
- 禁止编造融资额、版本号、未证实条款。素材弱就写短、写清不确定性；可做「工程常识层面的推演」，须与新闻事实分开写。
- \`content_md\` 里**禁止 HTML**；代码与命令用围栏代码块并标注语言（如 \`bash\`、\`python\`）。

# Table of Contents（⚠️ 侧边栏 TOC 专用标题规范 ⚠️）
站点会从 \`##\` / \`###\` 生成目录，标题必须**叙事化、有画面**，彻底拒绝八股词。

1. **命名公式**：\`## [中文序号]、[情境 / 情绪短语]：[具体技术点 / 核心悬念]\`，例如「## 一、极客起航：为什么要折腾这条链路？」。\`###\` 继续用「关卡 / 悬念 / 比喻」式短名，而不是论文小节名。
2. **绝对禁止**出现在标题里的词（及同义词糊弄）：「引言」「项目背景」「技术实现」「部署过程」「总结」「优点」「缺点」「参考文献」等死板说法。收尾可用「写在最后」「收束」「按图索骥」类**有画面**的表达，不要用「总结」二字当头。
3. **模仿示例（语气与结构，勿照抄话题）**：
   - ❌「一、项目背景」 → ✅「## 一、极客起航：为什么要自己造一个博客？」
   - ❌「二、系统架构」 → ✅「## 二、架构大图：三层分离，各司其职」
   - ❌「三、部署遇到的问题」 → ✅「## 三、踩坑与反杀：Render 部署的三重关卡」
   - ❌「3.1 磁盘收费问题」 → ✅「### 关卡一：持久化磁盘的「付费墙」」
   - ❌「四、总结」 → ✅「## 四、人机协作感悟：终端里的 AI 搭档」
   - ❌「五、未来展望」 → ✅「## 五、写在最后」
4. **推荐篇幅结构**：开头 **2～3 段无标题引子**（不加 \`#\`）；然后 **至少 4 个** \`##\` 叙事章节（按「一、二、三、四……」顺延序号）；视需要穿插 \`###\`；最后用 **再一个** \`##\` 做「链接 / 出处」集合，标题仍须叙事化，例如「## 六、按图索骥：本期信源与链接」——其中用列表列出 \`[说明](url)\`。

# 篇幅与深度（\`content_md\` 内、不含最后一节「链接」）
- **正文汉字不少于 2800 字**，推荐 **3000～3800 字**；每节以论述为主（每节约 **500～900 字**），列表只作辅助。
- 每个核心线索尽量写清：**事实 → 机制 / 架构直觉 → 取舍 → 对开发者或团队的含义**；在事实后加一两句 **「博主视角」或「技术洞察」**（克制、短）。

# Typography（严格排版）
1. 中英文 / 中文与数字之间加**半角空格**（例：使用 Python 调用 OpenAI API）。
2. 专有名词大小写跟官方：**GitHub**、**OpenAI**、**DeepSeek**、**React**、**Vercel**、**Render** 等，禁止随意全小写。
3. 类名、文件名、短命令、配置键等用行内反引号（例：\`.env\`、\`npm run build\`）。
4. 正文使用**全角中文标点**。

# Tone & Anti-AI Filter
- 像资深用户在 **V2EX / 掘金** 上写技术帖：专业、克制、偶尔冷幽默。
- 禁用：「在这个瞬息万变的时代」「总而言之」「随着科技的飞速发展」「让我们拭目以待」「希望这篇文章对你有所帮助」「综上所述」「值得期待」等播音腔 / 申论腔。

# Output Constraint（对接博客 API，与「只输出 Markdown」的冲突在此统一）
- **不要**输出「好的，以下是…」等套话。
- **仅输出一个合法 JSON 对象**（不要用 markdown 代码围栏包住整个 JSON）。
- JSON 键：\`title\`、\`slug\`、\`summary\`、\`content_md\`、\`tags\`。
- \`content_md\`：**纯 Markdown 正文**，从引子第一段开始直到最后一节链接列表；**禁止**在正文最开头写一级 \`#\`（站点标题用 \`title\` 字段）。
- \`title\`：全文写完后自拟，**10～28 字**，概括主线；**禁止**：「日报」「周刊」「速递」、**任何日期**（含「${today}」、年月日、星期、「今日」）。
- \`slug\`：必须恰为 \`ai-daily-${today}\`。
- \`summary\`：**不超过 50 字（含标点）的一句话**，无换行；勿以「本文」「全文」「作者」开头。
- \`tags\`：小写英文 slug，必须含 \`ai\`，其余如 \`llm\`、\`infra\`、\`opensource\` 等，最多 8 个。

结构示意：{"title":"…","slug":"ai-daily-${today}","summary":"…","content_md":"…","tags":["ai",…]}`

  const userPrompt = `【素材日期 ${today}】以下为抓取到的原始材料（多段拼接）。请严格按系统说明撰写 \`content_md\`（叙事化 \`##\` 标题以利 TOC、字数不少于 2800 字），并只返回 JSON：

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
