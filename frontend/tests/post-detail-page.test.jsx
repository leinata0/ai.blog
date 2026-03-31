import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import PostDetailPage from '../src/pages/PostDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: vi.fn((slug) => {
    if (slug === 'missing') {
      return Promise.reject(new Error('HTTP 404'))
    }
    return Promise.resolve({
      title: 'Python 自动化实战：Selenium 与 Pandas 结合',
      slug: 'python-automation-selenium-pandas',
      summary: '从页面抓取到表格清洗，串起 Selenium 与 Pandas 的一套高频自动化工作流。',
      content_md: '# Python 自动化实战：Selenium 与 Pandas 结合\n\n结合 Selenium 的页面操作能力与 Pandas 的数据整理能力，可以快速搭建抓取、清洗、导出一体化的自动化脚本。',
      tags: [{ name: 'Python', slug: 'python' }],
    })
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders post detail', async () => {
  const { container } = render(<MemoryRouter><PostDetailPage slug="python-automation-selenium-pandas" /></MemoryRouter>)
  const headings = await screen.findAllByRole('heading', { name: /python 自动化实战/i })
  expect(headings.length).toBeGreaterThan(0)
  expect(container.querySelector('[data-ui="detail-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="detail-article"]')).toBeTruthy()
})

it('shows not found message on404', async () => {
  const { container } = render(<MemoryRouter><PostDetailPage slug="missing" /></MemoryRouter>)
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  expect(container.querySelector('[data-ui="detail-error"]')).toBeTruthy()
})
