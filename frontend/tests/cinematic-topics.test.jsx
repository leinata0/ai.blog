import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import TechTopics from '../src/components/collections/TechTopics'

const topics = [
  { topic_key: 'agents/research', display_title: '智能体研究', description: '沿协作研究追踪变化。', cover_image: 'https://img.563118077.xyz/agents.jpg', post_count: 7, source_count: 12 },
  { topic_key: 'open-models', display_title: '开放模型', description: '模型权重与工具链的变化。', cover_image: 'https://img.563118077.xyz/models.jpg', post_count: 3, source_count: 5 },
]
const mount = (props = {}) => render(<MemoryRouter><TechTopics topics={topics} {...props} /></MemoryRouter>)

it('switches the spotlight cover, description and genuine topic route together', async () => {
  const onPrefetch = vi.fn()
  const { container } = mount({ onPrefetch })
  const hero = container.querySelector('.cinema-topics-hero')
  expect(within(hero).getByRole('link', { name: '进入主题：智能体研究' })).toHaveAttribute('href', '/topics/agents%2Fresearch')
  expect(hero.querySelector('img')).toHaveAttribute('src', topics[0].cover_image)
  expect(hero.querySelector('img')).toHaveAttribute('loading', 'eager')
  const selectors = screen.getByRole('group', { name: '选择预览主题' })
  const switchTopic = within(selectors).getByRole('button', { name: /开放模型/ })
  fireEvent.focus(switchTopic)
  expect(onPrefetch).toHaveBeenCalledWith('open-models')
  await userEvent.click(switchTopic)
  expect(switchTopic).toHaveAttribute('aria-pressed', 'true')
  expect(within(hero).getByRole('link', { name: '进入主题：开放模型' })).toHaveAttribute('href', '/topics/open-models')
  expect(within(hero).getByText(topics[1].description)).toBeInTheDocument()
  await waitFor(() => {
    expect(hero.querySelectorAll('img')).toHaveLength(1)
    expect(hero.querySelector('img')).toHaveAttribute('src', topics[1].cover_image)
  })
})

it('filters the loaded index by topic context and clears it without new data requests', async () => {
  const { container } = mount()
  await userEvent.type(screen.getByRole('searchbox', { name: '筛选已载入主题' }), '权重')
  expect(screen.queryByRole('heading', { name: '智能体研究' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '开放模型' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '进入主题：开放模型' })).toHaveAttribute('href', '/topics/open-models')
  expect(container.querySelector('.cinema-topics-search')).toHaveTextContent('1 / 2')
  await userEvent.click(screen.getByRole('button', { name: '清空主题筛选' }))
  expect(container.querySelectorAll('.cinema-topic-entry')).toHaveLength(2)
})

it('deduplicates topic keys and keeps missing or failed covers as text editions', () => {
  const { container } = mount({ topics: [topics[0], topics[0], { topic_key: '', display_title: '无效主题' }, { ...topics[1], cover_image: '', post_count: null, source_count: 'not a count' }] })
  expect(container.querySelectorAll('.cinema-topic-entry')).toHaveLength(2)
  const hero = container.querySelector('.cinema-topics-hero')
  fireEvent.error(hero.querySelector('img'))
  expect(hero.querySelector('img')).toBeNull()
  expect(hero.querySelector('.cinema-cover-fallback')).toHaveTextContent('封面暂不可用')
  const noCover = container.querySelector('[data-topic-key="open-models"]')
  expect(noCover.querySelector('img')).toBeNull()
  expect(noCover.querySelector('.cinema-cover-fallback')).toHaveTextContent('暂无封面')
  expect(noCover).toHaveTextContent('— 篇文章')
  expect(noCover).toHaveTextContent('— 条来源')
  expect(container).not.toHaveTextContent('NaN')
})

it('places initial-failure recovery in the visible hero and keeps stale-data errors separate', async () => {
  const onRetry = vi.fn()
  const view = mount({ topics: [], error: '主题服务不可用', onRetry })
  const hero = view.container.querySelector('.cinema-topics-hero')
  expect(within(hero).getByRole('alert')).toHaveTextContent('主题服务不可用')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  await userEvent.click(within(hero).getByRole('button', { name: '重新加载主题' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
  view.rerender(<MemoryRouter><TechTopics topics={topics} error="更新失败，保留已载入主题" onRetry={onRetry} /></MemoryRouter>)
  expect(within(view.container.querySelector('.cinema-topics-hero')).queryByRole('alert')).toBeNull()
  expect(screen.getByRole('alert')).toHaveTextContent('更新失败，保留已载入主题')
  expect(view.container.querySelectorAll('.cinema-topic-entry')).toHaveLength(2)
})
