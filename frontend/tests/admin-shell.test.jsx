import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FileText, Settings } from 'lucide-react'

import AdminShell from '../src/components/admin/AdminShell'

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: true, toggleTheme: vi.fn() }),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminGenerationJobs: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
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

function renderShell(props = {}) {
  return render(
    <MemoryRouter>
      <AdminShell
        groups={groups}
        activeSection="posts"
      onSectionChange={vi.fn()}
      onCreatePost={vi.fn()}
      onOpenPost={vi.fn()}
      onLogout={vi.fn()}
        title="文章工作台"
        description="管理文章"
        {...props}
      >
        <div>工作区内容</div>
      </AdminShell>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

it('opens the mobile navigation as a modal and restores focus after Escape', async () => {
  renderShell()
  const trigger = screen.getByRole('button', { name: '打开管理导航' })

  await userEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: '移动端管理导航' })).toHaveAttribute('aria-modal', 'true')

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '移动端管理导航' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('opens the operations command palette with Ctrl+K', async () => {
  renderShell()

  await userEvent.keyboard('{Control>}k{/Control}')

  expect(screen.getByRole('dialog', { name: '运营导航' })).toBeInTheDocument()
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: '搜索管理命令' })).toHaveFocus()
  })
})
