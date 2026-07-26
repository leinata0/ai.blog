import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  buildTokenSignature,
  buildTopicKey,
  clusterResearchItemsByTopic,
  computeTopicSimilarity,
  tokenizeTopicText,
} from '../auto-blog.mjs'

// 2026-07-26 的生产事故：10 个候选主题全部因 `sources:1<3, domains:1<3` 被跳过，一篇都没发出。
// 事故当天的 topic_key 长这样：
//   15-8pt-a9-margin-style-top-c1ba83e2 / 038-https-qbitai-source-title-url-64e4cd75
//   112421-com-href-https-post-sspai-3f0bdd97 / 16-413-59-article-default-href-e65345ce
// 即：签名被 HTML/CSS 标记词、未解码实体、URL 片段和 Jina 抬头占满，中文正文词一个都进不去；
// 而中文本身又被 `[一-鿿]{2,}` 整段吞成单个 token，两家媒体报同一件事也拿不到共同词。
//
// 本文件的用例全部取自那次事故的真实抓取（雷锋网 / 量子位 / 少数派 / TechCrunch / AI News /
// Hacker News 的原始 RSS 字段），不使用编造的标题或摘要 —— 这些字符串本身就是回归基线。

// --- 真实素材 -----------------------------------------------------------------------------

// 雷锋网的 <description> 是裸 HTML，实测单条最长 50732 字符，整段都是内联样式。
const LEIPHONE_OPUS5 = {
  title: 'Claude Opus 5 被曝今晚发布，Fable 5 的水平，腰斩的价格',
  summary: '<section style="text-align: center;margin: 0px 16px;line-height: 1.75em;display: block;"'
    + ' data-mpa-action-id="mmiwq6ij1i3r" data-pm-slice="0 0 []" nodeleaf=""><img class="rich_pages wxw-img"'
    + ' data-aistatus="1" src="https://mmbiz.qpic.cn/mmbiz_jpg/XqAicMdcoiafN9tJrRgJRwyeicB0weLJZbCS.jpg"'
    + ' width="600" height="315"></section><p>Opus 5 能让 Anthropic 夺回主动权吗？</p>',
  url: 'https://www.leiphone.com/category/yanxishe/ngOQ8jWhVY9EAqHp.html',
  source_name: '雷锋网',
  source_group: 'leiphone',
  source_type: 'independent_blog',
  channel_bucket: 'cn_ai_media',
  published_at: '2026-07-24T02:07:00Z',
  score: 0.9,
}

const QBITAI_OPUS5 = {
  title: '半价干翻Fable 5？Opus 5实测炸场，网友：差点从椅子上摔下来',
  summary: '模型变强，Claude Code系统提示词都精简了',
  url: 'https://www.qbitai.com/2026/07/460253.html',
  source_name: '量子位',
  source_group: 'qbitai',
  source_type: 'independent_blog',
  channel_bucket: 'cn_ai_media',
  published_at: '2026-07-25T12:11:39Z',
  score: 0.85,
}

const TECHCRUNCH_OPUS5 = {
  title: 'Anthropic launches Opus 5',
  summary: 'Opus 5 will be both cheaper and less restrictive than Fable, likely making it preferable in most use cases.',
  url: 'https://techcrunch.com/2026/07/24/anthropic-launches-opus-5/',
  source_name: 'TechCrunch AI',
  source_group: 'techcrunch',
  source_type: 'independent_blog',
  channel_bucket: 'global_media',
  published_at: '2026-07-24T17:00:00Z',
  score: 0.8,
}

// 事故当天被 slugify 兜底值 'topic' 强行并成同一个簇的 7 条稿子。它们两两毫无关系，
// 却因为标题是纯中文（slugify 剥掉汉字后只剩 fallback）而共享 title_key，
// 于是成了整池唯一凑得齐 3 源 3 域名、能通过硬门槛的「选题」。
const COLLAPSED_CHINESE_ITEMS = [
  {
    title: '当清洁机器人爬上窗户，能否开启下一个黄金十年？',
    summary: '<p>过去十年，清洁机器人的故事，几乎都发生在地面上。</p><p>扫地、拖地、洗地，从随机碰撞到激光导航。</p>',
    url: 'https://www.leiphone.com/category/robot/dICn6qnKyVa7JRPS.html',
    source_name: '雷锋网',
    source_group: 'leiphone',
    source_type: 'independent_blog',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-24T04:17:00Z',
    score: 0.6,
  },
  {
    title: '“野生测评”造谣拉踩，伤害的不只是车企',
    summary: '<p>一段精心伪造的碰撞测评视频，一条有组织的网络传播链条，一场针对车企的声誉围剿。</p>'
      + '<p style="text-align: center;"><img src="https://static.leiphone.com/uploads/new/images/20260723/6a61e55e898a5.png?imageMogr2"></p>',
    url: 'https://www.leiphone.com/category/industrynews/dWSKcV6GBItdrtB4.html',
    source_name: '雷锋网',
    source_group: 'leiphone',
    source_type: 'independent_blog',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-23T09:58:00Z',
    score: 0.6,
  },
  {
    title: '腾讯混元组织架构再升级，合并大语言模型和多模态团队，加速模型研发',
    summary: '<p>7 月 23 日，腾讯宣布混元多模态模型部门与大语言模型部门合并，成立基础模型部，'
      + '统一由腾讯首席 AI 科学家姚顺雨管理。</p>',
    url: 'https://www.leiphone.com/category/industrynews/LNHgLirIT5DvYfcV.html',
    source_name: '雷锋网',
    source_group: 'leiphone',
    source_type: 'independent_blog',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-24T07:51:00Z',
    score: 0.6,
  },
  {
    title: '角落新声｜数字与实体、有线与无线：我的多场景有声角落构建',
    summary: '编者按：本文是「角落新声」征文活动的入围文章。'
      + '<a href="https://sspai.com/post/112232" target="_blank">查看全文</a>',
    url: 'https://sspai.com/post/112232',
    source_name: '少数派',
    source_group: 'sspai',
    source_type: 'industry_media',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-24T07:00:00Z',
    score: 0.5,
  },
  {
    title: '国产世界模型登顶李飞飞团队榜单！适配国产昇腾算力、代码权重全开源',
    summary: '给它一张图，还你整个世界',
    url: 'https://www.qbitai.com/2026/07/460041.html',
    source_name: '量子位',
    source_group: 'qbitai',
    source_type: 'independent_blog',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-24T14:19:06Z',
    score: 0.7,
  },
  {
    title: '看不见、摸得着的家居要素：聊聊湿度管理的方法与实践',
    summary: '基于这两年的「抗湿经验」，与大家聊聊湿度相关的一些事情。'
      + '<a href="https://sspai.com/post/112093" target="_blank">查看全文</a>',
    url: 'https://sspai.com/post/112093',
    source_name: '少数派',
    source_group: 'sspai',
    source_type: 'industry_media',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-25T03:09:49Z',
    score: 0.5,
  },
  {
    title: '手冲咖啡指北：天太热了，来做一杯不寡淡的冰手冲吧',
    summary: '「太热了，今天不聊了，赶紧回去吹空调。」'
      + '<a href="https://sspai.com/post/112421" target="_blank">查看全文</a>',
    url: 'https://sspai.com/post/112421',
    source_name: '少数派',
    source_group: 'sspai',
    source_type: 'industry_media',
    channel_bucket: 'cn_ai_media',
    published_at: '2026-07-26T07:28:01Z',
    score: 0.5,
  },
]

// Hacker News 的每条 <description> 都是同一段样板：Article URL / Comments URL / Points / # Comments。
const HN_JETZERO = {
  title: 'JetZero',
  summary: '<p>Article URL: <a href="https://www.jetzero.aero">https://www.jetzero.aero</a></p>'
    + ' <p>Comments URL: <a href="https://news.ycombinator.com/item?id=49054224">https://news.ycombinator.com/item?id=49054224</a></p>'
    + ' <p>Points: 210</p> <p># Comments: 190</p>',
  url: 'https://www.jetzero.aero',
  source_name: 'Hacker News',
  source_group: 'hacker-news',
  source_type: 'industry_media',
  channel_bucket: 'community',
  published_at: '2026-07-26T02:55:50Z',
  score: 0.4,
}

const HN_STRANGE = {
  title: 'Turn And Face The Strange',
  summary: '<p>Article URL: <a href="https://fly.io/blog/kurt-scott-money-sprites/">https://fly.io/blog/kurt-scott-money-sprites/</a></p>'
    + ' <p>Comments URL: <a href="https://news.ycombinator.com/item?id=49051369">https://news.ycombinator.com/item?id=49051369</a></p>'
    + ' <p>Points: 210</p> <p># Comments: 133</p>',
  url: 'https://fly.io/blog/kurt-scott-money-sprites/',
  source_name: 'Hacker News',
  source_group: 'hacker-news',
  source_type: 'industry_media',
  channel_bucket: 'community',
  published_at: '2026-07-25T20:43:11Z',
  score: 0.4,
}

const TECHCRUNCH_HEALTH = {
  title: 'OpenAI makes ChatGPT Health available to all US users',
  summary: 'Users can also integrate their personal data from services like Apple Health, Function, and MyFitnessPal.',
  url: 'https://techcrunch.com/2026/07/23/openai-makes-chatgpt-health-available-to-all-u-s-users/',
  source_name: 'TechCrunch AI',
  source_group: 'techcrunch',
  source_type: 'independent_blog',
  channel_bucket: 'global_media',
  published_at: '2026-07-23T17:00:00Z',
  score: 0.8,
}

const AINEWS_HEALTH = {
  title: 'OpenAI pushes ChatGPT into patient health records',
  summary: '<p>OpenAI is deploying a Health feature inside ChatGPT, giving users the option to connect'
    + ' Apple Health data and medical records to the chatbot. Logged-in users aged 18 and older can access'
    + ' it now on web and iOS, across the Free, Go, Plus, and Pro tiers.</p>',
  url: 'https://www.artificialintelligence-news.com/news/openai-pushes-chatgpt-into-patient-health-records/',
  source_name: 'AI News',
  source_group: 'ai-news',
  source_type: 'independent_blog',
  channel_bucket: 'global_media',
  published_at: '2026-07-24T14:58:17Z',
  score: 0.75,
}

const TECHCRUNCH_LAYOFFS = {
  title: 'Monday.com is the latest tech company to blame AI for layoffs — here are 20 others',
  summary: 'A chronological list of the bigger layoffs at tech companies in 2026.',
  url: 'https://techcrunch.com/2026/07/25/the-running-list-major-tech-layoffs-in-2026-where-employers-cited-ai/',
  source_name: 'TechCrunch AI',
  source_group: 'techcrunch',
  source_type: 'independent_blog',
  channel_bucket: 'global_media',
  published_at: '2026-07-25T12:00:00Z',
  score: 0.8,
}

// --- 分词层 -------------------------------------------------------------------------------

test('连续汉字被切成二元组，而不是整段吞成一个 token', () => {
  const tokens = tokenizeTopicText('3万小时触觉数据补齐具身智能')

  // 旧实现（`[一-鿿]{2,}`）在这里只产出 1 个 token：「万小时触觉数据补齐具身智能」。
  // 只要措辞差一个字，两家媒体就永远拿不到共同 token —— 中文来源之间从未聚成过簇。
  assert.ok(!tokens.includes('万小时触觉数据补齐具身智能'))
  assert.ok(tokens.includes('触觉'))
  assert.ok(tokens.includes('具身'))
  assert.ok(tokens.every((token) => !/^[一-鿿]{3,}$/.test(token)))
})

test('HTML 摘要不再产出 href / style / margin / px / 8pt 这类标记 token', () => {
  const signature = buildTokenSignature(LEIPHONE_OPUS5)

  for (const noise of ['href', 'style', 'margin', 'section', 'px', '8pt', 'img', 'width', 'height', 'nodeleaf']) {
    assert.ok(!signature.includes(noise), `signature should not contain markup token "${noise}": ${signature.join(',')}`)
  }
  // URL 片段（域名、路径段）同样不该占用签名位置。
  for (const noise of ['https', 'mmbiz', 'qpic', 'com', 'cn', 'jpg']) {
    assert.ok(!signature.includes(noise), `signature should not contain url token "${noise}": ${signature.join(',')}`)
  }
  assert.ok(signature.includes('claude'))
  assert.ok(signature.includes('opus'))
})

test('&#038; 被解码，不再贡献一个名叫 038 的 token', () => {
  // 事故日志里的 `038-https-qbitai-source-title-url-64e4cd75` 就是这条标题产生的。
  const item = {
    title: '3万小时触觉数据补齐具身智能“手感”！新智具身&#038;复旦报告三连发',
    summary: '项目数据模型均开源',
    url: 'https://www.qbitai.com/2026/07/460962.html',
  }

  assert.ok(!buildTokenSignature(item).includes('038'))
  assert.ok(!buildTopicKey(item).includes('038'))
  // `&amp;` / `&nbsp;` / `&#8217;` 同理。
  assert.ok(!tokenizeTopicText('Librarians host &#8216;Avoiding AI&#8217; workshops').includes('8216'))
  assert.ok(!tokenizeTopicText('Tencent&nbsp;Hunyuan&amp;Fudan').includes('nbsp'))
})

test('Jina reader 的抬头不会给每条素材注入同一组 token', () => {
  // r.jina.ai 的输出固定以 `Title: / URL Source: / Published Time: / Markdown Content:` 开头，
  // 本次抓取 20 条取全文的素材 20/20 都带它。抬头留在签名里，等于给所有取过全文的素材
  // 发一组共同 token（事故日志里的 `...-source-title-url-...`），拉出虚假相似度。
  const jina = (title, body) => [
    `Title: ${title}`,
    '',
    `URL Source: https://example.com/${encodeURIComponent(title)}`,
    '',
    'Published Time: 2026-07-24T17:00:00+00:00',
    '',
    'Markdown Content:',
    body,
  ].join('\n')

  const left = { title: 'Alpha protocol ships', full_text: jina('Alpha protocol ships', 'Alpha protocol shipped today.') }
  const right = { title: 'Beta rollout paused', full_text: jina('Beta rollout paused', 'Beta rollout was paused.') }

  for (const token of ['markdown', 'url', 'source', 'published']) {
    assert.ok(!buildTokenSignature(left).includes(token), `preamble token leaked: ${token}`)
  }
  assert.equal(computeTopicSimilarity(buildTokenSignature(left), buildTokenSignature(right)), 0)
})

test('Hacker News 的 Article URL / Points 样板不再制造相似度', () => {
  // 两条毫不相关的 HN 条目，标题几乎没有实词，旧的样板 token（article/url/comments/points）
  // 一度让它们的相似度达到 0.571 —— 高于生产阈值。
  const similarity = computeTopicSimilarity(buildTokenSignature(HN_JETZERO), buildTokenSignature(HN_STRANGE))

  assert.ok(similarity < 0.5, `unrelated HN items should stay apart, got ${similarity}`)
  assert.equal(clusterResearchItemsByTopic([HN_JETZERO, HN_STRANGE]).length, 2)
})

// --- 聚类层：召回 -------------------------------------------------------------------------

test('中文同题不同表述的两条会聚到一起', () => {
  // 雷锋网与量子位报道的是同一件事（Claude Opus 5 以对折价格发布）。
  // 旧实现下这一对的相似度是 0.30，且它拿到分数靠的是 claude/opus/fable 三个拉丁专名，
  // 中文部分贡献为 0；本次切分后 CJK 与拉丁分视图比较，这一对是 1.000。
  const similarity = computeTopicSimilarity(
    buildTokenSignature(LEIPHONE_OPUS5),
    buildTokenSignature(QBITAI_OPUS5),
  )
  assert.ok(similarity >= 0.5, `same-story CN pair should merge, got ${similarity}`)

  const clusters = clusterResearchItemsByTopic([LEIPHONE_OPUS5, QBITAI_OPUS5])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].source_count, 2)
})

test('同一件事的中英文报道也会聚到一起，凑出跨域名的选题', () => {
  const clusters = clusterResearchItemsByTopic([LEIPHONE_OPUS5, QBITAI_OPUS5, TECHCRUNCH_OPUS5])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].source_count, 3)
  assert.deepEqual([...clusters[0].source_groups].sort(), ['leiphone', 'qbitai', 'techcrunch'])
  // 这正是硬门槛要求的形状：3 个来源、3 个域名。事故当天没有任何一个簇能达到。
  assert.equal(new Set(clusters[0].items.map((item) => new URL(item.url).hostname)).size, 3)
})

// --- 聚类层：精确率（与召回同等重要）-------------------------------------------------------

test('不过度聚类：事故当天被并成一簇的 7 条中文稿现在各自成簇', () => {
  // 旧实现里 slugify(纯中文标题) 一律塌成 fallback 'topic'，而 `titleKey === cluster.title_key`
  // 这条分支根本不看相似度，于是这 7 条被强行并成 1 簇（两两真实相似度为 0），
  // 并且成为整池唯一能过 `min_sources 3 / min_cited_domains 3` 的「选题」。
  const clusters = clusterResearchItemsByTopic(COLLAPSED_CHINESE_ITEMS)

  assert.equal(clusters.length, COLLAPSED_CHINESE_ITEMS.length)
  assert.equal(Math.max(...clusters.map((cluster) => cluster.items.length)), 1)
})

test('不过度聚类：明显无关的两条中文稿相似度为 0', () => {
  const pairs = [
    ['腾讯混元组织架构再升级，合并大语言模型和多模态团队，加速模型研发', '看不见、摸得着的家居要素：聊聊湿度管理的方法与实践'],
    ['当清洁机器人爬上窗户，能否开启下一个黄金十年？', '角落新声｜数字与实体、有线与无线：我的多场景有声角落构建'],
    ['3万小时触觉数据补齐具身智能“手感”！新智具身&#038;复旦报告三连发', '奇瑞“不客气”了！风云A9打破15万级纯电“潜规则”'],
    ['100%开源！吴恩达做了个个人桌面Agent', '手冲咖啡指北：天太热了，来做一杯不寡淡的冰手冲吧'],
  ]

  for (const [left, right] of pairs) {
    const similarity = computeTopicSimilarity(
      buildTokenSignature({ title: left }),
      buildTokenSignature({ title: right }),
    )
    assert.equal(similarity, 0, `unrelated pair scored ${similarity}: ${left} <> ${right}`)
  }
})

test('不过度聚类：只共享一两个拉丁词不足以判为同题', () => {
  // 中文稿的拉丁 token 往往只有两三个，撞上一个就判同题会把整池串成一簇。
  const left = { title: '北京说Agent已经能造世界，杭州却说它是刚发明的电灯泡', summary: '两地论坛观点交锋' }
  const right = { title: 'Why Cognition bought Poke: AI personality is becoming a competitive advantage', summary: 'The startup is betting on agent personality.' }

  assert.ok(computeTopicSimilarity(buildTokenSignature(left), buildTokenSignature(right)) < 0.5)
})

// --- 英文路径不退化 -----------------------------------------------------------------------

test('英文同题仍然聚到一起，无关英文条目仍然分开', () => {
  const merged = clusterResearchItemsByTopic([TECHCRUNCH_HEALTH, AINEWS_HEALTH])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].source_count, 2)

  const split = clusterResearchItemsByTopic([TECHCRUNCH_LAYOFFS, HN_JETZERO])
  assert.equal(split.length, 2)
})

test('topic_key 仍然是 URL 安全的短串，且优先用拉丁 token', () => {
  const key = buildTopicKey(LEIPHONE_OPUS5)

  assert.ok(key.length > 0 && key.length <= 80)
  assert.match(key, /^[a-z0-9-]+$/)
  assert.ok(key.includes('claude') || key.includes('opus'))

  // 纯中文、无拉丁词的标题没有可读前缀可用，但仍须产出合法 key（簇 key 另有 URL 指纹保证唯一）。
  const cjkOnly = buildTopicKey({ title: '手冲咖啡指北：天太热了，来做一杯不寡淡的冰手冲吧' })
  assert.match(cjkOnly, /^[a-z0-9-]+$/)
  assert.ok(cjkOnly.length > 0)
})

// --- 分词器必须只有一份 -------------------------------------------------------------------

// 这个仓库连续三次栽在「同一套分词逻辑被抄了好几份、只修其中一份」上：
// PR#62 修的是 auto-blog 的 relevanceTokens，本次事故修的是 auto-blog 的 tokenizeTopicText，
// 而 blogwatcher 里那份一直没跟上——它决定 blogwatcher 兜底捞回来的条目算不算相关，
// 而那些条目会被日报的来源支持门槛当作正式来源计数。现在三处都指向 lib/topic-tokens.mjs，
// 这个用例负责让它们不再各走各的。
test('blogwatcher 与选题聚类共用同一个分词器', async () => {
  const shared = await import('../lib/topic-tokens.mjs')
  const cases = [
    '3万小时触觉数据补齐具身智能“手感”！新智具身&#038;复旦报告三连发',
    '<section style="text-align: center;margin: 0px 16px;">正文在这里</section>',
    'Introducing Claude Opus 5',
    'block/buzz',
  ]
  for (const value of cases) {
    assert.deepEqual(
      tokenizeTopicText(value),
      shared.tokenizeTopicText(value),
      `auto-blog 的转出口必须就是 lib/topic-tokens.mjs 的实现：${value}`,
    )
  }

  // blogwatcher 不再自带 tokenizeTopicText / countTokenOverlap / TOPIC_MATCH_STOP_WORDS。
  const source = await readFile(new URL('../lib/blogwatcher.mjs', import.meta.url), 'utf8')
  assert.ok(
    source.includes("from './topic-tokens.mjs'"),
    'blogwatcher 必须从 lib/topic-tokens.mjs 取分词器，不要再抄一份',
  )
  assert.doesNotMatch(
    source,
    /function tokenizeTopicText\s*\(/,
    'blogwatcher 里又出现了一份本地 tokenizeTopicText',
  )
  assert.doesNotMatch(
    source,
    /TOPIC_MATCH_STOP_WORDS/,
    'blogwatcher 里又出现了一份本地停用词表',
  )
})
