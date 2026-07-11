export const EMPTY_SETTINGS = {
  author_name: '',
  bio: '',
  avatar_url: '',
  hero_image: '',
  github_link: '',
  announcement: '',
  site_url: '',
  friend_links: [],
}

export const EMPTY_PROVIDER_SOURCE_FORM = {
  id: null,
  name: '',
  provider: 'openai_compatible',
  protocol: 'openai',
  base_url: '',
  api_key_env_var: 'AI_API_KEY',
  api_key_value: '',
  clear_api_key: false,
  enabled: true,
  extra_json: '{}',
}

export const EMPTY_MODEL_INSTANCE_FORM = {
  id: null,
  source_id: '',
  name: '',
  model: '',
  purpose: 'text_generation',
  capabilities: 'text_generation',
  priority: 1,
  enabled: true,
  is_default: false,
  extra_json: '{}',
}

export const CHANNEL_LABELS = {
  image_generation: '生图 API',
  text_generation: '生文字 API',
}

export const PROVIDER_PRESETS = {
  xai: { label: 'XAI / Grok', base_url: 'https://api.x.ai/v1', model_image: 'grok-imagine-image', model_text: 'grok-4', env_var: 'XAI_API_KEY', group: 'OpenAI 兼容' },
  openai: { label: 'OpenAI', base_url: 'https://api.openai.com/v1', model_image: 'dall-e-3', model_text: 'gpt-4o', env_var: 'OPENAI_API_KEY', group: 'OpenAI 兼容' },
  deepseek: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model_image: '', model_text: 'deepseek-chat', env_var: 'DEEPSEEK_API_KEY', group: 'OpenAI 兼容' },
  siliconflow: { label: 'SiliconFlow', base_url: 'https://api.siliconflow.cn/v1', model_image: 'black-forest-labs/FLUX.1-schnell', model_text: 'deepseek-ai/DeepSeek-V3', env_var: 'SILICONFLOW_API_KEY', group: 'OpenAI 兼容' },
  moonshot: { label: 'Moonshot / Kimi', base_url: 'https://api.moonshot.cn/v1', model_image: '', model_text: 'moonshot-v1-128k', env_var: 'MOONSHOT_API_KEY', group: 'OpenAI 兼容' },
  zhipu: { label: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model_image: 'cogview-4', model_text: 'glm-4-flash', env_var: 'ZHIPU_API_KEY', group: 'OpenAI 兼容' },
  baichuan: { label: '百川', base_url: 'https://api.baichuan-ai.com/v1', model_image: '', model_text: 'Baichuan4', env_var: 'BAICHUAN_API_KEY', group: 'OpenAI 兼容' },
  minimax: { label: 'MiniMax', base_url: 'https://api.minimax.chat/v1', model_image: '', model_text: 'MiniMax-Text-01', env_var: 'MINIMAX_API_KEY', group: 'OpenAI 兼容' },
  doubao: { label: '豆包 / 火山引擎', base_url: 'https://ark.cn-beijing.volces.com/api/v3', model_image: '', model_text: 'doubao-pro-32k', env_var: 'DOUBAO_API_KEY', group: 'OpenAI 兼容' },
  gemini: { label: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', model_image: 'imagen-3.0-generate-002', model_text: 'gemini-2.0-flash', env_var: 'GEMINI_API_KEY', group: 'OpenAI 兼容' },
  mistral: { label: 'Mistral', base_url: 'https://api.mistral.ai/v1', model_image: '', model_text: 'mistral-large-latest', env_var: 'MISTRAL_API_KEY', group: 'OpenAI 兼容' },
  groq: { label: 'Groq', base_url: 'https://api.groq.com/openai/v1', model_image: '', model_text: 'llama-3.3-70b-versatile', env_var: 'GROQ_API_KEY', group: 'OpenAI 兼容' },
  together: { label: 'Together AI', base_url: 'https://api.together.xyz/v1', model_image: 'stabilityai/stable-diffusion-xl-base-1.0', model_text: 'meta-llama/Llama-3-70b-chat-hf', env_var: 'TOGETHER_API_KEY', group: 'OpenAI 兼容' },
  anthropic: { label: 'Anthropic / Claude', base_url: 'https://api.anthropic.com', model_image: '', model_text: 'claude-sonnet-4-20250514', env_var: 'ANTHROPIC_API_KEY', group: 'Anthropic 兼容' },
  openai_compatible: { label: '自定义 (OpenAI 兼容)', base_url: '', model_image: '', model_text: '', env_var: 'AI_API_KEY', group: '自定义' },
}

export const PROVIDER_GROUPS = Object.entries(PROVIDER_PRESETS).reduce((acc, [value, preset]) => {
  const group = preset.group || '其他'
  if (!acc[group]) acc[group] = []
  acc[group].push({ value, ...preset })
  return acc
}, {})

export const ADMIN_SETTINGS_INPUT_STYLE = {
  backgroundColor: 'var(--bg-canvas)',
  border: '1px solid var(--border-muted)',
  color: 'var(--text-primary)',
}

export function formatLatency(latencyMs) {
  return Number.isFinite(latencyMs) ? `${latencyMs} ms` : '未返回耗时'
}

export function providerFormFromSource(source) {
  return {
    ...EMPTY_PROVIDER_SOURCE_FORM,
    id: source.id,
    name: source.name || '',
    provider: source.provider || 'openai_compatible',
    protocol: source.protocol || 'openai',
    base_url: source.base_url || '',
    api_key_env_var: source.api_key_env_var || 'AI_API_KEY',
    enabled: source.enabled !== false,
    extra_json: source.extra_json || '{}',
  }
}

export function instanceFormFromModel(instance) {
  return {
    ...EMPTY_MODEL_INSTANCE_FORM,
    id: instance.id,
    source_id: String(instance.source_id || ''),
    name: instance.name || '',
    model: instance.model || '',
    purpose: instance.purpose || 'text_generation',
    capabilities: Array.isArray(instance.capabilities) ? instance.capabilities.join(', ') : (instance.capabilities || ''),
    priority: instance.priority || 1,
    enabled: instance.enabled !== false,
    is_default: Boolean(instance.is_default),
    extra_json: instance.extra_json || '{}',
  }
}

export function capabilityList(value, purpose) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (purpose && !values.includes(purpose)) values.unshift(purpose)
  return values.length ? values : [purpose].filter(Boolean)
}

export function makeFriendLinkKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `fl-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export function parseFriendLinks(rawLinks) {
  let links = rawLinks || []
  if (typeof links === 'string') {
    try {
      links = JSON.parse(links)
    } catch {
      links = []
    }
  }
  if (!Array.isArray(links)) return []
  // Attach a stable per-row key so React can track edits/removals correctly in the
  // controlled friend-link list. Without it (index-as-key), removing a middle row
  // shifts every later row's identity and the input values/focus jump around.
  return links.map((link) => ({ ...link, _key: makeFriendLinkKey() }))
}

export function isSettingsSuccessMessage(msg) {
  return (
    msg === '站点设置已保存' ||
    msg.includes('图片已上传并写入地址') ||
    msg.includes('Hero 海报已生成并直接替换当前首页主海报') ||
    msg.includes('已保存') ||
    msg.includes('已重置为默认配置') ||
    msg.includes('测试成功')
  )
}
