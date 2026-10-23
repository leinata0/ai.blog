import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import NewsroomCollections from '../src/components/news/NewsroomCollections'

afterEach(cleanup)

const topic = {
  topic_key: 'research/agents', display_title: '智能体的研究进展', description: '沿公开研究与应用记录回看这条主线。',
  post_count: 8, latest_post_at: '2026-07-25T08:00:00Z', latest_post_title: '不应重复呈现的文章标题',
}
const series = {
  slug: 'ai-daily-brief', title: 'AI 日报简报', description: '聚焦一条主题，连接背景与来源。', post_count: 124,
  cover_image: 'https://img.563118077.xyz/real-cover.png', latest_post_at: '2026-07-25T08:00:00Z',
}
function mount(props = {}) {
  return render(<MemoryRouter><NewsroomCollections {...props} /></MemoryRouter>)
}

it('links actual topic archives and series with real counts and dates without duplicating articles', () => {
  const { container } = mount({ topics: [topic], modules: { featured_series: [series] } })
  const topics = screen.getByRole('region', { name: /主题档案/ })
  const topicLink = within(topics).getByRole('link', { name: /智能体的研究进展/ })
  expect(topicLink).toHaveAttribute('href', '/topics/research%2Fagents')
  expect(within(topicLink).getByText('8 篇文章')).toBeInTheDocument()
  expect(within(topicLink).getByText('2026/07/25')).toHaveAttribute('datetime', '2026-07-25T08:00:00.000Z')
  expect(screen.queryByText(topic.latest_post_title)).not.toBeInTheDocument()
  const seriesLink = screen.getByRole('link', { name: /AI 日报简报/ })
  expect(seriesLink).toHaveAttribute('href', '/series/ai-daily-brief')
  expect(within(seriesLink).getByText('124 篇文章')).toBeInTheDocument()
  expect(seriesLink.querySelector('img')).toHaveAttribute('src', series.cover_image)
  expect(container.querySelector('#edition-topics')).toHaveAttribute('data-edition-chapter')
  expect(container.querySelector('#edition-reading')).toHaveAttribute('data-edition-chapter')
})

it('caps distinct nonempty topics and usable series without manufacturing cards', () => {
  const topics = [topic, topic, { ...topic, topic_key: 'no-posts', post_count: 0 }, ...Array.from({ length: 5 }, (_, i) => ({ ...topic, topic_key: `topic-${i}`, display_title: `主题 ${i}` }))]
  mount({ topics, modules: { featured_series: [series, series, { ...series, slug: 'empty', post_count: 0 }, { ...series, slug: 'two', title: '第二系列' }, { ...series, slug: 'three', title: '第三系列' }] } })
  expect(document.querySelectorAll('.newsroom-topic')).toHaveLength(4)
  expect(document.querySelectorAll('.newsroom-series-feature')).toHaveLength(2)
  expect(screen.queryByRole('link', { name: /第三系列/ })).not.toBeInTheDocument()
  expect(screen.queryByText(/正在发酵|模型与产品|开源与工具/)).not.toBeInTheDocument()
})

it('contracts empty collections while keeping direct reading and subscription links usable', () => {
  const { container } = mount()
  expect(screen.getByText('暂时没有可展示的主题与系列，可从完整主题档案继续查找。')).toBeInTheDocument()
  expect(container.querySelector('.newsroom-series-grid')).toBeNull()
  expect(screen.getByRole('link', { name: /全部主题/ })).toHaveAttribute('href', '/topics')
  expect(screen.getByRole('link', { name: /打开订阅中心/ })).toHaveAttribute('href', '/feeds')
  expect(screen.getByRole('link', { name: /RSS 订阅/ }).getAttribute('href')).toContain('/feed.xml')
  const reading = screen.getByRole('navigation', { name: '继续阅读' })
  expect(within(reading).getByRole('link', { name: /AI 日报/ })).toHaveAttribute('href', '/daily')
  expect(within(reading).getByRole('link', { name: /AI 周报/ })).toHaveAttribute('href', '/weekly')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('retains a single series and its reading path when topics are unavailable or its cover fails', () => {
  mount({ modules: { featured_series: [series] } })
  expect(screen.getByText('暂时没有可展示的主题，先沿已有系列继续阅读。')).toBeInTheDocument()
  expect(document.querySelectorAll('.newsroom-series-feature')).toHaveLength(1)
  fireEvent.error(document.querySelector('.newsroom-series-feature img'))
  expect(document.querySelector('.newsroom-series-feature img')).toBeNull()
  expect(screen.getByRole('link', { name: /AI 日报简报/ })).toHaveAttribute('href', '/series/ai-daily-brief')
})

it('shows retry without discarding successful collection data or direct reading links', () => {
  const onRetry = vi.fn()
  mount({ topics: [topic], modules: { featured_series: [series] }, error: '部分专题资料暂时无法加载。', onRetry })
  expect(screen.getByRole('alert')).toHaveTextContent('部分专题资料暂时无法加载。')
  fireEvent.click(screen.getByRole('button', { name: /重试加载/ }))
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: /智能体的研究进展/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /AI 日报简报/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /打开订阅中心/ })).toBeInTheDocument()
})

it('reserves initial loading space and keeps already available content during refresh', () => {
  const view = mount({ loading: true })
  expect(screen.getByRole('status')).toHaveTextContent('正在载入主题与系列…')
  expect(document.querySelector('.newsroom-collections')).toHaveAttribute('aria-busy', 'true')
  expect(document.querySelector('.newsroom-collections__loading')).toBeInTheDocument()
  expect(screen.queryByText(/暂时没有可展示/)).not.toBeInTheDocument()
  view.rerender(<MemoryRouter><NewsroomCollections loading topics={[topic]} /></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('正在刷新主题与系列…')
  expect(screen.getByRole('link', { name: /智能体的研究进展/ })).toBeInTheDocument()
  expect(document.querySelector('.newsroom-collections__loading')).toBeNull()
})
