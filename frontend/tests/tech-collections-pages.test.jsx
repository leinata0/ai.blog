import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import TopicsPage from '../src/pages/TopicsPage'
import SeriesPage from '../src/pages/SeriesPage'
import { fetchTopics, fetchSeriesList, prefetchTopicDetail, prefetchSeriesDetail } from '../src/api/posts'
import { setNewsStyle } from '../src/hooks/useNewsStyle'

vi.mock('../src/components/Navbar', () => ({ default: () => <nav aria-label="测试主导航" /> }))
vi.mock('../src/components/Footer', () => ({ default: () => <footer /> }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))
vi.mock('../src/api/posts', () => ({ fetchTopics: vi.fn(), fetchSeriesList: vi.fn(), prefetchTopicDetail: vi.fn(), prefetchSeriesDetail: vi.fn() }))

const topics = [
  { topic_key: 'agents/research', display_title: '智能体研究', description: '观察多智能体协作的真实进展。', post_count: 7, source_count: 12, latest_post_at: '2026-07-25T08:00:00Z', is_featured: true },
  { topic_key: 'open-models', display_title: '开放模型', description: '模型权重与工具链的变化。', post_count: 3, source_count: 5 },
]
const series = [
  { slug: 'research/library', title: '研究收藏', description: '沿方法与产品阅读研究变化。', post_count: 8, cover_image: 'https://img.563118077.xyz/library.jpg', latest_post_at: '2026-07-25T08:00:00Z', latest_posts: [{ slug: 'paper-note', title: '最新研究手记' }] },
  { slug: 'product-library', title: '产品收藏', description: '从产品更新到长期主线。', post_count: 2 },
]
const mount = (page) => render(<MemoryRouter>{page}</MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  fetchTopics.mockResolvedValue({ items: topics })
  fetchSeriesList.mockResolvedValue(series)
})
afterEach(cleanup)

it('uses a real topic atlas with local filtering and encoded topic routes in tech mode', async () => {
  const { container } = mount(<TopicsPage />)
  const atlas = await screen.findByRole('heading', { name: '智能体研究' })
  expect(atlas.closest('a')).toHaveAttribute('href', '/topics/agents%2Fresearch')
  expect(container.querySelector('[data-ui="tech-topic-atlas"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="paper-topic-index"]')).toBeNull()
  expect(container.querySelectorAll('.tech-topic-node')).toHaveLength(2)
  const article = atlas.closest('article')
  expect(within(article).getByText('12 条来源')).toBeInTheDocument()
  expect(within(article).getByText('2026/07/25')).toHaveAttribute('datetime', '2026-07-25T08:00:00.000Z')
  fireEvent.focus(atlas.closest('a'))
  expect(prefetchTopicDetail).toHaveBeenCalledWith('agents/research', expect.any(Object))

  await userEvent.type(screen.getByRole('searchbox', { name: '筛选已载入主题' }), '权重')
  expect(screen.queryByRole('heading', { name: '智能体研究' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '开放模型' })).toBeInTheDocument()
  expect(fetchTopics).toHaveBeenCalledTimes(1)
  await userEvent.clear(screen.getByRole('searchbox', { name: '筛选已载入主题' }))
  await userEvent.type(screen.getByRole('searchbox', { name: '筛选已载入主题' }), '不存在的线索')
  expect(screen.getByRole('heading', { name: '没有匹配的主题坐标' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '查看全部已载入主题' }))
  expect(container.querySelectorAll('.tech-topic-node')).toHaveLength(2)
})

it('retains a separate paper topic index when style switches without refetching topics', async () => {
  const { container } = mount(<TopicsPage />)
  await screen.findByRole('heading', { name: '智能体研究' })
  act(() => setNewsStyle('paper'))
  expect(container.querySelector('[data-ui="tech-topic-atlas"]')).toBeNull()
  expect(container.querySelector('[data-ui="paper-topic-index"]')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '用主题，把分散消息串成长期主线' })).toBeInTheDocument()
  expect(screen.queryByRole('searchbox', { name: '筛选已载入主题' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /智能体研究/ })).toHaveAttribute('href', '/topics/agents%2Fresearch')
  expect(fetchTopics).toHaveBeenCalledTimes(1)
})

it('distinguishes topic failures from an empty atlas and recovers through retry', async () => {
  fetchTopics.mockRejectedValueOnce(new Error('主题服务暂不可用'))
  mount(<TopicsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('主题服务暂不可用')
  expect(screen.queryByText('新的主题，等待下一条线索。')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '重新加载主题' }))
  expect(await screen.findByRole('heading', { name: '智能体研究' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('renders real series as dimensional books with reading, subscription and recent article routes', async () => {
  const { container } = mount(<SeriesPage />)
  const shelf = await waitFor(() => {
    const node = container.querySelector('[data-ui="tech-series-shelf"]')
    expect(node).toBeTruthy()
    return node
  })
  expect(container.querySelector('[data-ui="series-stack-stage"]')).toBeNull()
  expect(container.querySelector('[data-ui="paper-series-index"]')).toBeNull()
  const volume = shelf.querySelector('[data-series-slug="research/library"]')
  const book = within(volume).getByRole('link', { name: '阅读研究收藏' })
  expect(book).toHaveAttribute('href', '/series/research%2Flibrary')
  expect(book.querySelector('img')).toHaveAttribute('src', series[0].cover_image)
  expect(volume.querySelector('.tech-series-book__spine')).toBeTruthy()
  expect(within(volume).getByRole('link', { name: '订阅系列' })).toHaveAttribute('href', '/feeds?series_slug=research%2Flibrary')
  expect(within(volume).getByRole('link', { name: '最新研究手记' })).toHaveAttribute('href', '/posts/paper-note')
  expect(within(volume).getByText('8')).toBeInTheDocument()
  fireEvent.focus(book)
  expect(prefetchSeriesDetail).toHaveBeenCalledWith('research/library', expect.any(Object))
  fireEvent.error(book.querySelector('img'))
  expect(book.querySelector('img')).toBeNull()
  expect(book.querySelector('.tech-series-book__fallback')).toBeTruthy()
})

it('retains the paper series editorial stack and switches structures without another request', async () => {
  const { container } = mount(<SeriesPage />)
  await screen.findByRole('heading', { name: '研究收藏' })
  act(() => setNewsStyle('paper'))
  expect(container.querySelector('[data-ui="tech-series-shelf"]')).toBeNull()
  expect(container.querySelector('[data-ui="paper-series-index"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="series-stack-stage"]')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '把文章整理成更容易持续阅读的路径' })).toBeInTheDocument()
  expect(fetchSeriesList).toHaveBeenCalledTimes(1)
})

it('recovers a failed series request and aborts an outstanding request on unmount', async () => {
  fetchSeriesList.mockRejectedValueOnce(new Error('系列服务暂不可用'))
  const view = mount(<SeriesPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('系列服务暂不可用')
  await userEvent.click(screen.getByRole('button', { name: '重新加载系列' }))
  expect(await screen.findByRole('heading', { name: '研究收藏' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  view.unmount()

  let resolve
  fetchSeriesList.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const pending = mount(<SeriesPage />)
  const request = fetchSeriesList.mock.calls.at(-1)[1]
  pending.unmount()
  expect(request.signal.aborted).toBe(true)
  await act(async () => resolve(series))
})
