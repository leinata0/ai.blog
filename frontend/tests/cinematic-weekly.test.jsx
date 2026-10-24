import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import CinematicWeekly from '../src/components/tech/CinematicWeekly'

afterEach(cleanup)

const posts = [
  { slug: 'week/new', title: '模型走进工作现场', summary: '这一期回看模型能力和工具变化。', created_at: '2026-07-26T08:00:00Z', coverage_date: '2026-07-25', reading_time: 12, source_count: 6, cover_image: 'https://img.563118077.xyz/week-new.jpg' },
  { slug: 'week-old', title: '机器人与真实世界', summary: '机器人进展的原始材料。', created_at: '2026-07-19T08:00:00Z', cover_image: 'https://img.563118077.xyz/week-old.jpg' },
]

function mount(props = {}) {
  return render(<MemoryRouter><div className="cinematic-section"><CinematicWeekly posts={posts} feedUrl="/api/feeds/weekly.xml" {...props} /></div></MemoryRouter>)
}

it('switches weekly covers together with the real title, metadata and article destination', () => {
  const { container } = mount()
  const hero = screen.getByRole('region', { name: 'AI 周报' })
  expect(within(hero).getByRole('link', { name: '阅读这一期：模型走进工作现场' })).toHaveAttribute('href', '/posts/week%2Fnew')
  expect(hero).toHaveTextContent('覆盖 2026-07-25')
  expect(hero.querySelector('.cweekly-cover-panel img')).toHaveAttribute('src', posts[0].cover_image)
  expect(hero.querySelector('.cweekly-cover-panel img')).toHaveAttribute('loading', 'eager')
  fireEvent.click(within(hero).getByRole('button', { name: '下一期封面' }))
  expect(within(hero).getByRole('heading', { level: 2, name: posts[1].title })).toBeInTheDocument()
  expect(within(hero).getByRole('link', { name: `阅读这一期：${posts[1].title}` })).toHaveAttribute('href', '/posts/week-old')
  expect(hero.querySelector('.cweekly-cover-panel:last-child img')).toHaveAttribute('src', posts[1].cover_image)
  expect(within(hero).queryByText('覆盖 2026-07-25')).toBeNull()
  fireEvent.click(within(hero).getByRole('button', { name: '上一期封面' }))
  expect(within(hero).getByRole('heading', { level: 2, name: posts[0].title })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="tech-weekly-edition"]')).toBeInTheDocument()
})

it('searches only the loaded weekly library and preserves links, covers and subscriptions', () => {
  mount()
  const library = screen.getByRole('region', { name: /^周报书架/ })
  expect(within(library).getAllByRole('heading', { level: 3 })).toHaveLength(2)
  expect(within(library).getByRole('link', { name: `阅读周报封面：${posts[1].title}` }).querySelector('img')).toHaveAttribute('loading', 'lazy')
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索已载入周报' }), { target: { value: '机器人' } })
  expect(within(library).getAllByRole('heading', { level: 3 })).toHaveLength(1)
  expect(within(library).getByRole('link', { name: '阅读全文：机器人与真实世界' })).toHaveAttribute('href', '/posts/week-old')
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索已载入周报' }), { target: { value: '无匹配文章' } })
  expect(within(library).getByRole('status')).toHaveTextContent('没有找到相关周报')
  fireEvent.click(screen.getByRole('button', { name: '清空周报搜索' }))
  expect(within(library).getAllByRole('heading', { level: 3 })).toHaveLength(2)
  expect(screen.getByRole('link', { name: '订阅 AI 周报 RSS' })).toHaveAttribute('href', '/api/feeds/weekly.xml')
  expect(screen.getByRole('link', { name: /订阅这个栏目/ })).toHaveAttribute('href', '/feeds?content_type=weekly_review')
})

it('keeps one text edition readable without invented covers, dates or extra issue controls', () => {
  const { container } = mount({ posts: [{ slug: 'text', title: '文字周报', reading_time: null, source_count: 0 }] })
  const hero = screen.getByRole('region', { name: 'AI 周报' })
  expect(within(hero).getByRole('link', { name: '阅读这一期：文字周报' })).toHaveAttribute('href', '/posts/text')
  expect(within(hero).queryByRole('button', { name: '下一期封面' })).toBeNull()
  expect(hero).toHaveTextContent('发布日期未提供')
  expect(hero).not.toHaveTextContent(/0 分钟|0 个来源/)
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(container.querySelector('.cweekly-cover-panel')).toHaveTextContent('暂无封面')
})

it('keeps loading, error retry and successful empty states distinct', () => {
  const onRetry = vi.fn()
  const { rerender } = mount({ posts: [], loading: true, onRetry })
  expect(screen.getByRole('status')).toHaveTextContent('正在载入 AI 周报')
  rerender(<MemoryRouter><CinematicWeekly posts={[]} error="周报加载失败" onRetry={onRetry} feedUrl="/api/feeds/weekly.xml" /></MemoryRouter>)
  expect(screen.getByRole('alert')).toHaveTextContent('周报加载失败')
  fireEvent.click(screen.getByRole('button', { name: /重新加载栏目/ }))
  expect(onRetry).toHaveBeenCalledOnce()
  rerender(<MemoryRouter><CinematicWeekly posts={[]} feedUrl="/api/feeds/weekly.xml" /></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 2, name: 'AI 周报 暂时还没有内容' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
})
