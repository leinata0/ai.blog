import { resolveAdminPassword, resolveBlogApiBase } from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_PASSWORD = resolveAdminPassword()
const SLUG = "auto-blog-architecture-and-cloudflare"

const CONTENT_MD = `## 一、为什么要做自动化 AI 日报？

作为一个喜欢折腾的开发者，我每天都会刷大量的 AI 和技术资讯——OpenAI 又发了什么、Anthropic 搞了什么新花样、Hacker News 上又在吵什么。但零散地刷信息和系统地输出内容完全是两回事。我想要的是一个能自动帮我「读新闻、选话题、写文章、发博客」的流水线，每天早上醒来博客上就多了一篇有深度的技术分析文章。

说白了，这不是为了偷懒，而是想验证一个想法：**用 AI 辅助内容生产，到底能做到什么程度？** 从 RSS 抓取到 LLM 生成再到自动发布，整条链路能不能跑通？质量能不能达到「不丢人」的水平？

经过几轮迭代，这套系统现在每天 UTC 01:00（北京时间 09:00）自动运行，从 10 个 RSS 源抓取素材，经过 Jina Reader 全文提取、两阶段 LLM 生成、Grok 封面图生成，最终自动发布到博客。整个过程大约 2-3 分钟，成本不到 1 块钱。

## 二、搜索架构的演变：从简单到可靠

### 最初的想法：直接让 AI 搜索

一开始我想得很简单——直接调用搜索 API，把结果喂给 LLM 写文章。但很快发现这条路走不通：搜索 API 要么贵（Google Custom Search），要么结果质量差（免费方案），而且搜索结果只有摘要，没有全文，LLM 写出来的东西浮于表面。

### 现在的方案：RSS + Jina Reader 两层架构

最终我选择了一个更稳定的方案：

| 层级 | 技术 | 作用 |
|------|------|------|
| 数据源 | 10 个 RSS/Atom 源 | 覆盖 AI、开源、独立开发者等领域 |
| 全文提取 | Jina Reader API | 把 URL 转成干净的 Markdown 全文 |
| 去重清洗 | 指纹+URL 双重去重 | 避免重复内容污染素材 |
| 智能截断 | 段落边界感知截断 | 26000 字符上限，不会截断在句子中间 |

**RSS 源的选择很讲究。** 我挑了 10 个源，刻意做了多样性平衡：英文有 OpenAI Blog、Anthropic、Google AI、Hugging Face、Simon Willison（独立开发者视角）、Hacker News（社区热点）、GitHub Trending（开源动态）、TechCrunch AI；中文有少数派和阮一峰。这样每天的素材既有前沿论文解读，也有工程实践，还有社区讨论。

**Jina Reader 是这套架构的关键一环。** RSS 只给你标题和摘要，但写一篇有深度的文章需要全文。Jina Reader 的 \`r.jina.ai\` 端点能把任意 URL 转成干净的 Markdown，去掉导航栏、广告、Cookie 弹窗这些噪音。我设了 5 路并发，15 篇文章的全文抓取大约 10 秒搞定。

**后备机制也很重要。** RSS 源不是 100% 可靠的——有时候某个源挂了，有时候返回的内容太少。所以我加了一个后备逻辑：如果 RSS 素材不足 300 字符，就直接用 Jina Reader 去读 TechCrunch AI 和 Reuters AI 的页面。这样即使 RSS 全挂了，系统也不会空转。

### 这套架构的优缺点

**优点：**
- 零成本：RSS 免费，Jina Reader 免费额度足够
- 稳定：不依赖搜索 API 的配额和定价变化
- 质量高：全文素材让 LLM 能写出有深度的分析
- 可控：我能精确控制信息源的质量和方向

**缺点：**
- 覆盖面有限：只能获取已订阅源的内容，可能错过突发新闻
- RSS 源需要维护：源挂了或者改了格式需要手动修复
- 时效性取决于源的更新频率

我觉得对于一个个人博客来说，这些缺点完全可以接受。比起追求「什么都覆盖」，我更在意「覆盖到的内容质量够高」。

## 三、LLM 选型：为什么是 DeepSeek-V3 + SiliconFlow

### 选型过程

LLM 的选择经历了几轮对比。我的需求很明确：能写长文（3000-4500 字）、中文质量好、支持 JSON 输出、价格便宜。

| 模型 | 中文质量 | 长文能力 | 价格 | 最终选择 |
|------|---------|---------|------|---------|
| GPT-4o | 优秀 | 优秀 | 贵 | ❌ 成本太高 |
| Claude 3.5 | 优秀 | 优秀 | 贵 | ❌ 同上 |
| DeepSeek-V3 | 优秀 | 优秀 | 极便宜 | ✅ |
| Qwen-2.5 | 良好 | 良好 | 便宜 | 备选 |

**DeepSeek-V3 胜出的原因很简单：中文写作质量接近 GPT-4o，但价格只有它的几十分之一。** 通过 SiliconFlow 的 API 调用，每篇文章的 LLM 成本大约 0.01-0.02 元人民币。一个月下来不到 1 块钱，这个成本几乎可以忽略。

### 两阶段生成策略

直接让 LLM 一步到位写完整文章，效果往往不好——要么跑题，要么结构混乱，要么变成新闻罗列。所以我把生成过程拆成了两个阶段：

**阶段一：选题 + 大纲（轻量调用，2048 tokens）**

这一步让 LLM 从素材中选出 1-2 个最有深度的话题作为主线，生成章节大纲、标签、封面图描述。这一步消耗的 token 很少，但对最终质量影响巨大——好的选题和大纲是好文章的基础。

**阶段二：正文生成（重量调用，16384 tokens）**

拿到大纲后，把大纲和完整素材一起喂给 LLM，让它按照大纲展开写作。这一步我在 prompt 里放了一篇参考文章的片段作为 few-shot 示例，让 LLM 模仿那种「段落饱满、表格对比、口语化表达」的风格。

有意思的是，**prompt 工程对文章质量的影响远超模型选择。** 同一个 DeepSeek-V3，换一套 prompt 写出来的东西天差地别。我前后迭代了十几版 prompt，最终总结出几个关键点：

- 明确禁止套话（「值得关注的是」「让我们拭目以待」这类废话）
- 鼓励口语化表达（「我觉得」「说白了」「有意思的是」）
- 用具体的范例比抽象的规则有效 10 倍
- 字数要求必须放在 prompt 最前面，否则模型会偷懒

### 图片与写作的解耦

这里有一个踩坑经验值得分享。一开始我试过在 LLM 写作的 prompt 里加入图片插入规则，让它在正文中插入素材图片。结果发现**图片相关的指令严重拖累了文章质量**——模型的注意力被分散了，正文变短、结构变差、内容变浅。

最终的方案是完全解耦：LLM 只管写文章，prompt 里零图片相关指令。封面图由 Grok 独立生成，程序化处理。这样 LLM 能 100% 专注在写作质量上。

## 四、Cloudflare 配置与域名选择

### 为什么需要 Cloudflare

博客的前端部署在 Vercel，后端部署在 Render。这两个平台在国外访问没问题，但在国内——基本上打不开，或者慢到让人崩溃。Vercel 和 Render 的服务器都在海外，国内用户直连延迟高、丢包严重，有时候甚至被墙。

**Cloudflare 是解决这个问题的最佳方案，而且完全免费。** 说它是「互联网的慈善家」一点不夸张——免费的 CDN、免费的 SSL、免费的 DNS、免费的 DDoS 防护，对个人开发者来说简直是救星。

### 域名选择：纯数字域名的考量

域名我在 Spaceship 上买的，选了一个纯数字域名。原因很实际：

1. **便宜**：纯数字 .xyz 域名价格很低
2. **好记**：对国内用户来说，数字域名比英文域名更容易记住和输入
3. **可用性**：好的英文短域名早就被抢光了，纯数字域名选择余地大

Spaceship 的购买体验还不错，价格透明，续费也不会突然涨价（某些注册商第一年便宜第二年翻倍的套路太恶心了）。

### DNS 配置过程

配置过程出奇地顺利，Cloudflare 的引导做得很好：

1. 在 Cloudflare 添加站点，获取两个 NS 记录
2. 去 Spaceship 把域名的 NS 服务器改成 Cloudflare 的
3. 等待 DNS 传播（通常几分钟到几小时）
4. 在 Cloudflare 添加 DNS 记录：前端 CNAME 指向 Vercel，后端 CNAME 指向 Render
5. 开启代理模式（橙色云朵），让流量走 Cloudflare 的 CDN

**SSL 配置是自动的。** Cloudflare 会自动签发和续期 SSL 证书，完全不用操心。我选的是「Full (Strict)」模式，Cloudflare 到源站之间也是加密的。

整个过程没有遇到什么坑，大概 20 分钟就搞定了。Cloudflare 的文档和 UI 都很清晰，对新手非常友好。

### 效果对比

配置前后的差异非常明显：

| 指标 | 配置前（直连） | 配置后（Cloudflare） |
|------|-------------|-------------------|
| 国内访问 | 需要 VPN | 直接访问 |
| 首屏加载 | 5-10 秒 | 1-2 秒 |
| SSL 证书 | 需要手动配置 | 自动签发续期 |
| DDoS 防护 | 无 | 免费基础防护 |

## 五、Grok 封面图生成：最后一块拼图

### 为什么选 Grok

博客文章有封面图和没封面图，视觉效果差很多。但素材里提取的图片往往和文章主题不相关（比如一篇讲 AI 模型的文章配了张水管施工照片），所以我需要一个能根据文章主题生成相关配图的方案。

xAI 的 Grok Imagine API 是目前性价比最高的选择：\`grok-imagine-image\` 模型每张图只要 $0.02，质量不错，而且支持 OpenAI 兼容的 API 格式，集成起来很简单。

### 集成方式

封面图的生成流程是这样的：

1. **阶段一大纲**里让 LLM 输出一个 \`cover_prompt\`——用一句英文描述适合做封面的宽幅横图
2. 调用 Grok API 生成图片，prompt 前缀加上 \`Wide landscape banner, cinematic, high quality:\` 确保生成宽幅图
3. 下载生成的图片到本地
4. 通过博客后端的 \`/api/admin/upload\` 接口上传到自己的服务器
5. 拿到永久的本地 URL（如 \`/uploads/auto-blog-xxx.jpg\`），设为文章封面

**关键设计决策：图片存在自己服务器上。** 一开始我试过直接用外部图片 URL，但外部 URL 太不可靠了——源站限速、热链保护、URL 过期都会导致图片加载失败。把图片下载后上传到自己的服务器，URL 就永远不会失效。每天 2-3 张图片，每张几百 KB，一年下来也就几百 MB，对服务器完全没压力。

### 只做封面，不插正文

这也是一个踩坑后的决策。我试过让系统在正文里也插入图片，结果发现：

- 素材图片和文章主题不匹配（前面说的水管照片事件）
- AI 生成的图片插在正文里显得突兀
- 图片处理逻辑会拖慢整个流水线

最终方案是**只生成一张封面图**，正文保持纯文字。干净的文字排版比塞满不相关图片的文章好看得多。

## 六、写在最后

这套自动化日报系统跑了一段时间，我最大的感受是：**自动化的价值不在于替代人，而在于把重复劳动变成一次性工程。** 搭建这套系统花了不少时间，但一旦跑起来，每天就是零成本地产出内容。

当然，AI 生成的文章和人写的还是有差距。但作为一个技术博客的日常更新，质量已经够用了。更重要的是，这个过程本身就是一次很好的工程实践——RSS 解析、并发控制、LLM prompt 工程、图片处理、CI/CD 自动化，每一块都有值得深挖的东西。

> 最好的自动化不是让机器替你思考，而是让机器替你执行那些你已经想清楚的事情。`

async function main() {
  // Login
  const loginResp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  })
  if (!loginResp.ok) { console.log("Login failed"); return }
  const token = (await loginResp.json()).access_token
  console.log("Login OK")

  // Update content_md directly by ID
  const updateResp = await fetch(`${BLOG_API_BASE}/api/admin/posts/6`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content_md: CONTENT_MD }),
  })
  if (!updateResp.ok) { console.log("Update failed:", updateResp.status, await updateResp.text()); return }
  console.log("Content updated with backticks!")
}
main().catch(e => console.error(e.message))
