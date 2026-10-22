import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import TodaySignalBoard from '../src/components/TodaySignalBoard'
import { formatDate } from '../src/utils/date'

function renderBoard(props = {}) {
  return render(<MemoryRouter><TodaySignalBoard {...props} /></MemoryRouter>)
}

it('labels historical content as reading signals and exposes the publication date', () => {
  const createdAt = '2026-07-26T08:00:00Z'
  const { container } = renderBoard({ posts: [{
    slug: 'old-post', title: '历史文章', created_at: createdAt, updated_at: '2026-10-08T10:00:00Z',
  }] })

  expect(screen.getByRole('complementary', { name: 'AI 阅读信号台' })).toBeInTheDocument()
  expect(screen.queryByText(/今日|LIVE SIGNAL/)).not.toBeInTheDocument()
  expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00.000Z')
  expect(container.querySelector('time')).toHaveTextContent(formatDate(createdAt))
  expect(screen.getByRole('link', { name: /历史文章/ })).toHaveAttribute('href', '/posts/old-post')
})

it.each([undefined, 'invalid-date'])('omits a publication date when it is %s', (createdAt) => {
  const { container } = renderBoard({ posts: [{ slug: 'undated', title: '无日期文章', created_at: createdAt }] })

  expect(container.querySelector('time')).not.toBeInTheDocument()
  expect(screen.queryByText(/发布于/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /无日期文章/ })).toHaveAttribute('href', '/posts/undated')
})

it('keeps the empty state honest about content availability', () => {
  renderBoard()
  expect(screen.getByText('阅读信号正在整理中。')).toBeInTheDocument()
  expect(screen.queryByText(/今日|LIVE SIGNAL/)).not.toBeInTheDocument()
})
