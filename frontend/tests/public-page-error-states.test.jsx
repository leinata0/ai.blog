import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({
  fetchAllTags: vi.fn(),
  fetchFriendLinks: vi.fn(),
  fetchSeriesList: vi.fn(),
  fetchArchive: vi.fn(),
  fetchDiscover: vi.fn(),
  fetchPosts: vi.fn(),
}))

vi.mock('../src/api/posts', () => api)

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggleTheme: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))

import ArchivePage from '../src/pages/ArchivePage'
import ContentTypePage from '../src/pages/ContentTypePage'
import FriendsPage from '../src/pages/FriendsPage'
import NotFoundPage from '../src/pages/NotFoundPage'
import SeriesPage from '../src/pages/SeriesPage'
import TagsPage from '../src/pages/TagsPage'
import { SITE_COPY } from '../src/utils/contentPresentation'

function renderPage(ui, initialEntries = ['/']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((node) => node.remove())
  api.fetchAllTags.mockResolvedValue([])
  api.fetchFriendLinks.mockResolvedValue([])
  api.fetchSeriesList.mockResolvedValue([])
  api.fetchArchive.mockResolvedValue([])
  api.fetchDiscover.mockResolvedValue({ items: [] })
  api.fetchPosts.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

describe('failed loads are not disguised as empty states', () => {
  it.each(['daily_brief', 'weekly_review'])('ContentTypePage recovers from a failed %s load', async (contentType) => {
    api.fetchDiscover.mockRejectedValueOnce(new Error('HTTP 503'))
    api.fetchPosts.mockRejectedValueOnce(new Error('Network error'))

    renderPage(<ContentTypePage contentType={contentType} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('栏目暂时无法加载')
    expect(screen.queryByText(/暂时还没有内容/)).not.toBeInTheDocument()

    api.fetchDiscover.mockResolvedValueOnce({
      items: [{ slug: 'recovered', title: '恢复后的文章', created_at: '2026-07-26T08:00:00Z' }],
    })
    await userEvent.click(screen.getByRole('button', { name: '重新加载栏目' }))

    expect(await screen.findByRole('link', { name: /恢复后的文章/ })).toHaveAttribute('href', '/posts/recovered')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ContentTypePage keeps a successful empty response distinct from a failed request', async () => {
    renderPage(<ContentTypePage contentType="daily_brief" />)

    expect(await screen.findByText('AI 日报 暂时还没有内容')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.fetchPosts).not.toHaveBeenCalled()
  })

  it('ContentTypePage still uses the compatible fallback when the discover endpoint fails', async () => {
    api.fetchDiscover.mockRejectedValueOnce(new Error('HTTP 404'))
    api.fetchPosts.mockResolvedValueOnce({ items: [
      { slug: 'weekly', title: '周报回退文章', content_type: 'weekly_review' },
      { slug: 'daily', title: '不相关的日报', content_type: 'daily_brief' },
    ] })

    renderPage(<ContentTypePage contentType="weekly_review" />)

    expect(await screen.findByRole('link', { name: /周报回退文章/ })).toHaveAttribute('href', '/posts/weekly')
    expect(screen.queryByText('不相关的日报')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('TagsPage shows an error with a retry instead of 暂无标签', async () => {
    api.fetchAllTags.mockRejectedValueOnce(new Error('HTTP 500'))

    renderPage(<TagsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(screen.queryByText('暂无标签')).not.toBeInTheDocument()

    api.fetchAllTags.mockResolvedValueOnce([{ slug: 'ai', name: 'AI', post_count: 3 }])
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(await screen.findByText('AI')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('FriendsPage shows an error with a retry instead of 暂无友链', async () => {
    api.fetchFriendLinks.mockRejectedValueOnce(new Error('HTTP 502'))

    renderPage(<FriendsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 502')
    expect(screen.queryByText('暂无友链')).not.toBeInTheDocument()
  })

  it('SeriesPage shows an error instead of 系列内容正在整理中', async () => {
    api.fetchSeriesList.mockRejectedValueOnce(new Error('HTTP 500'))

    renderPage(<SeriesPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500')
    expect(screen.queryByText(/系列内容正在整理中/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载系列' })).toBeInTheDocument()
  })

  it('ArchivePage shows an error instead of 当前筛选下暂无文章', async () => {
    api.fetchArchive.mockRejectedValueOnce(new Error('HTTP 503'))

    renderPage(<ArchivePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
    expect(screen.queryByText('当前筛选下暂无文章')).not.toBeInTheDocument()
  })
})

describe('pages without SeoMeta used to inherit the previous route head', () => {
  it('NotFoundPage owns a noindex canonical for the requested path', async () => {
    // Simulate arriving from an article whose canonical is still in the head.
    const stale = document.createElement('link')
    stale.setAttribute('rel', 'canonical')
    stale.setAttribute('href', 'https://www.563118077.xyz/posts/previous-article')
    document.head.appendChild(stale)

    renderPage(<NotFoundPage />, ['/posts/deleted-article'])

    await waitFor(() => {
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,follow')
    })
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.563118077.xyz/posts/deleted-article')
    expect(document.title).toContain(SITE_COPY.brand)
    expect(document.title).toContain('404')
  })

  it('TagsPage replaces a stale article canonical with its own', async () => {
    const stale = document.createElement('link')
    stale.setAttribute('rel', 'canonical')
    stale.setAttribute('href', 'https://www.563118077.xyz/posts/previous-article')
    document.head.appendChild(stale)

    renderPage(<TagsPage />)

    await waitFor(() => {
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
        .toBe('https://www.563118077.xyz/tags')
    })
  })
})

describe('brand naming', () => {
  it('uses the current brand in document titles', async () => {
    renderPage(<TagsPage />)
    await waitFor(() => expect(document.title).toBe(`标签 - ${SITE_COPY.brand}`))

    cleanup()
    renderPage(<FriendsPage />)
    await waitFor(() => expect(document.title).toBe(`友链 - ${SITE_COPY.brand}`))
    expect(document.title).not.toContain('极客开发日志')
  })
})
