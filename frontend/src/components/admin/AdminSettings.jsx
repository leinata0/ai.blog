import { useEffect, useRef, useState } from 'react'
import { Image, Plus, Sparkles, X } from 'lucide-react'

import {
  adminUploadImage,
  createAdminAiModelInstance,
  createAdminAiProviderSource,
  deleteAdminAiModelInstance,
  deleteAdminAiProviderSource,
  fetchAdminAiModelInstances,
  fetchAdminAiProviderSourceModels,
  fetchAdminAiProviderSources,
  fetchAdminAiRuntimePlan,
  fetchAdminCoverGenerationStatus,
  fetchAdminSettings,
  generateAdminHeroImage,
  waitForAdminImageGenerationJob,
  testAdminAiModelInstance,
  updateAdminAiModelInstance,
  updateAdminAiModelOrder,
  updateAdminAiProviderSource,
  updateSettings,
} from '../../api/admin'

const EMPTY_SETTINGS = {
  author_name: '',
  bio: '',
  avatar_url: '',
  hero_image: '',
  github_link: '',
  announcement: '',
  site_url: '',
  friend_links: [],
}

const EMPTY_PROVIDER_SOURCE_FORM = {
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

const EMPTY_MODEL_INSTANCE_FORM = {
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

const CHANNEL_LABELS = {
  image_generation: '生图 API',
  text_generation: '生文字 API',
}

const PROVIDER_PRESETS = {
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

const PROVIDER_GROUPS = Object.entries(PROVIDER_PRESETS).reduce((acc, [value, preset]) => {
  const group = preset.group || '其他'
  if (!acc[group]) acc[group] = []
  acc[group].push({ value, ...preset })
  return acc
}, {})

function formatLatency(latencyMs) {
  return Number.isFinite(latencyMs) ? `${latencyMs} ms` : '未返回耗时'
}

function providerFormFromSource(source) {
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

function instanceFormFromModel(instance) {
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

function capabilityList(value, purpose) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (purpose && !values.includes(purpose)) values.unshift(purpose)
  return values.length ? values : [purpose].filter(Boolean)
}

function makeFriendLinkKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `fl-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function parseFriendLinks(rawLinks) {
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

export default function AdminSettings() {
  const [siteSettings, setSiteSettings] = useState(EMPTY_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [assetUploading, setAssetUploading] = useState(false)
  const [heroGenerating, setHeroGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [channelLoadError, setChannelLoadError] = useState('')
  const [coverStatus, setCoverStatus] = useState(null)
  const [heroDiagnostics, setHeroDiagnostics] = useState(null)
  const [providerSources, setProviderSources] = useState([])
  const [modelInstances, setModelInstances] = useState([])
  const [runtimePlan, setRuntimePlan] = useState({ image_generation: [], text_generation: [] })
  const [providerSourceForm, setProviderSourceForm] = useState(EMPTY_PROVIDER_SOURCE_FORM)
  const [modelInstanceForm, setModelInstanceForm] = useState(EMPTY_MODEL_INSTANCE_FORM)
  const [providerBusy, setProviderBusy] = useState('')
  const [providerResult, setProviderResult] = useState(null)
  const [providerModels, setProviderModels] = useState([])
  const [providerModelSourceId, setProviderModelSourceId] = useState(null)
  const [modelTestResults, setModelTestResults] = useState({})
  const avatarFileRef = useRef(null)
  const heroFileRef = useRef(null)

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  useEffect(() => {
    void loadSettings()
    void loadCoverStatus()
    void loadProviderConfig()
  }, [])

  async function loadSettings() {
    try {
      const settings = await fetchAdminSettings()
      setSiteSettings({
        author_name: settings.author_name || '',
        bio: settings.bio || '',
        avatar_url: settings.avatar_url || '',
        hero_image: settings.hero_image || '',
        github_link: settings.github_link || '',
        announcement: settings.announcement || '',
        site_url: settings.site_url || '',
        friend_links: parseFriendLinks(settings.friend_links),
      })
      setError('')
    } catch (err) {
      setError(err.message || '加载站点设置失败')
    }
  }

  async function loadCoverStatus() {
    try {
      const status = await fetchAdminCoverGenerationStatus()
      setCoverStatus(status)
      setChannelLoadError('')
    } catch (err) {
      setCoverStatus(null)
      setChannelLoadError(err.message || '加载后台生图状态失败')
    }
  }

  async function loadProviderConfig() {
    try {
      const [sources, instances, plan] = await Promise.all([
        fetchAdminAiProviderSources(),
        fetchAdminAiModelInstances(),
        fetchAdminAiRuntimePlan(),
      ])
      setProviderSources(Array.isArray(sources) ? sources : [])
      setModelInstances(Array.isArray(instances) ? instances : [])
      setRuntimePlan(plan || { image_generation: [], text_generation: [] })
      setChannelLoadError('')
    } catch (err) {
      setProviderSources([])
      setModelInstances([])
      setRuntimePlan({ image_generation: [], text_generation: [] })
      setChannelLoadError(err.message || '加载 AI Provider 配置失败')
    }
  }

  function handleSourceProviderChange(provider) {
    const preset = PROVIDER_PRESETS[provider]
    setProviderSourceForm((prev) => ({
      ...prev,
      provider,
      protocol: provider === 'anthropic' ? 'anthropic' : 'openai',
      base_url: preset?.base_url || prev.base_url,
      api_key_env_var: preset?.env_var || prev.api_key_env_var || 'AI_API_KEY',
      name: prev.name || preset?.label || provider,
    }))
  }

  function validateProviderSourceForm() {
    const name = providerSourceForm.name.trim()
    const baseUrl = providerSourceForm.base_url.trim()
    const envVar = providerSourceForm.api_key_env_var.trim()
    if (!name) return '请填写服务源名称。'
    if (!baseUrl) return '请填写 Base URL。'
    if (!/^https?:\/\//i.test(baseUrl)) return 'Base URL 必须以 http:// 或 https:// 开头。'
    if (!envVar) return '请填写 API Key 环境变量。'
    try {
      JSON.parse(providerSourceForm.extra_json || '{}')
    } catch {
      return '扩展配置必须是合法 JSON。'
    }
    return ''
  }

  async function handleSaveProviderSource() {
    const validationError = validateProviderSourceForm()
    if (validationError) {
      setProviderResult({ ok: false, message: validationError })
      return
    }
    setProviderBusy('source:save')
    setProviderResult({ ok: true, message: providerSourceForm.id ? '正在保存服务源…' : '正在创建服务源…' })
    try {
      const payload = {
        name: providerSourceForm.name.trim(),
        provider: providerSourceForm.provider,
        protocol: providerSourceForm.protocol,
        base_url: providerSourceForm.base_url.trim(),
        api_key_env_var: providerSourceForm.api_key_env_var.trim(),
        enabled: providerSourceForm.enabled,
        extra_json: providerSourceForm.extra_json,
        clear_api_key: providerSourceForm.clear_api_key,
      }
      if (providerSourceForm.api_key_value.trim()) payload.api_key_value = providerSourceForm.api_key_value.trim()
      if (providerSourceForm.id) {
        await updateAdminAiProviderSource(providerSourceForm.id, payload)
      } else {
        await createAdminAiProviderSource(payload)
      }
      setProviderSourceForm(EMPTY_PROVIDER_SOURCE_FORM)
      setProviderModels([])
      setProviderModelSourceId(null)
      await loadProviderConfig()
      await loadCoverStatus()
      setProviderResult({ ok: true, message: '服务源已保存' })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '服务源保存失败' })
    } finally {
      setProviderBusy('')
    }
  }

  async function handleDeleteProviderSource(id) {
    setProviderBusy(`source:delete:${id}`)
    setProviderResult(null)
    try {
      await deleteAdminAiProviderSource(id)
      if (providerSourceForm.id === id) setProviderSourceForm(EMPTY_PROVIDER_SOURCE_FORM)
      await loadProviderConfig()
      await loadCoverStatus()
      setProviderResult({ ok: true, message: '服务源已删除' })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '服务源删除失败' })
    } finally {
      setProviderBusy('')
    }
  }

  async function handleDiscoverProviderModels(sourceId) {
    setProviderBusy(`source:models:${sourceId}`)
    setProviderResult(null)
    try {
      const result = await fetchAdminAiProviderSourceModels(sourceId)
      const models = Array.isArray(result?.models) ? result.models : []
      setProviderModels(models)
      setProviderModelSourceId(sourceId)
      setProviderResult({
        ok: Boolean(result?.ok),
        message: `${result?.message || (result?.ok ? '已获取模型列表' : '获取模型失败')}${Number.isFinite(result?.latency_ms) ? `，耗时 ${result.latency_ms} ms` : ''}`,
      })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '模型发现失败' })
    } finally {
      setProviderBusy('')
    }
  }

  async function handleSaveModelInstance() {
    setProviderBusy('model:save')
    setProviderResult(null)
    try {
      const payload = {
        source_id: Number(modelInstanceForm.source_id),
        name: modelInstanceForm.name,
        model: modelInstanceForm.model,
        purpose: modelInstanceForm.purpose,
        capabilities: capabilityList(modelInstanceForm.capabilities, modelInstanceForm.purpose),
        priority: Number(modelInstanceForm.priority) || 1,
        enabled: modelInstanceForm.enabled,
        is_default: modelInstanceForm.is_default,
        extra_json: modelInstanceForm.extra_json,
      }
      if (modelInstanceForm.id) {
        await updateAdminAiModelInstance(modelInstanceForm.id, payload)
      } else {
        await createAdminAiModelInstance(payload)
      }
      setModelInstanceForm(EMPTY_MODEL_INSTANCE_FORM)
      await loadProviderConfig()
      await loadCoverStatus()
      setProviderResult({ ok: true, message: '模型实例已保存' })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '模型实例保存失败' })
    } finally {
      setProviderBusy('')
    }
  }

  async function handleDeleteModelInstance(id) {
    setProviderBusy(`model:delete:${id}`)
    setProviderResult(null)
    try {
      await deleteAdminAiModelInstance(id)
      if (modelInstanceForm.id === id) setModelInstanceForm(EMPTY_MODEL_INSTANCE_FORM)
      await loadProviderConfig()
      await loadCoverStatus()
      setProviderResult({ ok: true, message: '模型实例已删除' })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '模型实例删除失败' })
    } finally {
      setProviderBusy('')
    }
  }

  async function handleTestModelInstance(id) {
    setProviderBusy(`model:test:${id}`)
    setModelTestResults((prev) => ({ ...prev, [id]: null }))
    try {
      const result = await testAdminAiModelInstance(id)
      setModelTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (err) {
      setModelTestResults((prev) => ({ ...prev, [id]: { ok: false, message: err.message || '模型实例测试失败' } }))
    } finally {
      setProviderBusy('')
    }
  }

  function updateModelInstanceLocal(id, field, value) {
    setModelInstances((prev) => {
      const edited = prev.find((candidate) => candidate.id === id)
      return prev.map((item) => {
        if (field === 'is_default' && value && edited && item.purpose === edited.purpose && item.id !== id) {
          return { ...item, is_default: false }
        }
        if (item.id !== id) return item
        return { ...item, [field]: value }
      })
    })
  }

  async function handleSaveModelOrder(purpose) {
    setProviderBusy(`model:order:${purpose}`)
    setProviderResult(null)
    try {
      const items = modelInstances
        .filter((item) => item.purpose === purpose)
        .map((item, index) => ({ id: item.id, priority: item.priority || index + 1, is_default: Boolean(item.is_default) }))
      await updateAdminAiModelOrder({ purpose, items })
      await loadProviderConfig()
      await loadCoverStatus()
      setProviderResult({ ok: true, message: `${CHANNEL_LABELS[purpose]} 模型顺序已保存` })
    } catch (err) {
      setProviderResult({ ok: false, message: err.message || '模型顺序保存失败' })
    } finally {
      setProviderBusy('')
    }
  }



  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        ...siteSettings,
        // Strip the client-only _key before persisting; it exists purely to give
        // React a stable list key across add/remove of editable rows.
        friend_links: JSON.stringify((siteSettings.friend_links || []).map(({ _key, ...rest }) => rest)),
      }
      const updated = await updateSettings(payload)
      setSiteSettings({
        author_name: updated.author_name || '',
        bio: updated.bio || '',
        avatar_url: updated.avatar_url || '',
        hero_image: updated.hero_image || '',
        github_link: updated.github_link || '',
        announcement: updated.announcement || '',
        site_url: updated.site_url || '',
        friend_links: parseFriendLinks(updated.friend_links),
      })
      setMsg('站点设置已保存')
    } catch (err) {
      setMsg(err.message || '保存站点设置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleAssetUpload(field, event) {
    const file = event.target.files?.[0]
    if (!file) return

    setAssetUploading(true)
    setMsg('')
    try {
      const { url } = await adminUploadImage(file)
      setSiteSettings((prev) => ({ ...prev, [field]: url }))
      setMsg('图片已上传并写入地址，点击下方“保存站点设置”后会持久生效。')
    } catch (err) {
      setMsg(err.message || '图片上传失败')
    } finally {
      event.target.value = ''
      setAssetUploading(false)
    }
  }

  async function handleGenerateHero() {
    setHeroGenerating(true)
    setMsg('')
    try {
      const response = await generateAdminHeroImage({ overwrite: true })
      setMsg('Hero 海报生成任务已提交，正在后台生成...')
      const result = await waitForAdminImageGenerationJob(response)
      setHeroDiagnostics({
        prompt: result?.prompt || '',
        preset: result?.preset || '',
        artDirectionVersion: result?.art_direction_version || '',
        error: result?.error || '',
      })
      if (!result?.generated || !result?.hero_image) {
        setMsg(result?.error || 'Hero 海报生成失败')
        return
      }

      setSiteSettings((prev) => ({
        ...prev,
        hero_image: result.hero_image,
      }))
      setMsg('Hero 海报已生成并直接替换当前首页主海报。')
      await loadCoverStatus()
    } catch (err) {
      setMsg(err.message || 'Hero 海报生成失败')
    } finally {
      setHeroGenerating(false)
    }
  }

  function addFriendLink() {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: [...(prev.friend_links || []), { name: '', url: '', description: '', avatar: '', _key: makeFriendLinkKey() }],
    }))
  }

  function removeFriendLink(index) {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: prev.friend_links.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function updateFriendLink(index, field, value) {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: prev.friend_links.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }))
  }

  const isSuccess =
    msg === '站点设置已保存' ||
    msg.includes('图片已上传并写入地址') ||
    msg.includes('Hero 海报已生成并直接替换当前首页主海报') ||
    msg.includes('已保存') ||
    msg.includes('已重置为默认配置') ||
    msg.includes('测试成功')

  const modelsByPurpose = {
    image_generation: modelInstances.filter((item) => item.purpose === 'image_generation'),
    text_generation: modelInstances.filter((item) => item.purpose === 'text_generation'),
  }
  const sourceOptions = providerSources.map((source) => ({ value: String(source.id), label: source.name || source.provider || `Source ${source.id}` }))

  return (
    <div
      className="space-y-5 rounded-xl bg-[var(--bg-surface)] p-6 sm:p-8"
      style={{ boxShadow: 'var(--card-shadow)' }}
      data-ui="admin-settings"
    >
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">站点设置</h2>

      {error ? (
        <div className="rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
      ) : null}

      {channelLoadError ? (
        <div className="rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{channelLoadError}</div>
      ) : null}

      {msg ? (
        <div
          className="rounded-lg px-4 py-2 text-sm"
          style={{
            backgroundColor: isSuccess ? 'var(--accent-soft)' : 'var(--danger-soft)',
            color: isSuccess ? 'var(--accent)' : '#ef4444',
          }}
        >
          {msg}
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">博主名称</label>
        <input
          value={siteSettings.author_name}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, author_name: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">个人简介</label>
        <input
          value={siteSettings.bio}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, bio: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">站点 URL</label>
        <input
          value={siteSettings.site_url}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, site_url: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
          placeholder="https://your-site.example"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">头像（侧边栏）</label>
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">
          推荐优先上传到本站，避免外链图片因防盗链或图床清理而失效。单张图片最大 10MB。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={siteSettings.avatar_url}
            onChange={(event) => setSiteSettings((prev) => ({ ...prev, avatar_url: event.target.value }))}
            className="min-w-0 flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="https://... 或 /uploads/..."
          />
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => handleAssetUpload('avatar_url', event)}
          />
          <button
            type="button"
            disabled={assetUploading}
            onClick={() => avatarFileRef.current?.click()}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-muted)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
          >
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传头像'}
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-[var(--text-secondary)]">首页 Hero 主海报</label>
          <p className="text-xs leading-relaxed text-[var(--text-faint)]">
            前台会直接读取这里的 `hero_image`。建议使用 4:5 竖版海报，右侧舞台会按单张主海报展示。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={siteSettings.hero_image}
            onChange={(event) => setSiteSettings((prev) => ({ ...prev, hero_image: event.target.value }))}
            className="min-w-0 flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="https://... 或 /uploads/..."
          />
          <input
            ref={heroFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => handleAssetUpload('hero_image', event)}
          />
          <button
            type="button"
            disabled={assetUploading}
            onClick={() => heroFileRef.current?.click()}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-muted)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
          >
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传海报'}
          </button>
          <button
            type="button"
            disabled={heroGenerating}
            onClick={handleGenerateHero}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
          >
            <Sparkles size={16} />
            {heroGenerating
              ? '生成中…'
              : siteSettings.hero_image
                ? '重生成 Hero 海报'
                : '生成 Hero 海报'}
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div
            className="rounded-xl border border-[var(--border-muted)] px-4 py-3 text-sm"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: coverStatus?.supports_site_hero ? 'var(--accent-soft)' : 'var(--danger-soft)',
                  color: coverStatus?.supports_site_hero ? 'var(--accent)' : '#ef4444',
                }}
              >
                {coverStatus?.supports_site_hero ? '后台生图已就绪' : '后台生图待配置'}
              </span>
              <span className="text-xs text-[var(--text-faint)]">生成后会直接替换当前 Hero 海报</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {coverStatus?.message || '后台一键生图会使用当前配置的生图 API 渠道。'}
            </p>
            {heroDiagnostics ? (
              <div className="mt-3 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-3 text-xs leading-6 text-[var(--text-secondary)]">
                <div>Preset：{heroDiagnostics.preset || 'site_hero'}</div>
                <div>Art Direction：{heroDiagnostics.artDirectionVersion || 'unknown'}</div>
                {heroDiagnostics.prompt ? <div>Prompt：{heroDiagnostics.prompt}</div> : null}
                {heroDiagnostics.error ? <div>Last Error：{heroDiagnostics.error}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-[1.4rem] border border-[var(--border-muted)] bg-[var(--bg-surface)]">
            {siteSettings.hero_image ? (
              <img
                src={siteSettings.hero_image}
                alt="当前 Hero 海报预览"
                className="aspect-[4/5] h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center px-6 text-center text-sm text-[var(--text-faint)]">
                暂无 Hero 海报，点击右侧按钮可直接生成并替换。
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Provider 配置</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
            服务源保存 API 网关和密钥来源；模型实例决定生图/生文字的默认模型、优先级和失败重试顺序。
          </p>
        </div>

        {providerResult ? (
          <div
            className="rounded-lg px-4 py-2 text-sm"
            role="status"
            aria-live="polite"
            style={{
              backgroundColor: providerResult.ok ? 'var(--accent-soft)' : 'var(--danger-soft)',
              color: providerResult.ok ? 'var(--accent)' : '#ef4444',
            }}
          >
            {providerResult.ok ? '✓ ' : '✗ '}{providerResult.message}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">服务源</div>
              <button
                type="button"
                onClick={() => setProviderSourceForm(EMPTY_PROVIDER_SOURCE_FORM)}
                className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
              >
                新建服务源
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源名称
                <input
                  value={providerSourceForm.name}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="例如 OpenAI Gateway"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Provider
                <select
                  value={providerSourceForm.provider}
                  onChange={(event) => handleSourceProviderChange(event.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                >
                  {Object.entries(PROVIDER_GROUPS).map(([groupLabel, options]) => (
                    <optgroup key={groupLabel} label={groupLabel}>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Protocol
                <select
                  value={providerSourceForm.protocol}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, protocol: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                启用
                <select
                  value={providerSourceForm.enabled ? 'yes' : 'no'}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, enabled: event.target.value === 'yes' }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="yes">启用</option>
                  <option value="no">停用</option>
                </select>
              </label>
            </div>

            <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
              Base URL
              <input
                value={providerSourceForm.base_url}
                onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, base_url: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="https://api.example.com/v1"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                API Key 环境变量
                <input
                  value={providerSourceForm.api_key_env_var}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, api_key_env_var: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="AI_API_KEY"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源 API Key
                <input
                  type="password"
                  value={providerSourceForm.api_key_value}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, api_key_value: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="留空则不更新"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-faint)]">
                <input
                  type="checkbox"
                  checked={providerSourceForm.clear_api_key}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, clear_api_key: event.target.checked }))}
                />
                清除已保存 Key
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={providerBusy === 'source:save'}
                  onClick={handleSaveProviderSource}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {providerBusy === 'source:save' ? '保存中…' : providerSourceForm.id ? '保存服务源' : '创建服务源'}
                </button>
              </div>
            </div>

            <textarea
              value={providerSourceForm.extra_json}
              onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, extra_json: event.target.value }))}
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
              style={inputStyle}
              aria-label="服务源扩展 JSON"
            />

            <div className="space-y-2">
              {providerSources.length ? providerSources.map((source) => (
                <div key={source.id} className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">{source.name || source.provider}</div>
                      <div className="mt-1 text-[var(--text-faint)]">{source.provider} · {source.protocol} · {source.api_key_source}{source.masked_api_key ? ` · ${source.masked_api_key}` : ''}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setProviderSourceForm(providerFormFromSource(source))} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[var(--accent)]">编辑</button>
                      <button type="button" disabled={providerBusy === `source:models:${source.id}`} onClick={() => handleDiscoverProviderModels(source.id)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[var(--accent)] disabled:opacity-50">{providerBusy === `source:models:${source.id}` ? '发现中…' : '发现模型'}</button>
                      <button type="button" disabled={providerBusy === `source:delete:${source.id}`} onClick={() => handleDeleteProviderSource(source.id)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[#ef4444] disabled:opacity-50">删除</button>
                    </div>
                  </div>
                  <div className="mt-2 truncate text-[var(--text-secondary)]">{source.base_url || '未配置 Base URL'}</div>
                </div>
              )) : <div className="rounded-lg border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">暂无服务源</div>}
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">模型实例</div>
              <button
                type="button"
                onClick={() => setModelInstanceForm(EMPTY_MODEL_INSTANCE_FORM)}
                className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
              >
                新建模型实例
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源
                <select
                  value={modelInstanceForm.source_id}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, source_id: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="">选择服务源</option>
                  {sourceOptions.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Purpose
                <select
                  value={modelInstanceForm.purpose}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, purpose: event.target.value, capabilities: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="text_generation">生文字 API</option>
                  <option value="image_generation">生图 API</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                实例名称
                <input
                  value={modelInstanceForm.name}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="例如 Claude 文本主力"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Model
                <input
                  value={modelInstanceForm.model}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, model: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="模型 ID"
                />
              </label>
            </div>

            {providerModels.length && providerModelSourceId === Number(modelInstanceForm.source_id) ? (
              <select
                value=""
                onChange={(event) => event.target.value && setModelInstanceForm((prev) => ({ ...prev, model: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                style={inputStyle}
                aria-label="服务源模型列表"
              >
                <option value="">选择发现到的模型写入 Model</option>
                {providerModels.map((model) => <option key={model.id} value={model.id}>{model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id}</option>)}
              </select>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Capabilities
                <input
                  value={modelInstanceForm.capabilities}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, capabilities: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                  placeholder="逗号分隔"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Priority
                <input
                  type="number"
                  min="1"
                  value={modelInstanceForm.priority}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, priority: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-faint)]"><input type="checkbox" checked={modelInstanceForm.enabled} onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, enabled: event.target.checked }))} />启用</label>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-faint)]"><input type="checkbox" checked={modelInstanceForm.is_default} onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, is_default: event.target.checked }))} />默认</label>
              </div>
              <button
                type="button"
                disabled={providerBusy === 'model:save'}
                onClick={handleSaveModelInstance}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {providerBusy === 'model:save' ? '保存中…' : modelInstanceForm.id ? '保存模型实例' : '创建模型实例'}
              </button>
            </div>

            <textarea
              value={modelInstanceForm.extra_json}
              onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, extra_json: event.target.value }))}
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
              style={inputStyle}
              aria-label="模型实例扩展 JSON"
            />

            {['image_generation', 'text_generation'].map((purpose) => (
              <div key={purpose} className="space-y-2 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[var(--text-primary)]">{CHANNEL_LABELS[purpose]} 模型实例</div>
                  <button type="button" disabled={providerBusy === `model:order:${purpose}`} onClick={() => handleSaveModelOrder(purpose)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-xs text-[var(--accent)] disabled:opacity-50">保存 {CHANNEL_LABELS[purpose]} 顺序</button>
                </div>
                {modelsByPurpose[purpose].length ? modelsByPurpose[purpose].map((item) => {
                  const testResult = modelTestResults[item.id]
                  return (
                    <div key={item.id} className="rounded border border-[var(--border-muted)] bg-[var(--bg-surface)] p-3 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[var(--text-primary)]">{item.name || item.model}</div>
                          <div className="mt-1 text-[var(--text-faint)]">{item.source_name} · {item.model} · {item.is_configured ? '已配置' : '未就绪'}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setModelInstanceForm(instanceFormFromModel(item))} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[var(--accent)]">编辑</button>
                          <button type="button" disabled={providerBusy === `model:test:${item.id}`} onClick={() => handleTestModelInstance(item.id)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[var(--accent)] disabled:opacity-50">{providerBusy === `model:test:${item.id}` ? '测试中…' : '测试'}</button>
                          <button type="button" disabled={providerBusy === `model:delete:${item.id}`} onClick={() => handleDeleteModelInstance(item.id)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[#ef4444] disabled:opacity-50">删除</button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
                        <label className="inline-flex items-center gap-2 text-[var(--text-secondary)]"><input type="checkbox" checked={Boolean(item.is_default)} onChange={(event) => updateModelInstanceLocal(item.id, 'is_default', event.target.checked)} />默认</label>
                        <label className="flex items-center gap-2 text-[var(--text-secondary)]">优先级<input type="number" min="1" value={item.priority || 1} onChange={(event) => updateModelInstanceLocal(item.id, 'priority', Number(event.target.value) || 1)} className="w-20 rounded px-2 py-1 outline-none" style={inputStyle} /></label>
                      </div>
                      {testResult ? (
                        <div className="mt-2 rounded px-3 py-2" style={{ backgroundColor: testResult.ok ? 'var(--accent-soft)' : 'var(--danger-soft)', color: testResult.ok ? 'var(--accent)' : '#ef4444' }}>
                          {testResult.ok ? '✓ ' : '✗ '}{testResult.message}{testResult.latency_ms ? ` · ${formatLatency(testResult.latency_ms)}` : ''}
                        </div>
                      ) : null}
                    </div>
                  )
                }) : <div className="rounded border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">暂无模型实例</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {['image_generation', 'text_generation'].map((purpose) => (
            <div key={purpose} className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
              <div className="text-xs font-semibold text-[var(--text-primary)]">{CHANNEL_LABELS[purpose]} Runtime Plan</div>
              <div className="mt-3 space-y-2">
                {(runtimePlan?.[purpose] || []).length ? runtimePlan[purpose].map((item, index) => (
                  <div key={`${item.instance_id}-${index}`} className="rounded-lg bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">#{index + 1} {item.name || item.model}</span>
                    <span> · {item.source_name} · {item.provider} · {item.model}</span>
                  </div>
                )) : <div className="rounded-lg border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">没有可用模型实例，请先创建可用的 Provider 模型实例</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">GitHub 链接</label>
        <input
          value={siteSettings.github_link}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, github_link: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">公告内容</label>
        <textarea
          value={siteSettings.announcement}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, announcement: event.target.value }))}
          rows={3}
          className="w-full resize-none rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-secondary)]">友情链接</label>
          <button
            type="button"
            onClick={addFriendLink}
            className="flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors duration-200"
          >
            <Plus size={12} />
            添加友链
          </button>
        </div>

        {(siteSettings.friend_links || []).map((link, index) => (
          <div key={link._key ?? index} className="relative rounded-lg border border-[var(--border-muted)] p-4">
            <button
              type="button"
              onClick={() => removeFriendLink(index)}
              className="absolute right-2 top-2 rounded p-1 hover:bg-red-50"
              title="移除"
            >
              <X size={14} className="text-[#ef4444]" />
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={link.name}
                onChange={(event) => updateFriendLink(index, 'name', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="名称"
              />
              <input
                value={link.url}
                onChange={(event) => updateFriendLink(index, 'url', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="https://..."
              />
              <input
                value={link.description}
                onChange={(event) => updateFriendLink(index, 'description', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="描述"
              />
              <input
                value={link.avatar}
                onChange={(event) => updateFriendLink(index, 'avatar', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="头像 URL"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存站点设置'}
      </button>
    </div>
  )
}
