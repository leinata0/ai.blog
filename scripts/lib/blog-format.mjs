const BASE_REQUIRED_SECTIONS = [
  '## 一、发生了什么',
  '## 二、为什么这件事值得关注',
  '## 三、不同来源怎么看',
  '## 四、如果结合论文/历史脉络，该怎么理解',
  '## 五、我的判断',
]

const BASE_REQUIRED_TAIL_SECTIONS = [
  '## 参考来源',
  '## 图片来源',
  '## 一句话结论',
]

const BASE_BANNED_PHRASES = [
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

export function getBlogFormatProfile(profileName = 'tech-editorial-v1') {
  if (profileName !== 'tech-editorial-v1') {
    throw new Error(`Unknown format profile: ${profileName}`)
  }

  return {
    name: profileName,
    sections: [...BASE_REQUIRED_SECTIONS, ...BASE_REQUIRED_TAIL_SECTIONS],
    required_sections: [...BASE_REQUIRED_SECTIONS],
    required_tail_sections: [...BASE_REQUIRED_TAIL_SECTIONS],
    title_rules: [
      '标题必须是中文，避免“日报”“速递”“周报”式新闻口吻。',
      '标题要体现核心判断或核心矛盾，不只是复述事件。',
      '标题长度控制在 10-28 个中文字符。',
    ],
    summary_rules: [
      '摘要只用一段，直接给出文章主判断。',
      '摘要不要以“本文将”或“这篇文章”开头。',
      '摘要不超过 50 个中文字符。',
    ],
    citation_rules: [
      '事实陈述优先对应官方博客、原始新闻稿、论文摘要或高质量技术博客。',
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
    banned_phrases: [...BASE_BANNED_PHRASES],
    analysis_markers: [
      '意味着',
      '代价',
      '取舍',
      '影响',
      '问题在于',
      '更关键的是',
      '换句话说',
      '真正值得注意',
    ],
  }
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
