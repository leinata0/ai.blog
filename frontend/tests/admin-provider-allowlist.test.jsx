import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  fetchHosts: vi.fn(),
  createHost: vi.fn(),
  deleteHost: vi.fn(),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminAiProviderAllowedHosts: mocks.fetchHosts,
  createAdminAiProviderAllowedHost: mocks.createHost,
  deleteAdminAiProviderAllowedHost: mocks.deleteHost,
}))

const { AdminConfirmProvider } = await import('../src/components/admin/AdminConfirmDialog')
const AdminAiProviderPanel = (await import('../src/components/admin/AdminAiProviderPanel')).default
const { EMPTY_MODEL_INSTANCE_FORM, EMPTY_PROVIDER_SOURCE_FORM } = await import('../src/components/admin/adminSettingsShared')

/** 后端用 HTTPException(detail={...})，到前端就是一整坨 JSON 字符串。 */
function backendError(payload) {
  return new Error(JSON.stringify(payload))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

/**
 * 面板本身是受控组件，服务源的保存结果由 AdminSettings 持有。
 * 这里用一个最小 harness 复刻那份状态，好让「保存失败 → 一键加入 → 自动重试」
 * 的完整链路能在组件测试里跑通。
 */
function ProviderPanelHarness({ initialResult = null, baseUrl = '', onSave }) {
  const [providerResult, setProviderResult] = useState(initialResult)
  const [providerSourceForm, setProviderSourceForm] = useState({ ...EMPTY_PROVIDER_SOURCE_FORM, base_url: baseUrl })

  async function handleSaveProviderSource() {
    const next = await onSave?.()
    setProviderResult(next || { ok: true, message: '服务源已保存' })
  }

  return (
    <AdminAiProviderPanel
      panel="providers"
      providerSources={[]}
      modelInstances={[]}
      runtimePlan={{ image_generation: [], text_generation: [] }}
      providerSourceForm={providerSourceForm}
      setProviderSourceForm={setProviderSourceForm}
      modelInstanceForm={EMPTY_MODEL_INSTANCE_FORM}
      setModelInstanceForm={() => {}}
      providerBusy=""
      providerResult={providerResult}
      providerModels={[]}
      providerModelSourceId={null}
      modelTestResults={{}}
      handleSourceProviderChange={() => {}}
      handleSaveProviderSource={handleSaveProviderSource}
      handleDeleteProviderSource={() => {}}
      handleDiscoverProviderModels={() => {}}
      handleSaveModelInstance={() => {}}
      handleDeleteModelInstance={() => {}}
      handleTestModelInstance={() => {}}
      updateModelInstanceLocal={() => {}}
      handleSaveModelOrder={() => {}}
    />
  )
}

function renderPanel(props = {}) {
  return render(
    <AdminConfirmProvider>
      <ProviderPanelHarness {...props} />
    </AdminConfirmProvider>,
  )
}

let consoleErrorSpy

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.fetchHosts.mockReset()
  mocks.createHost.mockReset()
  mocks.deleteHost.mockReset()
  mocks.fetchHosts.mockResolvedValue([])
  mocks.createHost.mockResolvedValue({ id: 1 })
  mocks.deleteHost.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.clearAllMocks()
})

describe('Base URL 允许主机管理', () => {
  it('列出已允许的主机，并说明加入允许列表的后果', async () => {
    mocks.fetchHosts.mockResolvedValue([
      { id: 1, hostname: 'chybenzun.top', note: '自建网关', created_at: '2026-07-26T08:00:00+00:00' },
    ])

    renderPanel()

    expect(await screen.findByText('chybenzun.top')).toBeInTheDocument()
    expect(screen.getByText(/自建网关 · 添加于/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除允许主机 chybenzun.top' })).toBeInTheDocument()
    // 安全提示要如实说明「后端会带着 API Key 请求该主机」和「私网会被拒绝」。
    expect(screen.getByText(/后端会带着 API Key 向该主机发起请求/)).toBeInTheDocument()
    expect(screen.getByText(/指向内网或保留地址.*会被后端拒绝/)).toBeInTheDocument()
  })

  it('空列表时给出可操作的空状态', async () => {
    renderPanel()
    expect(await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')).toBeInTheDocument()
  })

  it('提交表单后按契约字段调用 POST，并刷新列表', async () => {
    const user = userEvent.setup()
    mocks.fetchHosts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 5, hostname: 'ai.20110318.xyz', note: '备用网关', created_at: '2026-07-26T08:00:00+00:00' },
      ])

    renderPanel()
    await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')

    await user.type(screen.getByLabelText('主机名'), 'ai.20110318.xyz')
    await user.type(screen.getByLabelText('备注（可选）'), '备用网关')
    await user.click(screen.getByRole('button', { name: '添加允许主机' }))

    await waitFor(() => expect(mocks.createHost).toHaveBeenCalledWith({
      hostname: 'ai.20110318.xyz',
      note: '备用网关',
    }))
    expect(await screen.findByText(/已把 ai\.20110318\.xyz 加入允许列表/)).toBeInTheDocument()
    expect(await screen.findByText('ai.20110318.xyz')).toBeInTheDocument()
    expect(screen.getByLabelText('主机名')).toHaveValue('')
  })

  it('备注留空时不发送 note 字段，并把整条 Base URL 归一成主机名', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')

    await user.type(screen.getByLabelText('主机名'), 'https://jiuuij.de5.net/v1')
    await user.click(screen.getByRole('button', { name: '添加允许主机' }))

    await waitFor(() => expect(mocks.createHost).toHaveBeenCalledWith({ hostname: 'jiuuij.de5.net' }))
  })

  it('删除走确认对话框，取消时不发请求', async () => {
    const user = userEvent.setup()
    mocks.fetchHosts
      .mockResolvedValueOnce([{ id: 1, hostname: 'chybenzun.top', note: '', created_at: '2026-07-26T08:00:00+00:00' }])
      .mockResolvedValue([])

    renderPanel()
    const trigger = await screen.findByRole('button', { name: '移除允许主机 chybenzun.top' })

    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: '移除允许主机' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.deleteHost).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '移除允许主机 chybenzun.top' }))
    await user.click(await screen.findByRole('button', { name: '移除主机' }))

    await waitFor(() => expect(mocks.deleteHost).toHaveBeenCalledWith(1))
    expect(await screen.findByText(/已移除 chybenzun\.top/)).toBeInTheDocument()
  })
})

describe('保存服务源被拒后的一键加入', () => {
  const rejectedPayload = {
    message: 'Base URL 主机不在允许列表中，请先把该主机加入允许列表。',
    error_code: 'base_url_not_allowed',
    rejected_hostname: 'wisart.kuaileshifu.com',
  }

  it('展示解析后的错误文案，而不是原始 JSON', async () => {
    renderPanel({ initialResult: { ok: false, message: JSON.stringify(rejectedPayload) } })

    expect(screen.getByText(/Base URL 主机不在允许列表中/)).toBeInTheDocument()
    expect(screen.queryByText(/error_code/)).not.toBeInTheDocument()
    expect(screen.queryByText(/base_url_not_allowed/)).not.toBeInTheDocument()
  })

  it('点击后加入允许列表并自动重试保存服务源', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true, message: '服务源已保存' }))
    mocks.fetchHosts
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 9, hostname: 'wisart.kuaileshifu.com', note: '保存服务源时自动加入', created_at: '2026-07-26T08:00:00+00:00' },
      ])

    renderPanel({
      initialResult: { ok: false, message: JSON.stringify(rejectedPayload) },
      baseUrl: 'https://wisart.kuaileshifu.com/v1',
      onSave,
    })

    await user.click(await screen.findByRole('button', { name: '把 wisart.kuaileshifu.com 加入允许列表' }))

    await waitFor(() => expect(mocks.createHost).toHaveBeenCalledWith({
      hostname: 'wisart.kuaileshifu.com',
      note: '保存服务源时自动加入',
    }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/服务源已保存/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '把 wisart.kuaileshifu.com 加入允许列表' })).not.toBeInTheDocument())
    expect(await screen.findByText('wisart.kuaileshifu.com')).toBeInTheDocument()
  })

  it('主机早就在列表里时也照样重试保存', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true, message: '服务源已保存' }))
    mocks.createHost.mockRejectedValue(backendError({ message: '主机已存在', error_code: 'hostname_exists' }))

    renderPanel({ initialResult: { ok: false, message: JSON.stringify(rejectedPayload) }, onSave })

    await user.click(await screen.findByRole('button', { name: '把 wisart.kuaileshifu.com 加入允许列表' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  })

  it('私网主机被拒时不重试保存，只展示原因', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true, message: '服务源已保存' }))
    mocks.createHost.mockRejectedValue(backendError({ message: '主机不是公网地址', error_code: 'hostname_not_public' }))

    renderPanel({ initialResult: { ok: false, message: JSON.stringify(rejectedPayload) }, onSave })

    await user.click(await screen.findByRole('button', { name: '把 wisart.kuaileshifu.com 加入允许列表' }))

    expect(await screen.findByText(/后端不会把 API Key 发往这类地址/)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('后端没带 rejected_hostname 时从 Base URL 兜底解析', async () => {
    const withoutHostname = { message: 'Base URL 主机不在允许列表中。', error_code: 'base_url_not_allowed' }

    const withScheme = renderPanel({
      initialResult: { ok: false, message: JSON.stringify(withoutHostname) },
      baseUrl: 'https://jiuuij.de5.net/v1',
    })
    expect(await screen.findByRole('button', { name: '把 jiuuij.de5.net 加入允许列表' })).toBeInTheDocument()
    withScheme.unmount()

    // 用户常常不写 scheme。
    const withoutScheme = renderPanel({
      initialResult: { ok: false, message: JSON.stringify(withoutHostname) },
      baseUrl: 'chybenzun.top/v1',
    })
    expect(await screen.findByRole('button', { name: '把 chybenzun.top 加入允许列表' })).toBeInTheDocument()
    withoutScheme.unmount()

    // Base URL 根本解析不出主机名时不提供按钮，避免发一个必然失败的请求。
    renderPanel({
      initialResult: { ok: false, message: JSON.stringify(withoutHostname) },
      baseUrl: 'not a url',
    })
    await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')
    expect(screen.queryByRole('button', { name: /加入允许列表$/ })).not.toBeInTheDocument()
  })

  it('不是 base_url_not_allowed 的错误不出现一键按钮', async () => {
    renderPanel({
      initialResult: { ok: false, message: JSON.stringify({ message: '名称重复', error_code: 'name_exists' }) },
      baseUrl: 'https://wisart.kuaileshifu.com/v1',
    })

    expect(screen.getByText(/名称重复/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /加入允许列表$/ })).not.toBeInTheDocument()
  })
})

describe('允许主机的错误码文案', () => {
  it.each([
    ['invalid_hostname', /主机名格式不合法/],
    ['hostname_not_public', /后端不会把 API Key 发往这类地址/],
    ['hostname_exists', /已经在允许列表里/],
  ])('把 %s 翻译成人话', async (errorCode, expected) => {
    const user = userEvent.setup()
    mocks.createHost.mockRejectedValue(backendError({ message: '后端原始文案', error_code: errorCode }))

    renderPanel()
    await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')

    await user.type(screen.getByLabelText('主机名'), 'gateway.example.com')
    await user.click(screen.getByRole('button', { name: '添加允许主机' }))

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(/error_code/)).not.toBeInTheDocument()
  })

  it('列表加载失败时降级成提示，不拖垮整个 Provider 面板', async () => {
    mocks.fetchHosts.mockRejectedValue(new Error('HTTP 404'))

    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404')
    expect(screen.getByText('AI Provider 配置')).toBeInTheDocument()
  })
})

describe('卸载后不再写入状态', () => {
  it('列表响应晚于卸载时不会 setState', async () => {
    const pending = deferred()
    mocks.fetchHosts.mockReturnValue(pending.promise)

    const { unmount } = renderPanel()
    expect(screen.getByText('正在加载允许主机…')).toBeInTheDocument()

    unmount()
    pending.resolve([{ id: 1, hostname: 'late.example.com', note: '', created_at: '2026-07-26T08:00:00+00:00' }])
    await flushMicrotasks()

    expect(screen.queryByText('late.example.com')).not.toBeInTheDocument()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('添加请求晚于卸载时不会再补一次列表请求', async () => {
    const user = userEvent.setup()
    const pendingCreate = deferred()
    mocks.createHost.mockReturnValue(pendingCreate.promise)

    const { unmount } = renderPanel()
    await screen.findByText('还没有额外的允许主机，当前只能使用后端内置预设。')

    await user.type(screen.getByLabelText('主机名'), 'gateway.example.com')
    await user.click(screen.getByRole('button', { name: '添加允许主机' }))
    await waitFor(() => expect(mocks.createHost).toHaveBeenCalled())

    unmount()
    pendingCreate.resolve({ id: 1 })
    await flushMicrotasks()

    expect(mocks.fetchHosts).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
