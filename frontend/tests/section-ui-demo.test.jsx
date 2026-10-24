import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SectionUiDemo from '../src/demos/section-ui/SectionUiDemo'
import data from '../src/demos/section-ui/demoContent.json'

vi.mock('../src/components/SeoMeta', () => ({ default: () => null }))
vi.mock('../src/demos/section-ui/GallerySculpture', () => ({
  default: ({ paused, mode }) => <div data-testid="gallery-sculpture" data-paused={String(paused)} data-mode={mode} />,
}))

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const postHref = (post) => `/posts/${encodeURIComponent(post.slug)}`

beforeEach(() => {
  // JSDOM has a dialog element but no native dialog methods. Preserve its real
  // open attribute and close event rather than replacing the detail component.
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
})

afterEach(() => {
  cleanup()
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal)
  else delete HTMLDialogElement.prototype.showModal
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  else delete HTMLDialogElement.prototype.close
})

function renderDemo(path = '/demo/sections/daily') {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/demo/sections/:view?" element={<SectionUiDemo />} /></Routes>
  </MemoryRouter>)
}

async function expectDisplayedPost(post, index) {
  // Keep real AnimatePresence behavior. A completed interaction must put the
  // same report on the cover, title, publication date and visible counter.
  const stage = screen.getByRole('region', { name: '日报交互展台' })
  await waitFor(() => {
    const cover = within(stage).getByRole('button', { name: `查看线索：${post.title}` })
    expect(within(stage).getByRole('heading', { name: post.title, exact: true })).toBeInTheDocument()
    expect(cover.querySelector('img')).toHaveAttribute('src', post.cover_image)
    expect(cover.querySelector('.gx-board-top')).toHaveTextContent(`${String(index + 1).padStart(2, '0')} ↗`)
    expect(stage.querySelector('.gx-pagination strong')).toHaveTextContent(String(index + 1).padStart(2, '0'))
    expect(stage.querySelector('time')).toHaveAttribute('datetime', post.created_at)
  })
}

it('keeps a report cover, title, date and order together when moving forward and backward', async () => {
  const user = userEvent.setup()
  renderDemo()
  await expectDisplayedPost(data.daily[0], 0)
  await user.click(screen.getByRole('button', { name: '下一条线索' }))
  await expectDisplayedPost(data.daily[1], 1)
  await user.click(screen.getByRole('button', { name: '上一条线索' }))
  await expectDisplayedPost(data.daily[0], 0)
})

it('wraps from the first report to the last and back without mixing their covers', async () => {
  const user = userEvent.setup()
  renderDemo()
  await user.click(screen.getByRole('button', { name: '上一条线索' }))
  await expectDisplayedPost(data.daily.at(-1), data.daily.length - 1)
  await user.click(screen.getByRole('button', { name: '下一条线索' }))
  await expectDisplayedPost(data.daily[0], 0)
})

it('pauses and resumes the scene while keeping news navigation usable', async () => {
  const user = userEvent.setup()
  renderDemo()
  await user.click(screen.getByRole('button', { name: '暂停场景动态' }))
  expect(screen.getByRole('button', { name: '继续场景动态' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('gallery-sculpture')).toHaveAttribute('data-paused', 'true')
  expect(screen.getByRole('region', { name: '日报交互展台' })).toHaveClass('gx-stage--paused')
  await user.click(screen.getByRole('button', { name: '下一条线索' }))
  await expectDisplayedPost(data.daily[1], 1)
  await user.click(screen.getByRole('button', { name: '继续场景动态' }))
  expect(screen.getByRole('button', { name: '暂停场景动态' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByTestId('gallery-sculpture')).toHaveAttribute('data-paused', 'false')
  expect(screen.getByRole('region', { name: '日报交互展台' })).not.toHaveClass('gx-stage--paused')
})

it('opens the selected real report in a native dialog and closes through the button or cancellation', async () => {
  const user = userEvent.setup()
  renderDemo()
  await user.click(screen.getByRole('button', { name: '下一条线索' }))
  const post = data.daily[1]
  await expectDisplayedPost(post, 1)
  await user.click(screen.getByRole('button', { name: `查看线索：${post.title}` }))
  let dialog = screen.getByRole('dialog', { name: post.title })
  expect(dialog).toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
  expect(within(dialog).getByRole('link', { name: /打开完整内容/ })).toHaveAttribute('href', postHref(post))
  expect(dialog.querySelector('img')).toHaveAttribute('src', post.cover_image)
  expect(dialog.querySelector('time')).toHaveAttribute('datetime', post.created_at)
  expect(dialog).toHaveTextContent(post.summary)
  await user.click(within(dialog).getByRole('button', { name: '关闭线索详情' }))
  expect(dialog).not.toBeInTheDocument()
  expect(dialog).not.toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: /展开线索/ }))
  dialog = screen.getByRole('dialog', { name: post.title })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(2)
  await expectDisplayedPost(post, 1)
})

it('shows an honest empty archive search and restores every real report without changing the exhibit', async () => {
  const user = userEvent.setup()
  renderDemo()
  const search = screen.getByRole('searchbox', { name: '搜索新闻档案' })
  await user.type(search, '__gallery_archive_no_match_9f3b__')
  expect(screen.getByRole('status')).toHaveTextContent('找到 0 条相关报道')
  expect(screen.getByRole('heading', { name: '还没有找到这条线索。' })).toBeInTheDocument()
  expect(screen.queryAllByRole('button', { name: /^在展台查看：/ })).toHaveLength(0)
  await expectDisplayedPost(data.daily[0], 0)

  await user.click(screen.getByRole('button', { name: /清除搜索/ }))
  expect(search).toHaveValue('')
  expect(screen.queryByRole('heading', { name: '还没有找到这条线索。' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('选择一条报道，在上方展台查看。')
  expect(screen.getAllByRole('button', { name: /^在展台查看：/ })).toHaveLength(data.daily.length)
  for (const post of data.daily) {
    expect(screen.getByRole('button', { name: `在展台查看：${post.title}`, exact: true })).toBeInTheDocument()
  }
  await expectDisplayedPost(data.daily[0], 0)
})

it('navigates all five gallery rooms with matching content and comparison destinations', async () => {
  const user = userEvent.setup()
  renderDemo()
  const rooms = [
    { view: 'daily', label: '日报', title: data.daily[0].title },
    { view: 'weekly', label: '周报', title: data.weekly[0].title },
    { view: 'topics', label: '主题', title: data.topics[0].display_title },
    { view: 'series', label: '系列' },
    { view: 'start-here', label: '开始阅读', title: '跟上新变化' },
  ]
  for (const room of rooms) {
    const nav = within(screen.getByRole('navigation', { name: 'Demo 主导航' }))
    const link = nav.getByRole('link', { name: new RegExp(`${room.label}$`) })
    expect(link).toHaveAttribute('href', `/demo/sections/${room.view}`)
    await user.click(link)
    expect(link).toHaveAttribute('aria-current', 'page')
    const stage = screen.getByRole('region', { name: `${room.label}交互展台` })
    expect(within(stage).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    if (room.title) expect(within(stage).getByRole('heading', { name: room.title, exact: true })).toBeInTheDocument()
    expect(screen.getByTestId('gallery-sculpture')).toHaveAttribute('data-mode', room.view)
    expect(screen.getByRole('link', { name: /对照当前版本/ })).toHaveAttribute('href', `/${room.view}`)
  }
})

it('preserves homepage links and closes the mobile menu after navigation or Escape', async () => {
  const user = userEvent.setup()
  renderDemo('/demo/sections/weekly')
  expect(screen.getByRole('link', { name: 'AI 资讯观察首页' })).toHaveAttribute('href', '/')
  expect(within(screen.getByRole('navigation', { name: 'Demo 主导航' })).getByRole('link', { name: /首页/ })).toHaveAttribute('href', '/')
  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  const menu = screen.getByRole('navigation', { name: 'Demo 手机导航' })
  expect(within(menu).getByRole('link', { name: /首页/ })).toHaveAttribute('href', '/')
  await user.click(within(menu).getByRole('link', { name: /主题$/ }))
  expect(screen.queryByRole('navigation', { name: 'Demo 手机导航' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: '主题交互展台' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /对照当前版本/ })).toHaveAttribute('href', '/topics')
  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Demo 手机导航' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开栏目菜单' })).toHaveAttribute('aria-expanded', 'false')
})
