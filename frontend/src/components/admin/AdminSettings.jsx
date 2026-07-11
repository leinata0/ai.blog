import { useEffect, useState } from 'react'

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
import { trackAdminImageJob } from './adminJobsStore'
import AdminAiProviderPanel from './AdminAiProviderPanel'
import AdminSiteBasicsPanel from './AdminSiteBasicsPanel'
import {
  EMPTY_MODEL_INSTANCE_FORM,
  EMPTY_PROVIDER_SOURCE_FORM,
  EMPTY_SETTINGS,
  PROVIDER_PRESETS,
  CHANNEL_LABELS,
  capabilityList,
  isSettingsSuccessMessage,
  makeFriendLinkKey,
  parseFriendLinks,
} from './adminSettingsShared'

const SETTINGS_TABS = [
  { id: 'site', label: '站点与展示' },
  { id: 'ai', label: 'AI Provider' },
]

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState('site')
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
      setMsg('Hero 海报生成任务已提交，可在右上角「任务」面板查看进度。')
      const result = await trackAdminImageJob({
        label: '站点 Hero 海报',
        detail: '覆盖生成',
        targetType: 'site_hero',
        submit: () => generateAdminHeroImage({ overwrite: true }),
        wait: waitForAdminImageGenerationJob,
      })
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

  const isSuccess = isSettingsSuccessMessage(msg)

  return (
    <div
      className="space-y-5 rounded-xl bg-[var(--bg-surface)] p-6 sm:p-8"
      style={{ boxShadow: 'var(--card-shadow)' }}
      data-ui="admin-settings"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">站点设置</h2>
        <div className="inline-flex rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-1" role="tablist" aria-label="设置分区">
          {SETTINGS_TABS.map((tab) => {
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: selected ? 'var(--bg-surface)' : 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                  boxShadow: selected ? 'var(--card-shadow-soft)' : 'none',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

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

      {activeTab === 'site' ? (
        <AdminSiteBasicsPanel
          siteSettings={siteSettings}
          setSiteSettings={setSiteSettings}
          saving={saving}
          assetUploading={assetUploading}
          heroGenerating={heroGenerating}
          coverStatus={coverStatus}
          heroDiagnostics={heroDiagnostics}
          handleSave={handleSave}
          handleAssetUpload={handleAssetUpload}
          handleGenerateHero={handleGenerateHero}
          addFriendLink={addFriendLink}
          removeFriendLink={removeFriendLink}
          updateFriendLink={updateFriendLink}
        />
      ) : (
        <AdminAiProviderPanel
          providerSources={providerSources}
          modelInstances={modelInstances}
          runtimePlan={runtimePlan}
          providerSourceForm={providerSourceForm}
          setProviderSourceForm={setProviderSourceForm}
          modelInstanceForm={modelInstanceForm}
          setModelInstanceForm={setModelInstanceForm}
          providerBusy={providerBusy}
          providerResult={providerResult}
          providerModels={providerModels}
          providerModelSourceId={providerModelSourceId}
          modelTestResults={modelTestResults}
          handleSourceProviderChange={handleSourceProviderChange}
          handleSaveProviderSource={handleSaveProviderSource}
          handleDeleteProviderSource={handleDeleteProviderSource}
          handleDiscoverProviderModels={handleDiscoverProviderModels}
          handleSaveModelInstance={handleSaveModelInstance}
          handleDeleteModelInstance={handleDeleteModelInstance}
          handleTestModelInstance={handleTestModelInstance}
          updateModelInstanceLocal={updateModelInstanceLocal}
          handleSaveModelOrder={handleSaveModelOrder}
        />
      )}
    </div>
  )
}
