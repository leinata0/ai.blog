import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import AdminDashboardPage from '../src/pages/AdminDashboardPage'

const mocks = vi.hoisted(() => ({
  fetchAdminPost: vi.fn(),
  fetchAdminPosts: vi.fn(),
}))

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggleTheme: vi.fn() }),
}))

vi.mock('../src/api/auth', () => ({
  getToken: () => 'admin-token',
  clearToken: vi.fn(),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminPost: mocks.fetchAdminPost,
  fetchAdminPosts: mocks.fetchAdminPosts,
  fetchAdminGenerationJobs: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  adminDeletePost: vi.fn(),
  adminUpdatePost: vi.fn(),
  generateAdminPostCover: vi.fn(),
}))

vi.mock('../src/components/admin/AdminPostsList', () => ({
  default: ({ filters, pagination, onApplyFilters, onPageChange, onNew }) => (
    <section>
      <div data-testid="active-filters">{JSON.stringify(filters)}</div>
      <div data-testid="active-page">{pagination.page}</div>
      <button type="button" onClick={() => onApplyFilters({ ...filters, search: 'robotics' })}>
        模拟筛选
      </button>
      <button type="button" onClick={() => onPageChange(3)}>模拟翻页</button>
      <button type="button" onClick={onNew}>模拟新文章</button>
    </section>
  ),
}))

vi.mock('../src/components/admin/AdminPostEditor', () => ({
  default: ({ editingPost, onDirtyChange }) => (
    <div>
      <div>编辑器：{editingPost?.id || 'new'}</div>
      <button type="button" onClick={() => onDirtyChange?.(true)}>模拟未保存修改</button>
    </div>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderDashboard(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminDashboardPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchAdminPosts.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  })
  mocks.fetchAdminPost.mockResolvedValue({
    id: 99,
    slug: 'deep-linked-post',
    title: '深链文章',
  })
})

afterEach(cleanup)

it('hydrates article filters and pagination from the URL', async () => {
  mocks.fetchAdminPosts.mockResolvedValue({
    items: [],
    total: 81,
    page: 2,
    page_size: 50,
  })

  renderDashboard('/admin/dashboard?section=posts&q=agents&content_type=post&published=draft&published_mode=manual&page=2&page_size=50')

  await waitFor(() => {
    expect(mocks.fetchAdminPosts).toHaveBeenCalledWith({
      page: 2,
      page_size: 50,
      q: 'agents',
      content_type: 'post',
      is_published: 'false',
      published_mode: 'manual',
    }, {})
  })
  expect(screen.getByTestId('active-filters')).toHaveTextContent('"search":"agents"')

  await userEvent.click(screen.getByRole('button', { name: '模拟筛选' }))
  expect(await screen.findByTestId('location')).toHaveTextContent('q=robotics')

  await userEvent.click(screen.getByRole('button', { name: '模拟翻页' }))
  expect(await screen.findByTestId('location')).toHaveTextContent('page=3')
})

it('replaces invalid management state with safe defaults', async () => {
  renderDashboard('/admin/dashboard?section=unknown&view=preview&panel=secret&page_size=999')

  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard?section=posts')
  })
  expect(screen.getByRole('button', { name: '文章' })).toHaveAttribute('aria-current', 'page')
})

it('writes the new article editor state to the URL before mounting the editor', async () => {
  renderDashboard('/admin/dashboard?section=posts')
  await waitFor(() => expect(mocks.fetchAdminPosts).toHaveBeenCalled())

  await userEvent.click(screen.getByRole('button', { name: '模拟新文章' }))

  expect(await screen.findByText('编辑器：new')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('view=editor')
  expect(screen.getByTestId('location')).toHaveTextContent('post=new')
})

it('loads an editor deep link independently from the current list page', async () => {
  renderDashboard('/admin/dashboard?section=posts&view=editor&post=99&page=4&q=outside')

  expect(await screen.findByText('编辑器：99')).toBeInTheDocument()
  expect(mocks.fetchAdminPost).toHaveBeenCalledWith('99', expect.objectContaining({
    signal: expect.any(AbortSignal),
  }))
  expect(screen.getByTestId('location')).toHaveTextContent('view=editor')
  expect(screen.getByTestId('location')).toHaveTextContent('post=99')
})

it('blocks section navigation while the editor has unsaved changes', async () => {
  renderDashboard('/admin/dashboard?section=posts&view=editor&post=new')

  await screen.findByText('编辑器：new')
  await userEvent.click(screen.getByRole('button', { name: '模拟未保存修改' }))
  await userEvent.click(screen.getByRole('button', { name: '系统设置' }))

  expect(screen.getByRole('dialog', { name: '放弃尚未保存的修改？' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByTestId('location')).toHaveTextContent('view=editor')

  await userEvent.click(screen.getByRole('button', { name: '系统设置' }))
  await userEvent.click(screen.getByRole('button', { name: '放弃并离开' }))
  // React Router 7 wraps navigation state updates in `React.startTransition`, so the
  // probe element exists before its location text catches up — wait on the content.
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('section=settings'))
})
