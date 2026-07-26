import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { FileText, Settings } from 'lucide-react'

const {
  fetchAdminGenerationJobsMock,
  fetchAdminPostsMock,
  fetchPostDetailMock,
} = vi.hoisted(() => ({
  fetchAdminGenerationJobsMock: vi.fn(),
  fetchAdminPostsMock: vi.fn(),
  fetchPostDetailMock: vi.fn(),
}))

vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: fetchPostDetailMock,
}))

vi.mock('../src/api/admin', () => ({
  adminCreatePost: vi.fn(),
  adminUpdatePost: vi.fn(),
  adminUploadImage: vi.fn(),
  generateAdminPostCover: vi.fn(),
  waitForAdminImageGenerationJob: vi.fn(),
  fetchAdminGenerationJobs: fetchAdminGenerationJobsMock,
  fetchAdminPosts: fetchAdminPostsMock,
}))

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggleTheme: vi.fn() }),
}))

import AdminJobsDock from '../src/components/admin/AdminJobsDock'
import AdminPostEditor from '../src/components/admin/AdminPostEditor'
import AdminShell from '../src/components/admin/AdminShell'
import { AdminConfirmProvider } from '../src/components/admin/AdminConfirmDialog'
import { upsertAdminJob } from '../src/components/admin/adminJobsStore'

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
  fetchAdminGenerationJobsMock.mockResolvedValue({ items: [] })
  fetchAdminPostsMock.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AdminJobsDock polling', () => {
  it('keeps polling while jobs keep emitting updates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AdminJobsDock />)

    await act(async () => {
      upsertAdminJob({ localId: 'a', label: '封面 A', status: 'running' })
    })
    fetchAdminGenerationJobsMock.mockClear()

    // Every store upsert produces a new jobs array with a fresh `updatedAt`, even when the
    // set of active jobs is unchanged. While the poll effect depended on `jobs`, this
    // stream of progress updates restarted the 20s interval before it could ever fire.
    for (let tick = 0; tick < 5; tick += 1) {
      await act(async () => {
        vi.advanceTimersByTime(5000)
        upsertAdminJob({ localId: 'a', label: '封面 A', detail: `进度 ${tick}`, status: 'running' })
      })
    }

    expect(fetchAdminGenerationJobsMock.mock.calls.length).toBeGreaterThan(0)
  })

  it('surfaces a background sync failure instead of freezing on stale statuses', async () => {
    fetchAdminGenerationJobsMock.mockRejectedValue(new Error('HTTP 401'))
    render(<AdminJobsDock />)

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401')
  })
})

describe('AdminShell command palette', () => {
  const groups = [
    { label: '内容', items: [{ key: 'posts', label: '文章', icon: FileText }] },
    { label: '系统', items: [{ key: 'settings', label: '系统设置', icon: Settings }] },
  ]

  function renderShell() {
    return render(
      <MemoryRouter>
        <AdminShell
          groups={groups}
          activeSection="posts"
          onSectionChange={vi.fn()}
          onCreatePost={vi.fn()}
          onOpenPost={vi.fn()}
          onReturnPublic={vi.fn()}
          onLogout={vi.fn()}
          title="文章工作台"
          description="管理文章"
        >
          <div>工作区内容</div>
        </AdminShell>
      </MemoryRouter>,
    )
  }

  it('opens the jobs dock even when it is already open', async () => {
    renderShell()

    // Open the dock directly first — the old implementation synthesised a click on the
    // dock toggle, so running 「打开任务面板」 in this state closed it instead.
    await userEvent.click(screen.getByRole('button', { name: '打开任务面板' }))
    expect(await screen.findByRole('dialog', { name: '生成任务' })).toBeInTheDocument()

    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.click(await screen.findByRole('option', { name: /打开任务面板/ }))

    expect(screen.getByRole('dialog', { name: '生成任务' })).toBeInTheDocument()
  })
})

describe('AdminPostEditor unsaved edits', () => {
  const postDetail = {
    title: 'Post title',
    slug: 'post-slug',
    summary: 'Summary',
    content_md: 'Content',
    tags: [{ slug: 'ai' }],
    cover_image: '',
    is_published: true,
    is_pinned: false,
  }

  it('does not overwrite the form when the same post is handed over again', async () => {
    fetchPostDetailMock.mockResolvedValue(postDetail)
    const view = render(
      <AdminConfirmProvider>
        <AdminPostEditor editingPost={{ id: 123, slug: 'post-slug' }} onBack={vi.fn()} onSaved={vi.fn()} />
      </AdminConfirmProvider>,
    )

    const titleInput = await screen.findByLabelText('标题')
    await waitFor(() => expect(titleInput).toHaveValue('Post title'))

    fireEvent.change(titleInput, { target: { value: '正在编辑的新标题' } })
    expect(titleInput).toHaveValue('正在编辑的新标题')

    // The admin list cache expires every 12s; the refreshed list used to hand the editor
    // a structurally identical but referentially new post object, re-running the loader.
    view.rerender(
      <AdminConfirmProvider>
        <AdminPostEditor editingPost={{ id: 123, slug: 'post-slug' }} onBack={vi.fn()} onSaved={vi.fn()} />
      </AdminConfirmProvider>,
    )

    await waitFor(() => expect(fetchPostDetailMock).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByLabelText('标题')).toHaveValue('正在编辑的新标题')
  })

  it('aborts an in-flight detail request when the editor unmounts', async () => {
    let capturedSignal = null
    fetchPostDetailMock.mockImplementation((slug, options = {}) => {
      capturedSignal = options.signal
      return new Promise(() => {})
    })

    const view = render(
      <AdminConfirmProvider>
        <AdminPostEditor editingPost={{ id: 123, slug: 'post-slug' }} onBack={vi.fn()} onSaved={vi.fn()} />
      </AdminConfirmProvider>,
    )

    await waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))
    expect(capturedSignal.aborted).toBe(false)

    view.unmount()
    expect(capturedSignal.aborted).toBe(true)
  })
})
