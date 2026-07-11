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

export default function AdminAiProviderPanel({
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
    </div>
  )
}
