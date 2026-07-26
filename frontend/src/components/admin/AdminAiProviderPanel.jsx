import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createAdminAiProviderAllowedHost,
  deleteAdminAiProviderAllowedHost,
  fetchAdminAiProviderAllowedHosts,
} from '../../api/admin'
import { formatDate } from '../../utils/date'
import { useAdminConfirm } from './AdminConfirmDialog'
import {
  ADMIN_SETTINGS_INPUT_STYLE,
  CHANNEL_LABELS,
  EMPTY_MODEL_INSTANCE_FORM,
  EMPTY_PROVIDER_SOURCE_FORM,
  PROVIDER_GROUPS,
  formatLatency,
  instanceFormFromModel,
  providerFormFromSource,
} from './adminSettingsShared'

const EMPTY_ALLOWED_HOST_FORM = { hostname: '', note: '' }

// client.js 的 readErrorMessage 遇到 dict 型 detail 只能 JSON.stringify，
// 所以后端的 {message, error_code, ...} 到了这里是一整坨 JSON 字符串。
// 直接渲染它对用户毫无意义，先还原成结构化对象。
const REQUEST_ID_SUFFIX = /（Request ID:[^）]*）\s*$/

export function parseAdminErrorPayload(error) {
  const raw = typeof error === 'string' ? error : String(error?.message ?? '')
  const candidate = raw.replace(REQUEST_ID_SUFFIX, '').trim()
  const fallback = { message: raw, error_code: '', payload: null }
  if (!candidate.startsWith('{')) return fallback

  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    return {
      message: typeof parsed.message === 'string' && parsed.message ? parsed.message : raw,
      error_code: typeof parsed.error_code === 'string' ? parsed.error_code : '',
      payload: parsed,
    }
  } catch {
    return fallback
  }
}

// 后端 error_code → 用户能看懂的一句话。没命中就退回后端的 message，
// 但永远不要把整坨 JSON 甩给用户。
const ALLOWED_HOST_ERROR_MESSAGES = {
  invalid_hostname: '主机名格式不合法：只填域名或 IP（例如 gateway.example.com），不要带路径或空格。',
  hostname_not_public: '该主机指向内网或保留地址（如 127.0.0.1、10.x.x.x、192.168.x.x），后端不会把 API Key 发往这类地址，因此拒绝加入。',
  hostname_exists: '该主机已经在允许列表里，不需要重复添加。',
  not_found: '这条记录已经不存在了，请刷新后重试。',
}

function allowedHostErrorMessage(error, fallbackMessage) {
  const { message, error_code: errorCode } = parseAdminErrorPayload(error)
  return ALLOWED_HOST_ERROR_MESSAGES[errorCode] || message || fallbackMessage
}

/**
 * 从 Base URL 兜底解析主机名。用户可能没写 scheme（chybenzun.top），
 * 也可能填了根本解析不出来的内容 —— 后者返回空串，由调用方决定怎么办。
 */
export function hostnameFromBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    return new URL(candidate).hostname
  } catch {
    return ''
  }
}

function normalizeAllowedHostList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

/**
 * 允许主机列表的数据层。
 * apiGet 在 dedupe 打开时会丢掉调用方传入的 signal，所以这里不用 AbortController，
 * 一律走 activeRef 标志位（与 AdminSeriesManager / AdminSettings 一致）。
 */
function useAllowedHosts() {
  const [hosts, setHosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const activeRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const payload = await fetchAdminAiProviderAllowedHosts()
      if (!activeRef.current) return
      setHosts(normalizeAllowedHostList(payload))
      setLoadError('')
    } catch (err) {
      // 灰度部署期间后端可能还没有这个端点：降级成一条提示，不要把整个 Provider 面板拖垮。
      if (!activeRef.current) return
      setHosts([])
      setLoadError(allowedHostErrorMessage(err, '加载 Base URL 允许主机失败'))
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    void load()
    return () => {
      activeRef.current = false
    }
  }, [load])

  const addHost = useCallback(async (hostname, note = '') => {
    const trimmedHost = String(hostname || '').trim()
    if (!trimmedHost) return { ok: false, errorCode: 'invalid_hostname', message: '请填写要允许的主机名。' }
    const trimmedNote = String(note || '').trim()
    const body = trimmedNote ? { hostname: trimmedHost, note: trimmedNote } : { hostname: trimmedHost }
    try {
      await createAdminAiProviderAllowedHost(body)
      // 卸载后不要再补一次列表请求。
      if (activeRef.current) await load()
      return { ok: true, errorCode: '', message: `已把 ${trimmedHost} 加入允许列表。` }
    } catch (err) {
      const { error_code: errorCode } = parseAdminErrorPayload(err)
      // 已存在说明本地列表落后了，顺手拉一次最新数据。
      if (errorCode === 'hostname_exists' && activeRef.current) await load()
      return { ok: false, errorCode, message: allowedHostErrorMessage(err, '加入允许列表失败') }
    }
  }, [load])

  const removeHost = useCallback(async (id) => {
    try {
      await deleteAdminAiProviderAllowedHost(id)
      if (activeRef.current) await load()
      return { ok: true, errorCode: '', message: '' }
    } catch (err) {
      const { error_code: errorCode } = parseAdminErrorPayload(err)
      if (errorCode === 'not_found' && activeRef.current) await load()
      return { ok: false, errorCode, message: allowedHostErrorMessage(err, '移除允许主机失败') }
    }
  }, [load])

  return { hosts, loading, loadError, activeRef, addHost, removeHost }
}

export default function AdminAiProviderPanel({
  panel = 'providers',
  providerSources,
  modelInstances,
  runtimePlan,
  providerSourceForm,
  setProviderSourceForm,
  modelInstanceForm,
  setModelInstanceForm,
  providerBusy,
  providerResult,
  providerModels,
  providerModelSourceId,
  modelTestResults,
  handleSourceProviderChange,
  handleSaveProviderSource,
  handleDeleteProviderSource,
  handleDiscoverProviderModels,
  handleSaveModelInstance,
  handleDeleteModelInstance,
  handleTestModelInstance,
  updateModelInstanceLocal,
  handleSaveModelOrder,
}) {
  const confirm = useAdminConfirm()
  const { hosts: allowedHosts, loading: allowedHostsLoading, loadError: allowedHostsLoadError, activeRef, addHost, removeHost } = useAllowedHosts()
  const [allowedHostForm, setAllowedHostForm] = useState(EMPTY_ALLOWED_HOST_FORM)
  const [allowedHostBusy, setAllowedHostBusy] = useState('')
  const [allowedHostResult, setAllowedHostResult] = useState(null)

  // providerResult.message 里可能是后端 detail dict 被 JSON.stringify 后的整串 JSON，
  // 展示前先还原成人话，同时把 error_code / rejected_hostname 取出来。
  const providerErrorInfo = useMemo(
    () => (providerResult && !providerResult.ok ? parseAdminErrorPayload(providerResult.message) : null),
    [providerResult],
  )
  const providerResultMessage = providerResult
    ? (providerResult.ok ? providerResult.message : providerErrorInfo?.message || providerResult.message)
    : ''
  // 后端契约上会带 rejected_hostname；万一没带，就从表单里的 Base URL 自己解析。
  const rejectedHostname = useMemo(() => {
    if (providerErrorInfo?.error_code !== 'base_url_not_allowed') return ''
    const fromPayload = String(providerErrorInfo?.payload?.rejected_hostname || '').trim()
    return fromPayload || hostnameFromBaseUrl(providerSourceForm?.base_url)
  }, [providerErrorInfo, providerSourceForm?.base_url])

  async function handleAddAllowedHost() {
    const raw = allowedHostForm.hostname.trim()
    if (!raw) {
      setAllowedHostResult({ ok: false, message: '请填写要允许的主机名。' })
      return
    }
    // 用户可能整条 Base URL 粘进来，能解析就归一成主机名。
    const hostname = hostnameFromBaseUrl(raw) || raw
    setAllowedHostBusy('add')
    setAllowedHostResult(null)
    const result = await addHost(hostname, allowedHostForm.note)
    if (!activeRef.current) return
    if (result.ok) setAllowedHostForm(EMPTY_ALLOWED_HOST_FORM)
    setAllowedHostResult({ ok: result.ok, message: result.message })
    setAllowedHostBusy('')
  }

  async function handleRemoveAllowedHost(host) {
    const confirmed = await confirm({
      title: '移除允许主机',
      description: `移除后，Base URL 指向 ${host.hostname} 的服务源将无法保存，依赖它的模型实例也会立即不可用。之后可以重新添加。`,
      confirmLabel: '移除主机',
    })
    if (!confirmed || !activeRef.current) return
    setAllowedHostBusy(`delete:${host.id}`)
    setAllowedHostResult(null)
    const result = await removeHost(host.id)
    if (!activeRef.current) return
    setAllowedHostResult({ ok: result.ok, message: result.ok ? `已移除 ${host.hostname}。` : result.message })
    setAllowedHostBusy('')
  }

  // 一键修复：加入允许列表后自动重试保存服务源，用户不必再自己点一次。
  async function handleAllowRejectedHost() {
    if (!rejectedHostname) return
    setAllowedHostBusy('quick-add')
    setAllowedHostResult(null)
    const result = await addHost(rejectedHostname, '保存服务源时自动加入')
    if (!activeRef.current) return
    if (!result.ok && result.errorCode !== 'hostname_exists') {
      setAllowedHostResult({ ok: false, message: result.message })
      setAllowedHostBusy('')
      return
    }
    setAllowedHostResult({ ok: true, message: `${rejectedHostname} 已在允许列表中，正在重试保存服务源…` })
    try {
      await handleSaveProviderSource()
    } finally {
      if (activeRef.current) setAllowedHostBusy('')
    }
  }

  const inputStyle = ADMIN_SETTINGS_INPUT_STYLE
  const modelsByPurpose = {
    image_generation: modelInstances.filter((item) => item.purpose === 'image_generation'),
    text_generation: modelInstances.filter((item) => item.purpose === 'text_generation'),
  }
  const sourceOptions = providerSources.map((source) => ({
    value: String(source.id),
    label: source.name || source.provider || `Source ${source.id}`,
  }))

  return (
    <div className="space-y-4" data-ui="admin-settings-ai">
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
              color: providerResult.ok ? 'var(--accent)' : 'var(--danger-text)',
            }}
          >
            <div>{providerResult.ok ? '✓ ' : '✗ '}{providerResultMessage}</div>
            {rejectedHostname ? (
              <div className="mt-2 space-y-1">
                <button
                  type="button"
                  disabled={allowedHostBusy === 'quick-add'}
                  onClick={handleAllowRejectedHost}
                  className="min-h-11 rounded-lg border border-current px-3 text-xs font-semibold disabled:opacity-50"
                >
                  {allowedHostBusy === 'quick-add' ? '正在加入允许列表…' : `把 ${rejectedHostname} 加入允许列表`}
                </button>
                <div className="text-xs opacity-80">加入后会自动重试保存服务源。请确认这是你自己信任的网关。</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className={panel === 'providers' ? 'space-y-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4' : 'hidden'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">服务源</div>
              <button
                type="button"
                onClick={() => setProviderSourceForm(EMPTY_PROVIDER_SOURCE_FORM)}
                className="min-h-11 rounded-lg border border-[var(--border-muted)] px-3 text-xs font-semibold text-[var(--accent)]"
              >
                新建服务源
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源名称
                <input
                  name="provider_source_name"
                  autoComplete="off"
                  value={providerSourceForm.name}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="例如 OpenAI Gateway"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Provider
                <select
                  name="provider_type"
                  value={providerSourceForm.provider}
                  onChange={(event) => handleSourceProviderChange(event.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                  name="provider_protocol"
                  value={providerSourceForm.protocol}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, protocol: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                启用
                <select
                  name="provider_enabled"
                  value={providerSourceForm.enabled ? 'yes' : 'no'}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, enabled: event.target.value === 'yes' }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                type="url"
                name="provider_base_url"
                autoComplete="url"
                value={providerSourceForm.base_url}
                onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, base_url: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                style={inputStyle}
                placeholder="https://api.example.com/v1"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                API Key 环境变量
                <input
                  name="provider_api_key_env_var"
                  autoComplete="off"
                  spellCheck={false}
                  value={providerSourceForm.api_key_env_var}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, api_key_env_var: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="AI_API_KEY"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源 API Key
                <input
                  type="password"
                  name="provider_api_key"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={providerSourceForm.api_key_value}
                  onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, api_key_value: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
              name="provider_extra_json"
              autoComplete="off"
              spellCheck={false}
              value={providerSourceForm.extra_json}
              onChange={(event) => setProviderSourceForm((prev) => ({ ...prev, extra_json: event.target.value }))}
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                      <button type="button" onClick={() => setProviderSourceForm(providerFormFromSource(source))} className="min-h-11 rounded border border-[var(--border-muted)] px-3 text-[var(--accent)]">编辑</button>
                      <button type="button" disabled={providerBusy === `source:models:${source.id}`} onClick={() => handleDiscoverProviderModels(source.id)} className="min-h-11 rounded border border-[var(--border-muted)] px-3 text-[var(--accent)] disabled:opacity-50">{providerBusy === `source:models:${source.id}` ? '发现中…' : '发现模型'}</button>
                      <button type="button" disabled={providerBusy === `source:delete:${source.id}`} onClick={() => handleDeleteProviderSource(source.id)} className="min-h-11 rounded border border-[var(--border-muted)] px-3 text-[var(--danger-text)] disabled:opacity-50">删除</button>
                    </div>
                  </div>
                  <div className="mt-2 truncate text-[var(--text-secondary)]">{source.base_url || '未配置 Base URL'}</div>
                </div>
              )) : <div className="rounded-lg border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">暂无服务源</div>}
            </div>
          </div>

          <section
            className={panel === 'providers' ? 'space-y-3 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4' : 'hidden'}
            data-ui="admin-provider-allowed-hosts"
            aria-label="Base URL 允许主机"
          >
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Base URL 允许主机</h4>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
                只有列在这里（或后端内置预设）的主机，才能作为服务源 Base URL 使用。
                加入允许列表意味着后端会带着 API Key 向该主机发起请求，请只添加你自己信任的网关。
                指向内网或保留地址（127.0.0.1、10.x.x.x、192.168.x.x 等）的主机会被后端拒绝，这一层不能在后台绕过。
              </p>
            </div>

            {allowedHostResult ? (
              <div
                className="rounded-lg px-3 py-2 text-xs"
                role="status"
                aria-live="polite"
                style={{
                  backgroundColor: allowedHostResult.ok ? 'var(--accent-soft)' : 'var(--danger-soft)',
                  color: allowedHostResult.ok ? 'var(--accent)' : 'var(--danger-text)',
                }}
              >
                {allowedHostResult.ok ? '✓ ' : '✗ '}{allowedHostResult.message}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <label htmlFor="allowed-host-hostname" className="block text-xs font-medium text-[var(--text-secondary)]">
                  主机名
                </label>
                <input
                  id="allowed-host-hostname"
                  name="allowed_host_hostname"
                  autoComplete="off"
                  spellCheck={false}
                  value={allowedHostForm.hostname}
                  onChange={(event) => setAllowedHostForm((prev) => ({ ...prev, hostname: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="gateway.example.com"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="allowed-host-note" className="block text-xs font-medium text-[var(--text-secondary)]">
                  备注（可选）
                </label>
                <input
                  id="allowed-host-note"
                  name="allowed_host_note"
                  autoComplete="off"
                  value={allowedHostForm.note}
                  onChange={(event) => setAllowedHostForm((prev) => ({ ...prev, note: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="例如 自建网关"
                />
              </div>
              <button
                type="button"
                disabled={allowedHostBusy === 'add'}
                onClick={handleAddAllowedHost}
                className="min-h-11 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {allowedHostBusy === 'add' ? '添加中…' : '添加允许主机'}
              </button>
            </div>

            {allowedHostsLoadError ? (
              <div role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger-text)]">
                {allowedHostsLoadError}
              </div>
            ) : null}

            {allowedHostsLoading ? (
              <div className="rounded-lg border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
                正在加载允许主机…
              </div>
            ) : allowedHosts.length ? (
              <ul className="space-y-2">
                {allowedHosts.map((host) => (
                  <li
                    key={host.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--text-primary)]">{host.hostname}</div>
                      <div className="mt-1 text-[var(--text-faint)]">
                        {host.note ? `${host.note} · ` : ''}添加于 {formatDate(host.created_at) || '未知时间'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={allowedHostBusy === `delete:${host.id}`}
                      onClick={() => handleRemoveAllowedHost(host)}
                      aria-label={`移除允许主机 ${host.hostname}`}
                      className="min-h-11 rounded border border-[var(--border-muted)] px-3 text-[var(--danger-text)] disabled:opacity-50"
                    >
                      {allowedHostBusy === `delete:${host.id}` ? '移除中…' : '移除'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : allowedHostsLoadError ? null : (
              <div className="rounded-lg border border-dashed border-[var(--border-muted)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
                还没有额外的允许主机，当前只能使用后端内置预设。
              </div>
            )}
          </section>

          <div className={panel === 'models' ? 'space-y-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4' : 'hidden'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">模型实例</div>
              <button
                type="button"
                onClick={() => setModelInstanceForm(EMPTY_MODEL_INSTANCE_FORM)}
                className="min-h-11 rounded-lg border border-[var(--border-muted)] px-3 text-xs font-semibold text-[var(--accent)]"
              >
                新建模型实例
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                服务源
                <select
                  name="model_source_id"
                  value={modelInstanceForm.source_id}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, source_id: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                >
                  <option value="">选择服务源</option>
                  {sourceOptions.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Purpose
                <select
                  name="model_purpose"
                  value={modelInstanceForm.purpose}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, purpose: event.target.value, capabilities: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                  name="model_instance_name"
                  autoComplete="off"
                  value={modelInstanceForm.name}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="例如 Claude 文本主力"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Model
                <input
                  name="model_id"
                  autoComplete="off"
                  spellCheck={false}
                  value={modelInstanceForm.model}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, model: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="模型 ID"
                />
              </label>
            </div>

            {providerModels.length && providerModelSourceId === Number(modelInstanceForm.source_id) ? (
              <select
                name="discovered_model"
                value=""
                onChange={(event) => event.target.value && setModelInstanceForm((prev) => ({ ...prev, model: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                  name="model_capabilities"
                  autoComplete="off"
                  spellCheck={false}
                  value={modelInstanceForm.capabilities}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, capabilities: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={inputStyle}
                  placeholder="逗号分隔"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-[var(--text-secondary)]">
                Priority
                <input
                  type="number"
                  name="model_priority"
                  min="1"
                  value={modelInstanceForm.priority}
                  onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, priority: event.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
              name="model_extra_json"
              autoComplete="off"
              spellCheck={false}
              value={modelInstanceForm.extra_json}
              onChange={(event) => setModelInstanceForm((prev) => ({ ...prev, extra_json: event.target.value }))}
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                          <button type="button" disabled={providerBusy === `model:delete:${item.id}`} onClick={() => handleDeleteModelInstance(item.id)} className="rounded border border-[var(--border-muted)] px-2 py-1 text-[var(--danger-text)] disabled:opacity-50">删除</button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
                        <label className="inline-flex items-center gap-2 text-[var(--text-secondary)]"><input type="checkbox" checked={Boolean(item.is_default)} onChange={(event) => updateModelInstanceLocal(item.id, 'is_default', event.target.checked)} />默认</label>
                        <label className="flex items-center gap-2 text-[var(--text-secondary)]">优先级<input name={`model_priority_${item.id}`} type="number" min="1" value={item.priority || 1} onChange={(event) => updateModelInstanceLocal(item.id, 'priority', Number(event.target.value) || 1)} className="min-h-11 w-20 rounded px-2 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" style={inputStyle} /></label>
                      </div>
                      {testResult ? (
                        <div className="mt-2 rounded px-3 py-2" style={{ backgroundColor: testResult.ok ? 'var(--accent-soft)' : 'var(--danger-soft)', color: testResult.ok ? 'var(--accent)' : 'var(--danger-text)' }}>
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

        <div className={panel === 'runtime' ? 'grid gap-3 md:grid-cols-2' : 'hidden'}>
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
    </div>
  )
}
