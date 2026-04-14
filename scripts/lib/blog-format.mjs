const SHARED_TAIL_SECTIONS = [
  '## 参考来源',
  '## 图片来源',
  '## 一句话结论',
]

const SHARED_BANNED_PHRASES = [
  '让我们拭目以待',
  '值得关注的是',
  '不难看出',
  '可以预见',
  '综上所述',
  '总的来说',
  '毋庸置疑',
  '引发广泛关注',
  '再次证明了',
]

const SHARED_ANALYSIS_MARKERS = [
  '意味着',
  '代价',
  '取舍',
  '影响',
  '问题在于',
  '更关键的是',
  '换句话说',
  '真正值得注意',
]

const FORMAT_PROFILES = {
  'tech-editorial-v1': {
    name: 'tech-editorial-v1',
    sections: [
      '## 一、发生了什么',
      '## 二、为什么这件事值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果结合论文/历史脉络，该怎么理解',
      '## 五、我的判断',
      ...SHARED_TAIL_SECTIONS.slice(0, 2),
    ],
    required_sections: [
      '## 一、发生了什么',
      '## 二、为什么这件事值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果结合论文/历史脉络，该怎么理解',
      '## 五、我的判断',
    ],
    required_tail_sections: [...SHARED_TAIL_SECTIONS.slice(0, 2)],
    title_rules: [
      '标题必须是中文，避免“日报”“速递”“周报”式新闻口吻。',
      '标题要体现核心判断或核心矛盾，不只是复述事件。',
      '标题长度控制在 10-28 个中文字符。',
    ],
    summary_rules: [
      '摘要只用一段话，直接给出文章主判断。',
      '摘要不要以“本文将”或“这篇文章”开头。',
      '摘要不超过 50 个中文字符。',
    ],
    citation_rules: [
      '事实陈述优先对应官方博客、原始新闻源、论文摘要或高质量技术博客。',
      '论文引用必须说明论文与现实产品、新闻或工程实践的关系。',
      '避免堆砌来源，要提炼不同来源之间的差异。',
    ],
    image_rules: [
      '正文插图只服务于解释，不要让图片取代论证。',
      '正文插图不能影响 Grok 封面图生成逻辑。',
      '图片来源统一放在文末的“图片来源”区块。',
    ],
    style_rules: [
      '区分事实与观点，给出明确的主判断。',
      '至少做两处对比、影响或取舍分析。',
      '避免新闻罗列和套话总结。',
      '段落要饱满，每段保持完整论述而不是短句拼接。',
    ],
    banned_phrases: [...SHARED_BANNED_PHRASES],
    analysis_markers: [...SHARED_ANALYSIS_MARKERS],
  },
  'weekly-review-v1': {
    name: 'weekly-review-v1',
    sections: [
      '## 一、本周发生了什么',
      '## 二、哪些变化最值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果拉长到产品与行业节奏',
      '## 五、下周还要继续观察什么',
      ...SHARED_TAIL_SECTIONS.slice(0, 2),
    ],
    required_sections: [
      '## 一、本周发生了什么',
      '## 二、哪些变化最值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果拉长到产品与行业节奏',
      '## 五、下周还要继续观察什么',
    ],
    required_tail_sections: [...SHARED_TAIL_SECTIONS.slice(0, 2)],
    title_rules: [
      '标题必须体现一周内最重要的变化或判断，避免直接写成“第X周周报”。',
      '优先突出趋势、节奏变化或战略转向，不写成消息列表标题。',
      '标题长度控制在 12-30 个中文字符。',
    ],
    summary_rules: [
      '摘要要用一段话概括本周最关键的变化，不要把摘要写成目录。',
      '摘要不要以“本文将”或“本周我们看到”开头。',
      '摘要不超过 70 个中文字符。',
    ],
    citation_rules: [
      '周报优先组合官方博客、高质量独立博客和权威媒体来源。',
      '论文只在确实有助于解释本周变化时引用，不要求每篇周报都出现。',
      '需要交代不同来源之间的共同点与分歧，而不是简单堆链接。',
    ],
    image_rules: [
      '正文插图优先使用本周原始网页图片，不强制每篇周报都有插图。',
      '正文插图仍然不能影响 Grok 封面图生成逻辑。',
      '图片来源统一放在文末的“图片来源”区块。',
    ],
    style_rules: [
      '围绕“一周变化”组织叙事，而不是逐条播报新闻。',
      '需要做跨来源对比，并指出本周节奏变化对产品、开发者或行业的影响。',
      '允许引用 blogwatcher、arXiv、Firecrawl、Exa 提供的补充材料，但正文必须保持主线清晰。',
      '结尾要落到下周仍需观察的变量，而不是空泛收束。',
    ],
    banned_phrases: [...SHARED_BANNED_PHRASES],
    analysis_markers: [
      ...SHARED_ANALYSIS_MARKERS,
      '本周的变化在于',
      '如果拉长来看',
      '接下来要观察',
    ],
  },
}

FORMAT_PROFILES['weekly-review-v2'] = {
  name: 'weekly-review-v2',
  sections: [
    '## 一、本周全景：AI 赛道发生了什么',
    '## 二、主线一：模型与产品竞争进入什么阶段',
    '## 三、主线二：基础设施与开源生态如何变化',
    '## 四、主线三：资本、组织与政策在推动什么',
    '## 五、分歧与争议：不同来源最不一致的判断',
    '## 六、长周期视角：把这一周放回更长的产业脉络',
    '## 七、下周与下阶段：哪些变量最值得继续观察',
    ...SHARED_TAIL_SECTIONS.slice(0, 2),
  ],
  required_sections: [
    '## 一、本周全景：AI 赛道发生了什么',
    '## 二、主线一：模型与产品竞争进入什么阶段',
    '## 三、主线二：基础设施与开源生态如何变化',
    '## 四、主线三：资本、组织与政策在推动什么',
    '## 五、分歧与争议：不同来源最不一致的判断',
    '## 六、长周期视角：把这一周放回更长的产业脉络',
    '## 七、下周与下阶段：哪些变量最值得继续观察',
  ],
  required_tail_sections: [...SHARED_TAIL_SECTIONS.slice(0, 2)],
  title_rules: [
    '标题必须体现这一周最重要的战略变化，而不是日报式的单事件复述。',
    '标题优先突出趋势、转向、竞争格局或产业节奏，不直接写成“第X周周报”。',
    '标题长度控制在 14-32 个中文字符，允许更强的判断感。',
  ],
  summary_rules: [
    '摘要只用一段，先给判断，再概括这周真正改变了什么。',
    '摘要不要写成目录说明，也不要用“本文将”“本周我们看到”开头。',
    '摘要控制在 70-120 个中文字符，允许比日报略长。',
  ],
  citation_rules: [
    '周报必须交叉使用官方博客、独立技术博客、行业媒体和必要时的论文材料。',
    '引用不是堆链接，而是要说明不同来源为何形成共识，或者为何出现分歧。',
    '如果用了论文，必须解释论文如何帮助理解这一周的现实产品、工程或产业变化。',
  ],
  image_rules: [
    '正文插图可以有，但只服务于章节理解，不能让图像取代论证。',
    '正文插图仍然不得影响 Grok 封面图的生成逻辑。',
    '图片来源统一保留在文末“图片来源”区块，不在图下重复标注。',
  ],
  style_rules: [
    '周报必须覆盖一周内的多个关键变化，不能退化成单篇日报的放大版。',
    '正文至少要形成三条清晰主线，并说明这些主线之间如何相互作用。',
    '必须显式写出竞争格局、资源投入、技术取舍、产品节奏或政策影响中的多项分析。',
    '结尾要落到下周和下一阶段的观察变量，而不是空泛总结。',
  ],
  banned_phrases: [...SHARED_BANNED_PHRASES],
  analysis_markers: [
    ...SHARED_ANALYSIS_MARKERS,
    '这一周真正改变的是',
    '更深一层的问题在于',
    '放到更长周期看',
    '接下来最值得观察的是',
    '如果把三条主线放在一起看',
  ],
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile))
}

export function resolveFormatProfileName(config = {}, mode = 'daily') {
  const weeklyConfig = config.weekly_review || {}
  if (mode === 'weekly-review') {
    return weeklyConfig.format_profile || 'weekly-review-v1'
  }
  return config.format_profile || 'tech-editorial-v1'
}

export function getContentWorkflowProfile(config = {}, mode = 'daily', today = '') {
  const isWeeklyReview = mode === 'weekly-review'
  const slugPrefix = isWeeklyReview ? 'ai-weekly-review' : 'ai-brief'

  return {
    mode,
    content_type: isWeeklyReview ? 'weekly_review' : 'daily_brief',
    profile_name: resolveFormatProfileName(config, mode),
    slug_prefix: slugPrefix,
    slug: today ? `${slugPrefix}-${today}` : slugPrefix,
  }
}

export function getBlogFormatProfile(profileName = 'tech-editorial-v1') {
  const profile = FORMAT_PROFILES[profileName]
  if (!profile) {
    throw new Error(`Unknown format profile: ${profileName}`)
  }
  return cloneProfile(profile)
}

export function buildFormatPrompt(profile) {
  return [
    '# 博客格式规范',
    `格式模板：${profile.name}`,
    '',
    '## 标题规则',
    ...profile.title_rules.map((rule) => `- ${rule}`),
    '',
    '## 摘要规则',
    ...profile.summary_rules.map((rule) => `- ${rule}`),
    '',
    '## 必备章节',
    ...profile.required_sections.map((section) => `- ${section}`),
    ...profile.required_tail_sections.map((section) => `- ${section}`),
    '',
    '## 来源规范',
    ...profile.citation_rules.map((rule) => `- ${rule}`),
    '',
    '## 图片规范',
    ...profile.image_rules.map((rule) => `- ${rule}`),
    '',
    '## 文风规则',
    ...profile.style_rules.map((rule) => `- ${rule}`),
    '',
    '## 禁用套话',
    ...profile.banned_phrases.map((phrase) => `- ${phrase}`),
  ].join('\n')
}
