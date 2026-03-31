import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import HomePage from '../src/pages/HomePage'

vi.mock('../src/api/posts', () => ({
  fetchPosts: vi.fn((tag) => {
    const allPosts = [
      {
        title: 'Python 自动化实战：Selenium 与 Pandas 结合',
        slug: 'python-automation-selenium-pandas',
        summary: '从页面抓取到表格清洗，串起 Selenium 与 Pandas 的一套高频自动化工作流。',
        tags: [
          { name: 'Python', slug: 'python' },
          { name: 'Automation', slug: 'automation' },
        ],
      },
      {
        title: 'C/C++ 核心概念学习与排坑记录',
        slug: 'cpp-core-concepts-notes',
        summary: '围绕指针、内存管理、对象生命周期与编译链接问题的持续学习笔记。',
        tags: [{ name: 'C/C++', slug: 'cpp' }],
      },
      {
        title: 'OpenClaw 部署指南：从零搭建你的私有化平台',
        slug: 'openclaw-deployment-guide',
        summary: '手把手教你用 Docker Compose 部署 OpenClaw，涵盖环境准备、配置调优与常见问题排查。',
        tags: [
          { name: 'DevOps', slug: 'devops' },
          { name: 'OpenClaw', slug: 'openclaw' },
        ],
      },
    ]
    return Promise.resolve(tag ? allPosts.filter((post) => post.tags.some((t) => t.slug === tag)) : allPosts)
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders posts and filters by tag click', async () => {
  const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
  expect(await screen.findByText(/python 自动化实战/i)).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: /极客开发日志/i })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="post-card"]')).toBeTruthy()
  await userEvent.click(screen.getAllByRole('button', { name: /python/i })[0])
  expect(await screen.findByText(/python 自动化实战/i)).toBeInTheDocument()
  expect(screen.queryByText(/c\/c\+\+ 核心概念学习与排坑记录/i)).not.toBeInTheDocument()
})
