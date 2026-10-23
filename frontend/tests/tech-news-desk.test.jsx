import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import TechNewsDesk from '../src/components/news/TechNewsDesk'

const posts = [
  { slug: 'first', title: '第一条真实焦点', summary: '第一条摘要', cover_image: 'https://img.563118077.xyz/first.jpg', created_at: '2026-07-26T08:00:00Z', source_count: 3, reading_time: 8 },
  { slug: 'second', title: '第二条真实焦点', summary: '第二条摘要', cover_image: 'https://img.563118077.xyz/second.jpg', created_at: '2026-07-25T08:00:00Z', source_count: 5, reading_time: 12 },
  { slug: 'third', title: '第三条真实焦点', summary: '第三条摘要', created_at: '2026-07-24T08:00:00Z' },
]

function desk(props = {}) {
  return <MemoryRouter><TechNewsDesk posts={posts} onPreview={vi.fn()} onPrefetch={vi.fn()} {...props} /></MemoryRouter>
}

it('updates all featured content and preview together only when a reader selects another story', async () => {
  const onPreview = vi.fn()
  render(desk({ onPreview }))
  const second = screen.getByRole('button', { name: /第二条真实焦点/ })
  await userEvent.hover(second)
  expect(screen.getByRole('heading', { level: 2, name: posts[0].title })).toBeInTheDocument()
  await userEvent.click(second)

  const article = screen.getByRole('article')
  expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent(posts[1].title)
  expect(within(article).getByText(posts[1].summary)).toBeInTheDocument()
  expect(within(article).getByText('5 个来源')).toBeInTheDocument()
  expect(within(article).getByText('2026/07/25')).toHaveAttribute('dateTime', '2026-07-25T08:00:00.000Z')
  expect(within(article).getByRole('link', { name: '阅读全文' })).toHaveAttribute('href', '/posts/second')
  expect(within(article).getByRole('img')).toHaveAttribute('src', posts[1].cover_image)
  expect(second).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(article).getByRole('button', { name: '快速预览' }))
  expect(onPreview).toHaveBeenCalledWith(posts[1])
})

it('preserves the selected slug across refreshed ordering and falls back when it leaves the choices', async () => {
  const view = render(desk())
  await userEvent.click(screen.getByRole('button', { name: /第二条真实焦点/ }))
  view.rerender(desk({ posts: [posts[2], posts[0], posts[1]] }))
  expect(screen.getByRole('heading', { level: 2, name: posts[1].title })).toBeInTheDocument()
  view.rerender(desk({ posts: [posts[0], posts[2]] }))
  expect(screen.getByRole('heading', { level: 2, name: posts[0].title })).toBeInTheDocument()
})

it('keeps the headline readable after cover failure and can switch to a story without a cover', async () => {
  const { container } = render(desk())
  fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(container.querySelector('.tech-feature__fallback')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: posts[0].title })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /第三条真实焦点/ }))
  expect(screen.getByRole('heading', { level: 2, name: posts[2].title })).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '阅读全文' })).toHaveAttribute('href', '/posts/third')
})
