import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { FileText, Settings } from 'lucide-react'

import AdminCommandPalette from '../src/components/admin/AdminCommandPalette'

const mocks = vi.hoisted(() => ({
  fetchAdminPosts: vi.fn(() => Promise.resolve({ items: [] })),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminPosts: mocks.fetchAdminPosts,
}))

const groups = [
  {
    label: '内容',
    items: [{ key: 'posts', label: '文章', icon: FileText }],
  },
  {
    label: '系统',
    items: [{ key: 'settings', label: '系统设置', icon: Settings }],
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  document.body.style.overflow = ''
})

it('filters management commands and executes the active result with Enter', async () => {
  const onSelectSection = vi.fn()
  const onClose = vi.fn()

  render(
    <AdminCommandPalette
      open
      onClose={onClose}
      groups={groups}
      activeSection="posts"
      onSelectSection={onSelectSection}
      onCreatePost={vi.fn()}
      onOpenPost={vi.fn()}
      onOpenJobs={vi.fn()}
    />,
  )

  const input = screen.getByRole('combobox', { name: '搜索管理命令' })
  await userEvent.type(input, '系统')
  expect(screen.getByRole('option', { name: /系统设置/ })).toHaveAttribute('aria-selected', 'true')

  await userEvent.keyboard('{Enter}')

  expect(onSelectSection).toHaveBeenCalledWith('settings')
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('supports ArrowUp and ArrowDown command navigation', async () => {
  const onCreatePost = vi.fn()
  const onOpenJobs = vi.fn()

  render(
    <AdminCommandPalette
      open
      onClose={vi.fn()}
      groups={groups}
      activeSection="posts"
      onSelectSection={vi.fn()}
      onCreatePost={onCreatePost}
      onOpenPost={vi.fn()}
      onOpenJobs={onOpenJobs}
    />,
  )

  const input = screen.getByRole('combobox', { name: '搜索管理命令' })
  expect(input).toHaveAttribute('aria-activedescendant', 'ops-command-option-create-post')

  await userEvent.click(input)
  await userEvent.keyboard('{ArrowDown}{Enter}')

  expect(onOpenJobs).toHaveBeenCalledTimes(1)
  expect(onCreatePost).not.toHaveBeenCalled()
})

it('debounces article search and opens a matching post', async () => {
  const onOpenPost = vi.fn()
  mocks.fetchAdminPosts.mockResolvedValueOnce({
    items: [{ id: 42, title: 'Agent memory systems', slug: 'agent-memory-systems' }],
  })

  render(
    <AdminCommandPalette
      open
      onClose={vi.fn()}
      groups={groups}
      activeSection="posts"
      onSelectSection={vi.fn()}
      onCreatePost={vi.fn()}
      onOpenPost={onOpenPost}
      onOpenJobs={vi.fn()}
    />,
  )

  expect(document.body.style.overflow).toBe('hidden')
  await userEvent.type(screen.getByRole('combobox', { name: '搜索管理命令' }), 'memory')

  expect(await screen.findByRole('option', { name: /Agent memory systems/ })).toBeInTheDocument()
  expect(mocks.fetchAdminPosts).toHaveBeenCalledWith({
    q: 'memory',
    page: 1,
    page_size: 6,
  })

  await userEvent.click(screen.getByRole('option', { name: /Agent memory systems/ }))
  expect(onOpenPost).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }))
})
