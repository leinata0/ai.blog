import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import TechSeries from '../src/components/collections/TechSeries'

const series = [
  { slug: 'models', title: '模型追踪', description: '模型能力的长期变化。', cover_image: 'https://images.example.com/models.jpg', post_count: '12', latest_post_at: '2026-07-25', latest_posts: [{ slug: 'model/one', title: '模型更新观察' }] },
  { slug: 'research', title: '研究现场', description: '追踪研究中的新方法。', cover_image: 'https://images.example.com/research.jpg', post_count: '5', latest_post_at: '2026-07-22', latest_posts: [{ slug: 'research-one', title: '研究新方法' }] },
]

function setup(props = {}) {
  return render(<MemoryRouter><div className="cinema-layout cinema-series"><TechSeries items={series} {...props} /></div></MemoryRouter>)
}

it('switches the featured collection and links to that series while preserving genuine article and subscription links', () => {
  const onPrefetch = vi.fn()
  const { container } = setup({ onPrefetch })
  const hero = within(container.querySelector('.cinema-series-hero'))
  expect(hero.getByRole('link', { name: '打开这个系列' })).toHaveAttribute('href', '/series/models')
  fireEvent.click(hero.getByRole('button', { name: /研究现场/ }))
  expect(hero.getByRole('button', { name: /研究现场/ })).toHaveAttribute('aria-pressed', 'true')
  expect(hero.getByRole('link', { name: '打开这个系列' })).toHaveAttribute('href', '/series/research')
  expect(hero.getByRole('heading', { level: 2, name: '研究现场' })).toBeInTheDocument()
  expect(onPrefetch).toHaveBeenCalledWith('research')
  expect(screen.getByRole('link', { name: '模型更新观察' })).toHaveAttribute('href', '/posts/model%2Fone')
  const firstRecord = within(container.querySelector('[data-series-slug="models"]'))
  expect(firstRecord.getByRole('link', { name: '订阅系列' })).toHaveAttribute('href', '/feeds?series_slug=models')
  expect(container.querySelector('.cinema-series-hero__image img').getAttribute('src')).toContain('models.jpg')
  expect(container.querySelectorAll('.cinema-series-record__cover img')[1].getAttribute('src')).toContain('research.jpg')
})

it('deduplicates series and recent articles, validates unknown metadata and recovers selection when data changes', () => {
  const malformed = { slug: 'valid', title: '有效系列', post_count: ' ', latest_post_at: 'bad-date', latest_posts: [{ slug: 'one', title: '唯一报道' }, { slug: 'one', title: '重复报道' }, { title: '没有地址' }] }
  const { container, rerender } = setup({ items: [malformed, { ...malformed }, { slug: '  ' }, null] })
  expect(container.querySelectorAll('[data-series-slug]')).toHaveLength(1)
  expect(screen.getAllByText('收录数量待更新')).toHaveLength(2)
  expect(screen.getAllByText('最近发布 暂无日期')).toHaveLength(2)
  expect(screen.getByRole('link', { name: '唯一报道' })).toHaveAttribute('href', '/posts/one')
  expect(screen.queryByRole('link', { name: '重复报道' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '没有地址' })).not.toBeInTheDocument()
  rerender(<MemoryRouter><TechSeries items={[series[1]]} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: '打开这个系列' })).toHaveAttribute('href', '/series/research')
})

it('distinguishes loading, error retry, and empty collection states', () => {
  const onRetry = vi.fn()
  const { rerender } = setup({ items: [], loading: true })
  expect(screen.getByRole('status')).toHaveTextContent('正在打开内容书架')
  expect(screen.queryByRole('heading', { name: '下一本收藏，正在酝酿。' })).not.toBeInTheDocument()
  rerender(<MemoryRouter><TechSeries items={[]} error="系列暂不可用" onRetry={onRetry} /></MemoryRouter>)
  expect(screen.getByRole('alert')).toHaveTextContent('系列暂不可用')
  fireEvent.click(screen.getByRole('button', { name: '重新加载系列' }))
  expect(onRetry).toHaveBeenCalledOnce()
  rerender(<MemoryRouter><TechSeries items={[]} /></MemoryRouter>)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '下一本收藏，正在酝酿。' })).toBeInTheDocument()
})
