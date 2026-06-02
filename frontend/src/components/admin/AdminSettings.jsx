import { useEffect, useRef, useState } from 'react'
import { Image, Plus, Sparkles, X } from 'lucide-react'

import {
  adminUploadImage,
  deleteAdminAiChannel,
  fetchAdminAiChannels,
  fetchAdminCoverGenerationStatus,
  fetchAdminSettings,
  fetchAdminAiChannelModelsWithConfig,
  generateAdminHeroImage,
  testAdminAiChannelWithConfig,
  updateAdminAiChannel,
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

const EMPTY_TARGET = {
  id: '',
  priority: 1,
  provider: 'openai_compatible',
  base_url: '',
  model: '',
  api_key_env_var: 'AI_API_KEY',
  api_key_value: '',
  persist_api_key: false,
  has_api_key: false,
  api_key_source: 'missing',
  masked_api_key: '',
  enabled: true,
  is_configured: false,
  message: '',
}

const EMPTY_CHANNEL = {
  purpose: '',
  provider: 'openai_compatible',
  base_url: '',
  model: '',
  api_key_env_var: 'AI_API_KEY',
  api_key_value: '',
  persist_api_key: false,
  has_api_key: false,
  api_key_source: 'missing',
  masked_api_key: '',
  enabled: true,
  is_configured: false,
  message: '',
  targets: [],
  active_target_count: 0,
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

function makeTargetId() {
  return `target-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function targetFromChannel(channel, priority = 1) {
  return {
    ...EMPTY_TARGET,
    id: channel.id || `target-${priority}`,
    priority,
    provider: channel.provider || EMPTY_TARGET.provider,
    base_url: channel.base_url || '',
    model: channel.model || '',
    api_key_env_var: channel.api_key_env_var || 'AI_API_KEY',
    has_api_key: Boolean(channel.has_api_key),
    api_key_source: channel.api_key_source || 'missing',
    masked_api_key: channel.masked_api_key || '',
    enabled: channel.enabled !== false,
    is_configured: Boolean(channel.is_configured),
    message: channel.message || '',
  }
}

function normalizeTargets(item, purpose) {
  const rawTargets = Array.isArray(item?.targets) && item.targets.length ? item.targets : [targetFromChannel(item || { purpose }, 1)]
  return rawTargets.map((target, index) => ({
    ...EMPTY_TARGET,
    ...target,
    id: target.id || `target-${index + 1}`,
    priority: index + 1,
    api_key_value: target.api_key_value || '',
    persist_api_key: Boolean(target.persist_api_key),
    enabled: target.enabled !== false,
  }))
}

function targetPayload(target, index) {
  const payload = {
    id: target.id,
    priority: index + 1,
    provider: target.provider,
    base_url: target.base_url,
    model: target.model,
    api_key_env_var: target.api_key_env_var,
    enabled: target.enabled,
  }
  if (target.persist_api_key && target.api_key_value?.trim()) {
    payload.api_key_value = target.api_key_value.trim()
  }
  if (target.clear_api_key) {
    payload.clear_api_key = true
  }
  return payload
}

function formatLatency(latencyMs) {
  return Number.isFinite(latencyMs) ? `${latencyMs} ms` : '未返回耗时'
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
  return Array.isArray(links) ? links : []
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
  const [channels, setChannels] = useState({
    image_generation: { ...EMPTY_CHANNEL, purpose: 'image_generation' },
    text_generation: { ...EMPTY_CHANNEL, purpose: 'text_generation' },
  })
  const [channelBusy, setChannelBusy] = useState('')
  const [channelTestResults, setChannelTestResults] = useState({
    image_generation: null,
    text_generation: null,
  })
  const [channelActionResults, setChannelActionResults] = useState({
    image_generation: null,
    text_generation: null,
  })
  const [channelModels, setChannelModels] = useState({
    image_generation: [],
    text_generation: [],
  })
  const [channelModelResults, setChannelModelResults] = useState({
    image_generation: null,
    text_generation: null,
  })
  const [heroDiagnostics, setHeroDiagnostics] = useState(null)
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
    void loadAiChannels()
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

  async function loadAiChannels() {
    try {
      const items = await fetchAdminAiChannels()
      const nextChannels = {
        image_generation: { ...EMPTY_CHANNEL, purpose: 'image_generation' },
        text_generation: { ...EMPTY_CHANNEL, purpose: 'text_generation' },
      }
      if (!Array.isArray(items)) {
        throw new Error('AI 渠道接口返回格式异常')
      }
      items.forEach((item) => {
        if (item?.purpose && nextChannels[item.purpose]) {
          nextChannels[item.purpose] = { ...EMPTY_CHANNEL, ...item, api_key_value: '', targets: normalizeTargets(item, item.purpose) }
        }
      })
      setChannels(nextChannels)
      setChannelLoadError('')
    } catch (err) {
      setChannels((prev) => prev)
      setChannelLoadError(err.message || '加载 AI 渠道配置失败')
    }
  }

  function clearChannelModels(purpose) {
    setChannelModels((prev) => ({ ...prev, [purpose]: [] }))
    setChannelModelResults((prev) => ({ ...prev, [purpose]: null }))
  }

  function updateChannelField(purpose, field, value) {
    setChannels((prev) => ({
      ...prev,
      [purpose]: {
        ...(prev[purpose] || EMPTY_CHANNEL),
        purpose,
        [field]: value,
      },
    }))
    if (['provider', 'base_url', 'api_key_env_var', 'api_key_value'].includes(field)) {
      clearChannelModels(purpose)
    }
  }

  function updateChannelTarget(purpose, index, field, value) {
    setChannels((prev) => {
      const channel = prev[purpose] || EMPTY_CHANNEL
      const targets = normalizeTargets(channel, purpose).map((target, itemIndex) => (
        itemIndex === index ? { ...target, [field]: value } : target
      ))
      return { ...prev, [purpose]: { ...channel, purpose, targets } }
    })
    if (['provider', 'base_url', 'api_key_env_var', 'api_key_value'].includes(field)) {
      clearChannelModels(purpose)
    }
  }

  function handleTargetProviderChange(purpose, index, newProvider) {
    const preset = PROVIDER_PRESETS[newProvider]
    const modelKey = purpose === 'image_generation' ? 'model_image' : 'model_text'
    setChannels((prev) => {
      const channel = prev[purpose] || EMPTY_CHANNEL
      const targets = normalizeTargets(channel, purpose).map((target, itemIndex) => {
        if (itemIndex !== index) return target
        return {
          ...target,
          provider: newProvider,
          base_url: preset?.base_url || target.base_url || '',
          model: preset?.[modelKey] || target.model || '',
          api_key_env_var: preset?.env_var || target.api_key_env_var || 'AI_API_KEY',
        }
      })
      return { ...prev, [purpose]: { ...channel, purpose, targets } }
    })
    clearChannelModels(purpose)
    setChannelTestResults((prev) => ({ ...prev, [purpose]: null }))
    setChannelActionResults((prev) => ({ ...prev, [purpose]: null }))
  }

  function addChannelTarget(purpose) {
    setChannels((prev) => {
      const channel = prev[purpose] || EMPTY_CHANNEL
      const targets = normalizeTargets(channel, purpose)
      return {
        ...prev,
        [purpose]: {
          ...channel,
          purpose,
          targets: [...targets, { ...EMPTY_TARGET, id: makeTargetId(), priority: targets.length + 1 }],
        },
      }
    })
  }

  function removeChannelTarget(purpose, index) {
    setChannels((prev) => {
      const channel = prev[purpose] || EMPTY_CHANNEL
      const targets = normalizeTargets(channel, purpose).filter((_, itemIndex) => itemIndex !== index)
      return { ...prev, [purpose]: { ...channel, purpose, targets: (targets.length ? targets : [{ ...EMPTY_TARGET, id: makeTargetId() }]).map((target, itemIndex) => ({ ...target, priority: itemIndex + 1 })) } }
    })
  }

  function moveChannelTarget(purpose, index, direction) {
    setChannels((prev) => {
      const channel = prev[purpose] || EMPTY_CHANNEL
      const targets = normalizeTargets(channel, purpose)
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= targets.length) return prev
      const nextTargets = [...targets]
      const [item] = nextTargets.splice(index, 1)
      nextTargets.splice(nextIndex, 0, item)
      return { ...prev, [purpose]: { ...channel, purpose, targets: nextTargets.map((target, itemIndex) => ({ ...target, priority: itemIndex + 1 })) } }
    })
  }

  function handleProviderChange(purpose, newProvider) {
    const preset = PROVIDER_PRESETS[newProvider]
    if (!preset) {
      updateChannelField(purpose, 'provider', newProvider)
      return
    }
    const modelKey = purpose === 'image_generation' ? 'model_image' : 'model_text'
    setChannels((prev) => ({
      ...prev,
      [purpose]: {
        ...(prev[purpose] || EMPTY_CHANNEL),
        purpose,
        provider: newProvider,
        base_url: preset.base_url || prev[purpose]?.base_url || '',
        model: preset[modelKey] || prev[purpose]?.model || '',
        api_key_env_var: preset.env_var || prev[purpose]?.api_key_env_var || '',
      },
    }))
    clearChannelModels(purpose)
    setChannelTestResults((prev) => ({ ...prev, [purpose]: null }))
    setChannelActionResults((prev) => ({ ...prev, [purpose]: null }))
  }

  async function handleSaveChannel(purpose) {
    const channel = channels[purpose]
    if (!channel) return
    const targets = normalizeTargets(channel, purpose)
    setChannelBusy(`${purpose}:save`)
    setChannelActionResults((prev) => ({ ...prev, [purpose]: null }))
    try {
      const firstTarget = targets[0] || EMPTY_TARGET
      const payload = {
        provider: firstTarget.provider,
        base_url: firstTarget.base_url,
        model: firstTarget.model,
        api_key_env_var: firstTarget.api_key_env_var,
        enabled: channel.enabled,
        targets: targets.map(targetPayload),
      }
      const updated = await updateAdminAiChannel(purpose, payload)
      setChannels((prev) => ({
        ...prev,
        [purpose]: { ...EMPTY_CHANNEL, ...updated, api_key_value: '', targets: normalizeTargets(updated, purpose) },
      }))
      setChannelActionResults((prev) => ({ ...prev, [purpose]: { ok: true, message: `${CHANNEL_LABELS[purpose]} 已保存` } }))
      await loadCoverStatus()
    } catch (err) {
      setChannelActionResults((prev) => ({ ...prev, [purpose]: { ok: false, message: err.message || `${CHANNEL_LABELS[purpose]} 保存失败` } }))
    } finally {
      setChannelBusy('')
    }
  }

  async function handleResetChannel(purpose) {
    setChannelBusy(`${purpose}:reset`)
    setChannelActionResults((prev) => ({ ...prev, [purpose]: null }))
    try {
      await deleteAdminAiChannel(purpose)
      await loadAiChannels()
      await loadCoverStatus()
      setChannelActionResults((prev) => ({ ...prev, [purpose]: { ok: true, message: `${CHANNEL_LABELS[purpose]} 已重置为默认配置` } }))
    } catch (err) {
      setChannelActionResults((prev) => ({ ...prev, [purpose]: { ok: false, message: err.message || `${CHANNEL_LABELS[purpose]} 重置失败` } }))
    } finally {
      setChannelBusy('')
    }
  }

  async function handleTestChannel(purpose) {
    const channel = channels[purpose]
    if (!channel) return
    const targets = normalizeTargets(channel, purpose)
    setChannelBusy(`${purpose}:test`)
    setChannelTestResults((prev) => ({ ...prev, [purpose]: null }))
    try {
      const result = await testAdminAiChannelWithConfig(purpose, {
        targets: targets.map(targetPayload),
      })
      setChannelTestResults((prev) => ({ ...prev, [purpose]: result }))
    } catch (err) {
      setChannelTestResults((prev) => ({
        ...prev,
        [purpose]: { ok: false, message: err.message || `${CHANNEL_LABELS[purpose]} 测试失败` },
      }))
    } finally {
      setChannelBusy('')
    }
  }

  async function handleFetchModels(purpose, targetIndex = 0) {
    const channel = channels[purpose]
    if (!channel) return
    const target = normalizeTargets(channel, purpose)[targetIndex] || EMPTY_TARGET
    setChannelBusy(`${purpose}:models:${targetIndex}`)
    setChannelModelResults((prev) => ({ ...prev, [purpose]: null }))
    try {
      const result = await fetchAdminAiChannelModelsWithConfig(purpose, {
        target: targetPayload(target, targetIndex),
      })
      const models = Array.isArray(result?.models) ? result.models : []
      setChannelModels((prev) => ({ ...prev, [purpose]: models }))
      setChannelModelResults((prev) => ({
        ...prev,
        [purpose]: {
          ok: Boolean(result?.ok),
          targetIndex,
          message: `${result?.message || (result?.ok ? '已获取模型列表' : '获取模型失败')}${Number.isFinite(result?.latency_ms) ? `，耗时 ${result.latency_ms} ms` : ''}`,
        },
      }))
      if (result?.ok && models.length === 1 && !target.model) {
        updateChannelTarget(purpose, targetIndex, 'model', models[0].id)
      }
    } catch (err) {
      setChannelModelResults((prev) => ({
        ...prev,
        [purpose]: { ok: false, targetIndex, message: err.message || `${CHANNEL_LABELS[purpose]} 获取模型失败` },
      }))
    } finally {
      setChannelBusy('')
    }
  }



  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        ...siteSettings,
        friend_links: JSON.stringify(siteSettings.friend_links || []),
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
      const result = await generateAdminHeroImage({ overwrite: true })
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
      friend_links: [...(prev.friend_links || []), { name: '', url: '', description: '', avatar: '' }],
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
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI API 渠道配置</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
            生图渠道用于 Hero 和封面生成；生文字渠道用于后续文字生成工作流。API Key 可填环境变量名，也可临时填入用于获取模型/测试连接。只有勾选保存时才会把新 Key 写入后台；不保存时刷新后需要重新输入 Key 或使用环境变量。
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {['image_generation', 'text_generation'].map((purpose) => {
            const channel = channels[purpose] || { ...EMPTY_CHANNEL, purpose }
            const models = channelModels[purpose] || []
            const modelResult = channelModelResults[purpose]
            const busyPrefix = `${purpose}:`
            const targets = normalizeTargets(channel, purpose)
            return (
              <div key={purpose} className="space-y-3 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{CHANNEL_LABELS[purpose]}</div>
                    <div className="mt-1 text-xs text-[var(--text-faint)]">
                      {channel.db_configured ? '已保存自定义配置' : '使用默认/环境变量配置'} · {channel.is_configured ? '已配置' : channel.message || '待配置'}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={channel.enabled}
                      onChange={(event) => updateChannelField(purpose, 'enabled', event.target.checked)}
                    />
                    启用
                  </label>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[var(--text-secondary)]">调用顺序（失败时自动尝试下一项）</div>
                    <button
                      type="button"
                      disabled={channelBusy.startsWith(busyPrefix)}
                      onClick={() => addChannelTarget(purpose)}
                      className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                    >
                      添加 API 渠道
                    </button>
                  </div>

                  {targets.map((target, targetIndex) => (
                    <div key={target.id || targetIndex} className="space-y-3 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">优先级 {targetIndex + 1}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={target.enabled}
                              onChange={(event) => updateChannelTarget(purpose, targetIndex, 'enabled', event.target.checked)}
                            />
                            启用
                          </label>
                          <button type="button" disabled={targetIndex === 0 || channelBusy.startsWith(busyPrefix)} onClick={() => moveChannelTarget(purpose, targetIndex, -1)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-xs disabled:opacity-40">上移</button>
                          <button type="button" disabled={targetIndex === targets.length - 1 || channelBusy.startsWith(busyPrefix)} onClick={() => moveChannelTarget(purpose, targetIndex, 1)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-xs disabled:opacity-40">下移</button>
                          <button type="button" disabled={targets.length <= 1 || channelBusy.startsWith(busyPrefix)} onClick={() => removeChannelTarget(purpose, targetIndex)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-xs text-[#ef4444] disabled:opacity-40">删除</button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                          Provider
                          <select
                            value={target.provider}
                            onChange={(event) => handleTargetProviderChange(purpose, targetIndex, event.target.value)}
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
                        <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                          Model
                          <input
                            value={target.model}
                            onChange={(event) => updateChannelTarget(purpose, targetIndex, 'model', event.target.value)}
                            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                            style={inputStyle}
                            placeholder={purpose === 'image_generation' ? '例如 image-model' : '例如 text-model'}
                          />
                        </label>
                      </div>

                      <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                        Base URL
                        <input
                          value={target.base_url}
                          onChange={(event) => updateChannelTarget(purpose, targetIndex, 'base_url', event.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                          style={inputStyle}
                          placeholder="https://api.example.com 或 https://api.example.com/v1"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                          API Key 环境变量
                          <input
                            value={target.api_key_env_var}
                            onChange={(event) => updateChannelTarget(purpose, targetIndex, 'api_key_env_var', event.target.value)}
                            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                            style={inputStyle}
                            placeholder="AI_API_KEY"
                          />
                        </label>
                        <div className="space-y-2">
                          <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                            新 API Key
                            <input
                              type="password"
                              value={target.api_key_value}
                              onChange={(event) => updateChannelTarget(purpose, targetIndex, 'api_key_value', event.target.value)}
                              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                              style={inputStyle}
                              placeholder={target.masked_api_key || '留空则不更新'}
                            />
                          </label>
                          <label className="flex items-start gap-2 text-xs font-medium text-[var(--text-faint)]">
                            <input
                              type="checkbox"
                              checked={Boolean(target.persist_api_key)}
                              onChange={(event) => updateChannelTarget(purpose, targetIndex, 'persist_api_key', event.target.checked)}
                              className="mt-0.5"
                            />
                            <span>保存这个 API Key 到后台。</span>
                          </label>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-faint)]">
                        <span>Key 来源：{target.api_key_source || 'missing'}{target.masked_api_key ? ` · ${target.masked_api_key}` : ''}</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={channelBusy.startsWith(busyPrefix)}
                            onClick={() => handleFetchModels(purpose, targetIndex)}
                            className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                          >
                            {channelBusy === `${purpose}:models:${targetIndex}` ? '获取中…' : '获取模型'}
                          </button>
                          {models.length && modelResult?.targetIndex === targetIndex ? (
                            <select
                              value=""
                              onChange={(event) => event.target.value && updateChannelTarget(purpose, targetIndex, 'model', event.target.value)}
                              className="min-w-0 rounded-lg px-3 py-1.5 text-xs outline-none"
                              style={inputStyle}
                              aria-label={`${CHANNEL_LABELS[purpose]} 候选 ${targetIndex + 1} 模型列表`}
                            >
                              <option value="">选择模型写入 Model</option>
                              {models.map((model) => (
                                <option key={model.id} value={model.id}>{model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>
                      {modelResult && modelResult.targetIndex === targetIndex ? (
                        <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: modelResult.ok ? 'var(--accent-soft)' : 'var(--danger-soft)', color: modelResult.ok ? 'var(--accent)' : '#ef4444' }}>
                          {modelResult.ok ? '✓ ' : '✗ '}{modelResult.message}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-faint)]">
                    Key 来源：{channel.api_key_source || 'missing'}{channel.masked_api_key ? ` · ${channel.masked_api_key}` : ''}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={channelBusy.startsWith(busyPrefix)}
                      onClick={() => handleResetChannel(purpose)}
                      className="rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-50"
                    >
                      {channelBusy === `${purpose}:reset` ? '重置中…' : '重置'}
                    </button>
                    <button
                      type="button"
                      disabled={channelBusy.startsWith(busyPrefix)}
                      onClick={() => handleTestChannel(purpose)}
                      className="rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                    >
                      {channelBusy === `${purpose}:test` ? '测试中…' : '测试连接'}
                    </button>
                    <button
                      type="button"
                      disabled={channelBusy.startsWith(busyPrefix)}
                      onClick={() => handleSaveChannel(purpose)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {channelBusy === `${purpose}:save` ? '保存中…' : '保存渠道'}
                    </button>
                  </div>
                </div>

                {channelTestResults[purpose] ? (
                  <div
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{
                      backgroundColor: channelTestResults[purpose].ok ? 'var(--accent-soft)' : 'var(--danger-soft)',
                      color: channelTestResults[purpose].ok ? 'var(--accent)' : '#ef4444',
                    }}
                  >
                    {channelTestResults[purpose].ok ? '✓ ' : '✗ '}
                    {channelTestResults[purpose].message}
                  </div>
                ) : null}

                {channelActionResults[purpose] ? (
                  <div
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{
                      backgroundColor: channelActionResults[purpose].ok ? 'var(--accent-soft)' : 'var(--danger-soft)',
                      color: channelActionResults[purpose].ok ? 'var(--accent)' : '#ef4444',
                    }}
                  >
                    {channelActionResults[purpose].ok ? '✓ ' : '✗ '}
                    {channelActionResults[purpose].message}
                  </div>
                ) : null}
              </div>
            )
          })}
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
          <div key={index} className="relative rounded-lg border border-[var(--border-muted)] p-4">
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
