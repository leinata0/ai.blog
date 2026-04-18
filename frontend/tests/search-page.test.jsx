import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { SiteProvider } from '../src/contexts/SiteContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import SearchPage from '../src/pages/SearchPage'

vi.mock('../src/api/client', () => ({
  apiGet: vi.fn((path) => {
    if (path === '/api/settings') {
      return Promise.resolve({
        author_name: 'Test',
        bio: '',
        avatar_url: '',
        hero_image: '',
        github_link: '',
        announcement: '',
        site_url: '',
        friend_links: '[]',
      })
    }
    if (path === '/api/stats') {
      return Promise.resolve({ post_count: 10, tag_count: 5, series_count: 3 })
    }
    return Promise.resolve({})
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/posts', () => ({
  fetchSearch: vi.fn(() => Promise.resolve({
    items: [],
    topics: [
      { topic_key: 'agent-mcp', display_title: 'Agent 与 MCP', post_count: 3 },
    ],
    series_suggestions: [
      { slug: 'tooling-workflow', title: '工具与工作流', description: '继续沿栏目恢复上下文。' },
    ],
    popular_queries: [
      { query: 'openai agent', search_count: 4, last_result_count: 3 },
    ],
  })),
  fetchTopics: vi.fn(() => Promise.resolve({
    items: [
      { topic_key: 'agent-mcp', display_title: 'Agent 与 MCP', post_count: 3 },
    ],
  })),
  fetchSeriesList: vi.fn(() => Promise.resolve([
    { slug: 'tooling-workflow', title: '工具与工作流', description: '继续沿栏目恢复上下文。' },
  ])),
  prefetchPostDetail: vi.fn(),
  prefetchTopicDetail: vi.fn(),
  prefetchSeriesDetail: vi.fn(),
}))

it('shows zero-result rescue modules with topics, series, and popular queries', async () => {
  render(
    <MemoryRouter initialEntries={['/search?q=missing-signal']}>
      <ThemeProvider>
        <SiteProvider>
          <SearchPage />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByText('还没有匹配结果')).toBeInTheDocument()
  expect(await screen.findByText('先从相邻主线恢复阅读路径')).toBeInTheDocument()
  expect((await screen.findAllByRole('link', { name: /Agent 与 MCP/i }))[0]).toHaveAttribute('href', '/topics/agent-mcp')
  expect((await screen.findAllByRole('link', { name: /工具与工作流/i }))[0]).toHaveAttribute('href', '/series/tooling-workflow')
  expect(await screen.findByRole('button', { name: 'openai agent' })).toBeInTheDocument()
})
