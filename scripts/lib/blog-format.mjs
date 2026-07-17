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

// Deterministic, grammar-preserving replacements for the banned filler phrases above.
// Used to neutralize residual hits the LLM keeps reintroducing during repair, so the
// quality gate's zero-tolerance banned-phrase check can actually be satisfied instead
// of looping until max_repair_attempts is exhausted. Replacements must themselves be
// free of every banned phrase.
const SHARED_BANNED_PHRASE_REPLACEMENTS = {
  让我们拭目以待: '这一点仍有待观察',
  值得关注的是: '需要注意的是',
  不难看出: '可以看到',
  可以预见: '从趋势看',
  综上所述: '整体来看',
  总的来说: '整体来看',
  毋庸置疑: '显然',
  引发广泛关注: '引发讨论',
  再次证明了: '说明了',
}

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
      ...SHARED_TAIL_SECTIONS,
    ],
    required_sections: [
      '## 一、发生了什么',
      '## 二、为什么这件事值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果结合论文/历史脉络，该怎么理解',
      '## 五、我的判断',
    ],
    required_tail_sections: [...SHARED_TAIL_SECTIONS],
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
      '正文插图不能影响独立的封面图生成逻辑。',
      '图片来源统一放在文末的“图片来源”区块。',
    ],
    style_rules: [
      '区分事实与观点，给出明确的主判断。',
      '至少做两处对比、影响或取舍分析。',
      '避免新闻罗列和套话总结。',
      '段落要饱满，每段保持完整论述而不是短句拼接。',
    ],
    section_rules: [
      '每个主章节都必须承担不同编辑任务：事实说明、重要性判断、来源分歧、历史/论文脉络、个人判断不能互相重复。',
      '至少 2-3 个正文章节应包含 Markdown 三级标题（###），用来拆分关键论点，而不是机械罗列新闻。',
      '每个章节至少包含 2 个饱满段落；短句列表只能辅助说明，不能替代论证。',
    ],
    evidence_rules: [
      '正文中的关键事实必须能回到来源编号，例如 [S1]、[S2]，不要编造未提供的来源编号。',
      '官方来源优先用于产品事实，独立博客/媒体优先用于解释外部视角，论文只在能解释机制或长期脉络时使用。',
      '引用来源时要说明它支撑了什么判断，避免只在文末堆链接。',
    ],
    analysis_rules: [
      '至少包含一个技术或商业取舍、一个利益相关方影响、一个二阶后果。',
      '必须写出一个反方观点、不确定性，或“如果这个判断错了，可能错在哪里”。',
      '分析词不能集中在单个章节；多个章节都要有明确的因果、比较或边界判断。',
    ],
    repair_rules: [
      '如果某节过短，优先补充证据、反例、取舍和影响链，而不是重复摘要。',
      '如果引用不足，补正文中的来源支撑，不要只在参考来源区增加链接。',
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
      ...SHARED_TAIL_SECTIONS,
    ],
    required_sections: [
      '## 一、本周发生了什么',
      '## 二、哪些变化最值得关注',
      '## 三、不同来源怎么看',
      '## 四、如果拉长到产品与行业节奏',
      '## 五、下周还要继续观察什么',
    ],
    required_tail_sections: [...SHARED_TAIL_SECTIONS],
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
      '正文插图仍然不能影响独立的封面图生成逻辑。',
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
    ...SHARED_TAIL_SECTIONS,
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
  required_tail_sections: [...SHARED_TAIL_SECTIONS],
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
    '正文插图仍然不得影响后台已配置渠道的封面图生成逻辑。',
    '图片来源统一保留在文末“图片来源”区块，不在图下重复标注。',
  ],
  style_rules: [
    '周报必须覆盖一周内的多个关键变化，不能退化成单篇日报的放大版。',
    '正文至少要形成三条清晰主线，并说明这些主线之间如何相互作用。',
    '必须显式写出竞争格局、资源投入、技术取舍、产品节奏或政策影响中的多项分析。',
    '结尾要落到下周和下一阶段的观察变量，而不是空泛总结。',
  ],
  section_rules: [
    '七个正文章节必须按顺序服务于全景、三条主线、分歧、长周期和观察变量，不能写成来源摘要拼接。',
    '每个主线章节至少要连接另外一条主线，说明模型、基础设施、资本/组织/政策之间的相互作用。',
    '“分歧与争议”必须解释不同来源为什么判断不一致，而不是只写“有人支持、有人反对”。',
    '“长周期视角”必须连接产业节奏、工程约束、商业模式或政策周期。',
  ],
  evidence_rules: [
    '周报必须交叉使用官方博客、独立技术博客、行业媒体和必要论文，避免单一来源叙事。',
    '每条主线都要绑定多个来源编号，并说明这些来源提供事实、解释还是反方视角。',
    '论文和研究材料只在能解释现实产品、工程或产业变化时使用。',
  ],
  analysis_rules: [
    '必须写出三条主线之间的共同驱动力、互相牵制和潜在冲突。',
    '至少包含竞争格局、资源投入、技术取舍、产品节奏、政策影响中的三类分析。',
    '最后一节必须给出可观察变量，例如发布时间、成本曲线、开源许可证、监管动作、用户迁移或开发者采用。',
  ],
  repair_rules: [
    '如果周报退化成新闻列表，优先重建主线之间的因果关系。',
    '如果某节过短，补充跨来源比较、分歧原因和下阶段变量，而不是重复事实。',
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

FORMAT_PROFILES['free-form-v1'] = {
  name: 'free-form-v1',
  // Free-structure mode: the article author (LLM) designs its own H2 chapters instead of
  // filling a fixed template. Quality is enforced by dimension coverage, not heading match.
  structure_mode: 'free',
  sections: [],
  required_sections: [],
  required_tail_sections: [...SHARED_TAIL_SECTIONS],
  // Editorial responsibilities every article must fulfill, regardless of how chapters are named.
  // quality-gate maps each to an objective signal (citations, cited domains, analysis sections...).
  required_dimensions: ['facts', 'significance', 'multi_source', 'analysis', 'judgment'],
  title_rules: [
    '标题必须是中文，体现核心判断或核心矛盾，而不是复述事件。',
    '标题避免“日报”“快讯”“周报”式新闻口吻。',
    '标题长度控制在 12-30 个中文字符。',
  ],
  summary_rules: [
    '摘要只用一段话，直接给出文章主判断。',
    '摘要不要以“本文将”或“这篇文章”开头。',
    '摘要不超过 80 个中文字符。',
  ],
  outline_rules: [
    '你必须自己设计 3 到 6 个二级标题（## 开头）来组织文章，不要套用固定模板章节名。',
    '每个章节标题要具体、贴合这篇文章的实际内容，避免“发生了什么”“为什么值得关注”这类通用模板标题。',
    '章节顺序和数量由内容决定，但整篇文章合起来必须覆盖下列全部维度。',
    '不要在正文里自行编写“参考来源”“图片来源”“一句话结论”这三个收尾区块，它们由系统统一补齐。',
  ],
  dimension_rules: [
    'facts（事实层）：讲清楚发生了什么，关键事实要能回到来源编号，例如 [S1]。',
    'significance（重要性）：解释这件事为什么值得关注，而不仅是复述。',
    'multi_source（多源对比）：呈现不同来源的共识或分歧，引用要覆盖多个不同域名的来源。',
    'analysis（分析层）：至少给出取舍、影响、二阶后果或反方观点中的多项，分析要分布在多个章节。',
    'judgment（判断层）：给出作者明确的结论或判断，而不是空泛收束。',
  ],
  citation_rules: [
    '事实陈述优先对应官方博客、原始新闻源、论文摘要或高质量技术博客。',
    '引用来源时要说明它支撑了什么判断，避免只在文末堆链接。',
    '不要编造研究包里不存在的来源编号。',
  ],
  image_rules: [
    '正文插图只服务于解释，不要让图片取代论证。',
    '图片来源统一放在文末的“图片来源”区块。',
  ],
  style_rules: [
    '区分事实与观点，给出明确的主判断。',
    '至少做两处对比、影响或取舍分析，并分布在不同章节。',
    '避免新闻罗列和套话总结，段落要饱满。',
  ],
  evidence_rules: [
    '正文中的关键事实必须能回到来源编号，例如 [S1]、[S2]。',
    '官方来源优先用于产品事实，独立博客/媒体优先用于解释外部视角。',
    '引用来源时要说明它支撑了什么判断。',
  ],
  analysis_rules: [
    '至少包含一个技术或商业取舍、一个利益相关方影响、一个二阶后果。',
    '必须写出一个反方观点、不确定性，或“如果这个判断错了，可能错在哪里”。',
    '分析不能集中在单个章节；多个章节都要有明确的因果、比较或边界判断。',
  ],
  repair_rules: [
    '如果某节过短，优先补充证据、反例、取舍和影响链，而不是重复摘要。',
    '如果某个维度未覆盖，补写承担该维度的章节内容，而不是新增模板标题。',
  ],
  banned_phrases: [...SHARED_BANNED_PHRASES],
  analysis_markers: [...SHARED_ANALYSIS_MARKERS],
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
  const optionalGroups = [
    ['## 章节结构规则', profile.section_rules],
    ['## 证据使用规则', profile.evidence_rules],
    ['## 分析深度规则', profile.analysis_rules],
    ['## 修订规则', profile.repair_rules],
  ]
  const optionalLines = optionalGroups.flatMap(([title, rules]) => (
    Array.isArray(rules) && rules.length > 0
      ? ['', title, ...rules.map((rule) => `- ${rule}`)]
      : []
  ))

  // Free mode: the LLM authors its own chapter titles, so instead of listing fixed
  // required sections we hand it the self-authoring rules plus the editorial dimensions
  // every article must cover. The program-appended tail blocks are still declared so the
  // model knows not to write them itself.
  const isFreeStructure = profile.structure_mode === 'free'
  const dimensionLabels = {
    facts: 'facts（事实层）：发生了什么，关键事实必须有来源支撑',
    significance: 'significance（重要性）：为什么这件事值得关注',
    multi_source: 'multi_source（多源对比）：不同来源的共识与分歧',
    analysis: 'analysis（分析层）：取舍、影响、二阶后果、反方观点',
    judgment: 'judgment（判断层）：作者明确的结论或判断',
  }
  const structureLines = isFreeStructure
    ? [
        '## 章节自拟规则',
        ...(Array.isArray(profile.outline_rules) ? profile.outline_rules.map((rule) => `- ${rule}`) : []),
        '',
        '## 必须覆盖的维度',
        ...(Array.isArray(profile.required_dimensions) ? profile.required_dimensions : [])
          .map((dimension) => `- ${dimensionLabels[dimension] || dimension}`),
        '',
        '## 程序补齐的固定尾部（请勿自行撰写）',
        ...profile.required_tail_sections.map((section) => `- ${section}`),
      ]
    : [
        '## 必备章节',
        ...profile.required_sections.map((section) => `- ${section}`),
        ...profile.required_tail_sections.map((section) => `- ${section}`),
      ]

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
    ...structureLines,
    '',
    '## 来源规范',
    ...profile.citation_rules.map((rule) => `- ${rule}`),
    '',
    '## 图片规范',
    ...profile.image_rules.map((rule) => `- ${rule}`),
    '',
    '## 文风规则',
    ...profile.style_rules.map((rule) => `- ${rule}`),
    ...optionalLines,
    '',
    '## 禁用套话',
    ...profile.banned_phrases.map((phrase) => `- ${phrase}`),
  ].join('\n')
}

// Replace residual banned filler phrases with neutral equivalents so the quality gate's
// banned-phrase check can pass. The LLM repeatedly reintroduces these phrases during
// repair; since they carry no factual weight, deterministic substitution is safe and
// guarantees the repair loop terminates. Returns the cleaned text unchanged when no
// banned phrase is present.
export function neutralizeBannedPhrases(text, phrases = SHARED_BANNED_PHRASES, replacements = SHARED_BANNED_PHRASE_REPLACEMENTS) {
  let output = String(text || '')
  for (const phrase of phrases) {
    if (!phrase || !output.includes(phrase)) continue
    const replacement = Object.prototype.hasOwnProperty.call(replacements, phrase) ? replacements[phrase] : ''
    const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output.replace(new RegExp(safe, 'g'), replacement)
  }
  return output
}
