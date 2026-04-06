#!/usr/bin/env node
/**
 * 自动博客生成脚本
 * 使用 aread 搜索 + 读取 AI 热点，通过 LLM 生成文章并发布。
 * LLM：优先 Google AI Studio「Gemini 1.5 Flash」（GEMINI_API_KEY），失败则 OpenRouter（OPENROUTER_API_KEY）。
 * 环境变量见文末说明。
 */

import { execSync } from "child_process"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim()
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim()
/** AI Studio 模型 id，默认 gemini-1.5-flash；若提示模型不可用可改为 gemini-2.0-flash 等 */
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash"
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

// ── OpenRouter API（免费模型上游易 429：多模型 + 重试）──

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 默认可在 OpenRouter 免费使用的 Qwen 系列（上游限流时会自动换下一个） */
const DEFAULT_OPENROUTER_MODELS = [
  "qwen/qwen3.6-plus:free",
  "qwen/qwen3-30b-a3b:free",
  "qwen/qwen3-235b-a22b:free",
]

function resolveModelList() {
  const customList = process.env.OPENROUTER_MODELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (customList?.length) return customList

  const single = process.env.OPENROUTER_MODEL?.trim()
  if (single) {
    const rest = DEFAULT_OPENROUTER_MODELS.filter((m) => m !== single)
    return [single, ...rest]
  }
  return [...DEFAULT_OPENROUTER_MODELS]
}

async function callQwen(systemPrompt, userPrompt) {
  if (!OPENROUTER_API_KEY) throw new Error("未配置 OPENROUTER_API_KEY")

  const models = resolveModelList()
  let lastError = ""

  for (const model of models) {
    console.log(`🤖 OpenRouter 请求模型: ${model}`)

    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        const sec = [0, 25, 60, 120][attempt - 1]
        console.log(`   ⏳ 第 ${attempt} 次尝试，等待 ${sec}s（缓解上游 429）…`)
        await sleep(sec * 1000)
      }

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://563118077.xyz",
          "X-OpenRouter-Title": "Geek Dev Blog Auto-Post",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
      })

      const errText = await resp.clone().text()

      if (resp.status === 429) {
        lastError = errText
        console.log(`   429 限流（${model}），将重试或换模型…`)
        continue
      }

      if (!resp.ok) {
        lastError = errText
        console.log(`   HTTP ${resp.status}，换模型或重试…`)
        if (resp.status >= 500) continue
        break
      }

      const data = await resp.json()
      let raw = data.choices?.[0]?.message?.content
      if (!raw) {
        lastError = "AI 返回为空"
        continue
      }

      raw = raw.trim()
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/m, "")
      }
      try {
        console.log(`   ✓ 成功: ${model}`)
        return JSON.parse(raw)
      } catch {
        lastError = `JSON 解析失败: ${raw.slice(0, 200)}`
      }
    }
    console.log(`↪️ 切换到下一备用模型…`)
  }

  throw new Error(
    `OpenRouter 全部模型失败（常为免费层 429 上游限流）。最后错误: ${lastError.slice(0, 500)}`
  )
}

/** Google AI Studio Gemini generateContent（与 OpenRouter 返回同一 JSON 结构） */
async function callGemini15Flash(systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`

  let lastError = ""
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) {
      const sec = [0, 15, 45, 90][attempt - 1]
      console.log(`   ⏳ Gemini 第 ${attempt} 次尝试，等待 ${sec}s…`)
      await sleep(sec * 1000)
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
    })

    const errText = await resp.clone().text()

    if (resp.status === 429 || resp.status === 503) {
      lastError = errText
      console.log(`   Gemini HTTP ${resp.status}，将重试…`)
      continue
    }

    if (!resp.ok) {
      lastError = errText
      throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 400)}`)
    }

    const data = await resp.json()
    const cand = data.candidates?.[0]
    const reason = cand?.finishReason
    if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
      lastError = `Gemini finishReason=${reason}`
      console.log(`   ⚠️ ${lastError}`)
      continue
    }

    let raw = cand?.content?.parts?.map((p) => p.text || "").join("") || ""
    if (!raw) {
      lastError = JSON.stringify(data).slice(0, 300)
      continue
    }

    raw = raw.trim()
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/m, "")
    }
    try {
      console.log(`   ✓ Gemini 成功: ${GEMINI_MODEL}`)
      return JSON.parse(raw)
    } catch {
      lastError = `Gemini JSON 解析失败: ${raw.slice(0, 200)}`
    }
  }

  throw new Error(`Gemini 多次重试仍失败: ${lastError.slice(0, 500)}`)
}

/**
 * 生成博文 JSON：默认先试 Gemini（若配置了 GEMINI_API_KEY），再试 OpenRouter。
 * LLM_ORDER=gemini,openrouter | openrouter,gemini | gemini | openrouter
 */
async function generatePostJson(systemPrompt, userPrompt) {
  const explicit = process.env.LLM_ORDER?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === "gemini" || s === "openrouter")

  let order
  if (explicit?.length) {
    order = explicit
  } else if (GEMINI_API_KEY && OPENROUTER_API_KEY) {
    order = ["gemini", "openrouter"]
  } else if (GEMINI_API_KEY) {
    order = ["gemini"]
  } else if (OPENROUTER_API_KEY) {
    order = ["openrouter"]
  } else {
    throw new Error("请至少配置 GEMINI_API_KEY（Google AI Studio）或 OPENROUTER_API_KEY 之一")
  }

  const ready = order.filter((p) => {
    if (p === "gemini") return !!GEMINI_API_KEY
    if (p === "openrouter") return !!OPENROUTER_API_KEY
    return false
  })
  if (!ready.length) {
    throw new Error("LLM_ORDER 中的提供方与已配置的密钥不匹配（例如要求 gemini 但未设置 GEMINI_API_KEY）")
  }

  let last = ""
  for (const p of ready) {
    try {
      if (p === "gemini") {
        console.log(`🌟 LLM: Google Gemini (${GEMINI_MODEL})`)
        return await callGemini15Flash(systemPrompt, userPrompt)
      }
      console.log("🤖 LLM: OpenRouter")
      return await callQwen(systemPrompt, userPrompt)
    } catch (e) {
      last = e.message
      console.log(`↪️ ${p} 未成功: ${e.message.slice(0, 180)}`)
    }
  }
  throw new Error(`所有已配置的 LLM 均失败。最后错误: ${last}`)
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

  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY) {
    throw new Error("请至少配置 GEMINI_API_KEY 或 OPENROUTER_API_KEY")
  }
  if (!ADMIN_PASSWORD) throw new Error("缺少 ADMIN_PASSWORD 环境变量")

  const today = new Date().toISOString().split("T")[0]
  const slug = `ai-daily-${today}`

  // 检查是否已发布
  if (await checkSlugExists(slug)) {
    console.log(`⏭️ 今日文章已存在 (${slug})，跳过`)
    return
  }

  // 步骤1：用 aread 搜索+阅读 AI 新闻
  const queryIndex = new Date().getDate() % SEARCH_QUERIES.length
  const query = SEARCH_QUERIES[queryIndex]

  // 先搜索+阅读前 3 条结果（最核心的信息）
  let newsContent = areadSearchAndRead(query, 3)

  // 如果搜索+阅读失败，退级为仅搜索
  if (!newsContent || newsContent.length < 200) {
    console.log("⚠️ 搜索+阅读结果不足，尝试仅搜索...")
    newsContent = areadSearch(query, 8)
  }

  // 补充：直接阅读 TechCrunch AI 页面获取最新头条
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

  // 步骤2：调用 Gemini / OpenRouter 生成文章
  const systemPrompt = `你是一个专业的 AI 技术博客作者，博客名为"极客开发日志"。请根据提供的今日 AI 领域资讯，撰写一篇高质量的中文技术博客文章。

要求：
1. 标题格式："AI 日报 | YYYY-MM-DD：2-3个核心关键词"
2. 从原始资料中提取 3-5 个最重要的 AI 热点
3. 每个热点用二级标题，包含：事件概述 → 技术要点 → 影响分析
4. 开头写一段 50-80 字的总览概述
5. 结尾写"总结与展望"
6. Markdown 格式，善用加粗、列表、引用块、代码块
7. 文末"参考来源"标题下列出来源链接
8. 总字数 1500-3000

返回严格 JSON（不要 markdown 代码块包裹）：
{
  "title": "AI 日报 | ${today}：核心关键词",
  "slug": "ai-daily-${today}",
  "summary": "80字以内中文摘要",
  "content_md": "完整 Markdown 正文",
  "tags": ["ai", "daily", "其他1-2个标签"]
}`

  const userPrompt = `今天是 ${today}，以下是通过 aread 工具搜索和阅读获取的 AI 领域最新资讯：

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
