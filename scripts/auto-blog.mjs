#!/usr/bin/env node
/**
 * 自动博客生成脚本
 * 使用 aread 搜索 + 读取 AI 热点，通过 OpenRouter Qwen3.6 Plus 生成文章，自动发布到博客
 */

import { execSync } from "child_process"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
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

// ── aread 封装 ──

function runCommand(cmd, timeoutMs = 60000) {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return output
  } catch (err) {
    const stderr = err.stderr ? err.stderr.slice(0, 200) : ""
    console.log(`   ⚠️ 命令出错: ${err.message?.slice(0, 100)}`)
    if (stderr) console.log(`   stderr: ${stderr}`)
    return ""
  }
}

function areadSearch(query, num = 8) {
  console.log(`🔍 aread 搜索: ${query}`)
  return runCommand(`aread-cli -r -s "${query}" -n ${num}`, 60000)
}

function areadSearchAndRead(query, num = 3) {
  console.log(`🔍📖 aread 搜索+阅读: ${query}`)
  return runCommand(`aread-cli -r -s "${query}" --read -n ${num}`, 180000)
}

function areadRead(url) {
  console.log(`📖 aread 阅读: ${url}`)
  return runCommand(`aread-cli -r "${url}"`, 60000)
}

// ── OpenRouter API ──

async function callQwen(systemPrompt, userPrompt) {
  console.log("🤖 调用 Qwen 3.6 Plus...")

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://563118077.xyz",
      "X-OpenRouter-Title": "极客开发日志 AutoBlog",
    },
    body: JSON.stringify({
      model: "qwen/qwen3.6-plus:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenRouter 错误: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("AI 返回为空")

  return JSON.parse(content)
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

async function publishPost(token, post) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: post.title,
      slug: post.slug,
      summary: post.summary,
      content_md: post.content_md,
      tags: post.tags || ["ai", "daily"],
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

  if (!OPENROUTER_API_KEY) throw new Error("缺少 OPENROUTER_API_KEY 环境变量")
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

  if (!newsContent || newsContent.length < 300) {
    throw new Error("新闻内容采集不足，无法生成文章")
  }

  // 限制总 token 量
  if (newsContent.length > 15000) {
    newsContent = newsContent.slice(0, 15000)
  }

  console.log(`📊 采集到 ${newsContent.length} 字符新闻内容`)

  // 步骤2：调用 Qwen 3.6 Plus 生成文章
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

  const post = await callQwen(systemPrompt, userPrompt)
  console.log(`✅ AI 生成完成: ${post.title}`)

  // 步骤3：发布
  console.log("🔑 登录管理后台...")
  const token = await getAdminToken()

  console.log("📤 发布文章...")
  const result = await publishPost(token, post)
  console.log(`🎉 发布成功! ID: ${result.id}, slug: ${post.slug}`)
}

main().catch((err) => {
  console.error(`❌ 致命错误: ${err.message}`)
  process.exit(1)
})
