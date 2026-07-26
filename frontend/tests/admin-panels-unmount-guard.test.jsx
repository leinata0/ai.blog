import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  fetchAdminStats: vi.fn(),
  fetchAdminComments: vi.fn(),
  fetchAdminImages: vi.fn(),
  fetchAdminQualityInbox: vi.fn(),
  fetchAdminPostQuality: vi.fn(),
  fetchAdminSettings: vi.fn(),
  fetchAdminCoverGenerationStatus: vi.fn(),
  fetchAdminAiProviderSources: vi.fn(),
  fetchAdminAiModelInstances: vi.fn(),
  fetchAdminAiRuntimePlan: vi.fn(),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminStats: mocks.fetchAdminStats,
  fetchAdminComments: mocks.fetchAdminComments,
  approveComment: vi.fn(() => Promise.resolve({})),
  deleteComment: vi.fn(() => Promise.resolve({})),
  fetchAdminImages: mocks.fetchAdminImages,
  deleteAdminImage: vi.fn(() => Promise.resolve({})),
  fetchAdminQualityInbox: mocks.fetchAdminQualityInbox,
  fetchAdminPostQuality: mocks.fetchAdminPostQuality,
  updateAdminPostQualityReview: vi.fn(() => Promise.resolve({})),
  fetchAdminSettings: mocks.fetchAdminSettings,
  updateSettings: vi.fn(() => Promise.resolve({})),
  adminUploadImage: vi.fn(() => Promise.resolve({ url: '' })),
  generateAdminHeroImage: vi.fn(() => Promise.resolve({})),
  waitForAdminImageGenerationJob: vi.fn(() => Promise.resolve({})),
  fetchAdminCoverGenerationStatus: mocks.fetchAdminCoverGenerationStatus,
  fetchAdminAiProviderSources: mocks.fetchAdminAiProviderSources,
  fetchAdminAiModelInstances: mocks.fetchAdminAiModelInstances,
  fetchAdminAiRuntimePlan: mocks.fetchAdminAiRuntimePlan,
  createAdminAiProviderSource: vi.fn(),
  updateAdminAiProviderSource: vi.fn(),
  deleteAdminAiProviderSource: vi.fn(),
  fetchAdminAiProviderSourceModels: vi.fn(),
  createAdminAiModelInstance: vi.fn(),
  updateAdminAiModelInstance: vi.fn(),
  deleteAdminAiModelInstance: vi.fn(),
  updateAdminAiModelOrder: vi.fn(),
  testAdminAiModelInstance: vi.fn(),
}))

const { AdminConfirmProvider } = await import('../src/components/admin/AdminConfirmDialog')
const AdminStats = (await import('../src/components/admin/AdminStats')).default
const AdminComments = (await import('../src/components/admin/AdminComments')).default
const AdminImages = (await import('../src/components/admin/AdminImages')).default
const AdminQualityInbox = (await import('../src/components/admin/AdminQualityInbox')).default
const AdminSettings = (await import('../src/components/admin/AdminSettings')).default

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function withConfirm(node) {
  return <AdminConfirmProvider>{node}</AdminConfirmProvider>
}

/** Let every queued microtask (and the resolution chain behind it) drain. */
async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

let consoleErrorSpy

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.fetchAdminStats.mockReset()
  mocks.fetchAdminComments.mockReset()
  mocks.fetchAdminImages.mockReset()
  mocks.fetchAdminQualityInbox.mockReset()
  mocks.fetchAdminPostQuality.mockReset()
  mocks.fetchAdminSettings.mockReset()
  mocks.fetchAdminCoverGenerationStatus.mockReset()
  mocks.fetchAdminAiProviderSources.mockReset()
  mocks.fetchAdminAiModelInstances.mockReset()
  mocks.fetchAdminAiRuntimePlan.mockReset()
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.clearAllMocks()
})

describe('admin panels stop their async work once the section unmounts', () => {
  it('AdminStats survives a stats response that lands after the panel is gone', async () => {
    const pending = deferred()
    mocks.fetchAdminStats.mockReturnValue(pending.promise)

    const { unmount } = render(<AdminStats />)
    expect(await screen.findByRole('status')).toHaveTextContent('加载中…')

    unmount()
    pending.resolve({ total_posts: 12 })
    await flushMicrotasks()

    expect(mocks.fetchAdminStats).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('AdminComments does not refetch the list when a delete resolves after unmount', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminComments.mockResolvedValue({
      items: [{ id: 1, nickname: '读者', content: '内容', is_approved: false, created_at: '2026-01-01T00:00:00Z' }],
    })
    const pendingDelete = deferred()
    const { deleteComment } = await import('../src/api/admin')
    deleteComment.mockReturnValue(pendingDelete.promise)

    const { unmount } = render(withConfirm(<AdminComments />))
    await screen.findByText('读者')

    await user.click(screen.getByRole('button', { name: /删除评论：读者/ }))
    await user.click(await screen.findByRole('button', { name: '删除评论' }))
    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith(1))

    unmount()
    pendingDelete.resolve({})
    await flushMicrotasks()

    // Without the unmount guard the resolved delete re-runs loadComments().
    expect(mocks.fetchAdminComments).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('AdminImages does not refetch the grid when a delete resolves after unmount', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminImages.mockResolvedValue([{ filename: 'a.png', url: '/uploads/a.png' }])
    const pendingDelete = deferred()
    const { deleteAdminImage } = await import('../src/api/admin')
    deleteAdminImage.mockReturnValue(pendingDelete.promise)

    const { unmount } = render(withConfirm(<AdminImages />))
    await screen.findByText('a.png')

    await user.click(screen.getByRole('button', { name: /删除图片：a\.png/ }))
    await user.click(await screen.findByRole('button', { name: '删除图片' }))
    await waitFor(() => expect(deleteAdminImage).toHaveBeenCalledWith('a.png'))

    unmount()
    pendingDelete.resolve({})
    await flushMicrotasks()

    expect(mocks.fetchAdminImages).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('AdminQualityInbox does not reload after a review save that resolves post-unmount', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminQualityInbox.mockResolvedValue({
      summary: {},
      items: [{ post_id: 5, title: '一篇文章', overall_score: 80, issues: [], strengths: [] }],
    })
    mocks.fetchAdminPostQuality.mockResolvedValue({ post: { title: '一篇文章' }, quality_review: {} })
    const pendingSave = deferred()
    const { updateAdminPostQualityReview } = await import('../src/api/admin')
    updateAdminPostQualityReview.mockReturnValue(pendingSave.promise)

    const { unmount } = render(<AdminQualityInbox />)
    await screen.findByText('一篇文章')

    await user.click(screen.getByRole('button', { name: /查看复盘/ }))
    await waitFor(() => expect(mocks.fetchAdminPostQuality).toHaveBeenCalledWith(5))

    await user.click(screen.getByRole('button', { name: /保存人工复盘/ }))
    await waitFor(() => expect(updateAdminPostQualityReview).toHaveBeenCalled())

    unmount()
    pendingSave.resolve({})
    await flushMicrotasks()

    // Without the guard the save would kick off openDetail() + loadInbox() again.
    expect(mocks.fetchAdminQualityInbox).toHaveBeenCalledTimes(1)
    expect(mocks.fetchAdminPostQuality).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('AdminSettings does not re-poll cover status when hero generation finishes post-unmount', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminSettings.mockResolvedValue({ author_name: '作者', friend_links: '[]' })
    mocks.fetchAdminCoverGenerationStatus.mockResolvedValue({})
    mocks.fetchAdminAiProviderSources.mockResolvedValue([])
    mocks.fetchAdminAiModelInstances.mockResolvedValue([])
    mocks.fetchAdminAiRuntimePlan.mockResolvedValue({ image_generation: [], text_generation: [] })

    const pendingHero = deferred()
    const { generateAdminHeroImage } = await import('../src/api/admin')
    generateAdminHeroImage.mockReturnValue(pendingHero.promise)

    const { unmount } = render(withConfirm(<AdminSettings />))
    await waitFor(() => expect(mocks.fetchAdminCoverGenerationStatus).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: /^生成 Hero 海报$/ }))
    await waitFor(() => expect(generateAdminHeroImage).toHaveBeenCalled())

    unmount()
    pendingHero.resolve({ generated: true, hero_image: 'https://cdn.example/hero.png' })
    await flushMicrotasks()

    // Without the guard the finished job would call loadCoverStatus() a second time.
    expect(mocks.fetchAdminCoverGenerationStatus).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

describe('admin panels surface load failures instead of an empty state', () => {
  it('AdminStats shows the error with a retry that refetches', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminStats
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ total_posts: 7 })

    render(<AdminStats />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(screen.queryByText('暂无统计数据')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.fetchAdminStats).toHaveBeenCalledTimes(2)
  })

  it('AdminComments never renders 暂无评论 for a failed request', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminComments
      .mockRejectedValueOnce(new Error('登录已过期，请重新登录'))
      .mockResolvedValueOnce({ items: [] })

    render(withConfirm(<AdminComments />))

    expect(await screen.findByRole('alert')).toHaveTextContent('登录已过期，请重新登录')
    expect(screen.queryByText('暂无评论')).not.toBeInTheDocument()
    expect(screen.getByText(/评论列表加载失败/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('暂无评论')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AdminImages never renders 暂无已上传图片 for a failed request', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminImages
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce([])

    render(withConfirm(<AdminImages />))

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500')
    expect(screen.queryByText('暂无已上传图片')).not.toBeInTheDocument()
    expect(screen.getByText(/图片列表加载失败/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('暂无已上传图片')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AdminQualityInbox never renders 暂无质量记录 for a failed request', async () => {
    const user = userEvent.setup()
    mocks.fetchAdminQualityInbox
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ summary: {}, items: [] })

    render(<AdminQualityInbox />)

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500')
    expect(screen.queryByText('暂无质量记录。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('暂无质量记录。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
