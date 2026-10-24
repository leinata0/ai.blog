import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SectionUiDemo from '../src/demos/section-ui/SectionUiDemo'
import { ArticleCover } from '../src/demos/section-ui/DailyIssue'
import data from '../src/demos/section-ui/demoContent.json'

vi.mock('../src/components/SeoMeta', () => ({ default: () => null }))

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const postHref = (post) => `/posts/${encodeURIComponent(post.slug)}`
const focusPosts = [data.daily[0], data.daily[1], data.daily[4]]

beforeEach(() => {
  // Preserve native dialog semantics while supplying the two methods missing
  // from JSDOM. The actual detail component and Framer animations run normally.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal() { this.setAttribute('open', '') }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function close() {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }),
  })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  for (const [prototype, name, original] of [
    [HTMLDialogElement.prototype, 'showModal', originalShowModal],
    [HTMLDialogElement.prototype, 'close', originalClose],
    [Element.prototype, 'scrollIntoView', originalScrollIntoView],
  ]) {
    if (original) Object.defineProperty(prototype, name, original)
    else delete prototype[name]
  }
})

function renderDemo() {
  return render(<MemoryRouter initialEntries={['/demo/sections/daily']}>
    <Routes><Route path="/demo/sections/:view?" element={<SectionUiDemo />} /></Routes>
  </MemoryRouter>)
}

async function expectFocusedPost(post, index) {
  const stage = screen.getByRole('region', { name: '日报焦点报道' })
  // Wait for the cover dissolve to finish, then verify the current single
  // headline together with its image, metadata and real read URL.
  await waitFor(() => {
    expect(within(stage).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(within(stage).getByRole('heading', { level: 1, name: post.title, exact: true })).toBeInTheDocument()
    expect(within(stage).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', postHref(post))
    expect(stage.querySelector('.issue-story-meta time')).toHaveAttribute('datetime', post.created_at)
    expect(stage.querySelector('.issue-story-meta')).toHaveTextContent(`${post.source_count} 个原始来源`)
    expect(stage.querySelector('.issue-story-meta')).toHaveTextContent(`${post.reading_time} 分钟阅读`)
    expect(stage.querySelector('.issue-focus-order')).toHaveTextContent(`${String(index + 1).padStart(2, '0')} — 03`)
    expect(stage.querySelector('.issue-scene-images img')).toHaveAttribute('src', post.cover_image)
  })
  expect(within(stage).getByRole('button', { name: `切换焦点：${post.title}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  return stage
}

it('opens on a real dated headline and read destination without the old sculpture stage', async () => {
  const { container } = renderDemo()
  await expectFocusedPost(focusPosts[0], 0)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(focusPosts[0].title)
  expect(container.querySelector('canvas')).not.toBeInTheDocument()
  expect(container.querySelector('.gx-art')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '日报交互展台' })).not.toBeInTheDocument()
  expect(screen.getByText('当前报道配图')).toBeInTheDocument()
  expect(screen.queryByText('AI 原创视觉示意')).not.toBeInTheDocument()
  expect(container.querySelector('img[src*="/observer-issue/"]')).not.toBeInTheDocument()
})

it('keeps all three static-mode focus stories and their images in sync when navigating both ways', async () => {
  const user = userEvent.setup()
  renderDemo()
  await expectFocusedPost(focusPosts[0], 0)
  await user.click(screen.getByRole('button', { name: '下一条焦点报道' }))
  await expectFocusedPost(focusPosts[1], 1)
  await user.click(screen.getByRole('button', { name: '下一条焦点报道' }))
  await expectFocusedPost(focusPosts[2], 2)
  expect(screen.getByText('当前报道配图')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '上一条焦点报道' }))
  await expectFocusedPost(focusPosts[1], 1)
  await user.click(screen.getByRole('button', { name: '上一条焦点报道' }))
  await expectFocusedPost(focusPosts[0], 0)
  await user.click(screen.getByRole('button', { name: '上一条焦点报道' }))
  await expectFocusedPost(focusPosts[2], 2)
})

it('previews the selected report with its original cover and closes the native dialog by button or cancel', async () => {
  const user = userEvent.setup()
  renderDemo()
  const post = focusPosts[1]
  await user.click(screen.getByRole('button', { name: '下一条焦点报道' }))
  await expectFocusedPost(post, 1)
  await user.click(screen.getByRole('button', { name: /先看摘要/ }))
  let dialog = screen.getByRole('dialog', { name: post.title })
  expect(dialog).toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
  expect(within(dialog).getByRole('link', { name: /阅读全文/ })).toHaveAttribute('href', postHref(post))
  expect(dialog.querySelector('img')).toHaveAttribute('src', post.cover_image)
  expect(dialog.querySelector('time')).toHaveAttribute('datetime', post.created_at)
  expect(dialog).toHaveTextContent(`${post.source_count} 个原始来源`)
  expect(dialog).toHaveTextContent(post.summary)
  await user.click(within(dialog).getByRole('button', { name: '关闭报道预览' }))
  expect(dialog).not.toBeInTheDocument()
  expect(dialog).not.toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: /先看摘要/ }))
  dialog = screen.getByRole('dialog', { name: post.title })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(2)
  await expectFocusedPost(post, 1)
})

it('shows no-result archive feedback and restores all twelve reports without changing the focus', async () => {
  const user = userEvent.setup()
  renderDemo()
  const archive = screen.getByRole('region', { name: /^新闻档案\s*12$/ })
  const search = screen.getByRole('searchbox', { name: '搜索已载入报道' })
  await user.type(search, '__issue_no_match_9f3b__')
  expect(screen.getByRole('status')).toHaveTextContent('找到 0 条相关报道')
  expect(within(archive).getByRole('heading', { name: '没有找到相关报道。' })).toBeInTheDocument()
  expect(within(archive).queryAllByRole('button', { name: /^设为焦点：/ })).toHaveLength(0)
  await expectFocusedPost(focusPosts[0], 0)
  await user.click(within(archive).getByRole('button', { name: /清除搜索/ }))
  expect(search).toHaveValue('')
  expect(screen.getByRole('status')).toHaveTextContent('12 条已载入报道')
  expect(within(archive).getAllByRole('button', { name: /^设为焦点：/ })).toHaveLength(data.daily.length)
  for (const post of data.daily) {
    expect(within(archive).getByRole('link', { name: `阅读全文：${post.title}`, exact: true })).toHaveAttribute('href', postHref(post))
  }
})

it('promotes a report outside the default three from the archive with the matching cover and destination', async () => {
  const user = userEvent.setup()
  renderDemo()
  const post = data.daily[8]
  const archive = screen.getByRole('region', { name: /^新闻档案\s*12$/ })
  await user.click(within(archive).getByRole('button', { name: `设为焦点：${post.title}`, exact: true }))
  const stage = await expectFocusedPost(post, 0)
  expect(within(stage).getAllByRole('button', { name: /^切换焦点：/ })).toHaveLength(3)
  expect(within(stage).queryByRole('button', { name: `切换焦点：${focusPosts[2].title}`, exact: true })).not.toBeInTheDocument()
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  await user.click(within(stage).getByRole('button', { name: /先看摘要/ }))
  const dialog = screen.getByRole('dialog', { name: post.title })
  expect(dialog.querySelector('img')).toHaveAttribute('src', post.cover_image)
  expect(within(dialog).getByRole('link', { name: /阅读全文/ })).toHaveAttribute('href', postHref(post))
  expect(dialog).toHaveTextContent(post.summary)
})

it('keeps the homepage and other sections on their existing routes and closes the mobile menu on Escape', async () => {
  const user = userEvent.setup()
  renderDemo()
  expect(screen.getByRole('link', { name: 'AI 资讯观察首页' })).toHaveAttribute('href', '/')
  const destinations = { 首页: '/', 日报: '/demo/sections/daily', 周报: '/weekly', 主题: '/topics', 系列: '/series', 开始阅读: '/start-here' }
  const desktop = screen.getByRole('navigation', { name: 'Demo 主导航' })
  for (const [label, href] of Object.entries(destinations)) {
    expect(within(desktop).getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href)
  }
  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  const mobile = screen.getByRole('navigation', { name: 'Demo 手机导航' })
  expect(screen.getByRole('button', { name: '关闭栏目菜单' })).toHaveAttribute('aria-expanded', 'true')
  for (const [label, href] of Object.entries(destinations)) {
    expect(within(mobile).getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href)
  }
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Demo 手机导航' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开栏目菜单' })).toHaveAttribute('aria-expanded', 'false')
})

it('keeps a failed report cover as a stable placeholder without borrowing artwork or another report image', async () => {
  const user = userEvent.setup()
  renderDemo()
  const stage = await expectFocusedPost(focusPosts[0], 0)
  const image = stage.querySelector('.issue-scene-images img')
  fireEvent.error(image)
  expect(stage.querySelector('.issue-scene-images img')).not.toBeInTheDocument()
  expect(stage.querySelector('.issue-image-fallback')).toHaveTextContent('本报道封面暂不可用')
  expect(stage.querySelector('.issue-image-fallback')).toHaveAccessibleName(`${focusPosts[0].title}：本报道封面暂不可用`)
  // An unrelated rerender must not retry the failed URL indefinitely.
  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  await user.keyboard('{Escape}')
  expect(stage.querySelector('.issue-scene-images img')).not.toBeInTheDocument()
  expect(stage.querySelector('.issue-image-fallback')).toHaveTextContent('本报道封面暂不可用')
  expect(within(stage).getByRole('heading', { level: 1, name: focusPosts[0].title, exact: true })).toBeInTheDocument()
  expect(within(stage).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', postHref(focusPosts[0]))
})

it('shows an explicit no-cover state when the selected report has no cover image', () => {
  const post = { ...data.daily[8], cover_image: '' }
  const { container, rerender } = render(<ArticleCover post={post} />)
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: `${post.title}：本报道暂无封面` })).toHaveTextContent('本报道暂无封面')
  rerender(<ArticleCover post={{ ...post, summary: 'A rerender must not invent a replacement cover.' }} eager />)
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: `${post.title}：本报道暂无封面` })).toBeInTheDocument()
})

it('uses the next report own cover after a previous report cover fails', () => {
  const post = data.daily[8]
  const nextPost = data.daily[10]
  const { container, rerender } = render(<ArticleCover post={post} />)
  fireEvent.error(container.querySelector('img'))
  expect(screen.getByRole('img', { name: `${post.title}：本报道封面暂不可用` })).toBeInTheDocument()
  rerender(<ArticleCover post={nextPost} />)
  expect(container.querySelectorAll('img')).toHaveLength(1)
  expect(container.querySelector('img')).toHaveAttribute('src', nextPost.cover_image)
  expect(container.querySelector('.issue-image-fallback')).not.toBeInTheDocument()
})
