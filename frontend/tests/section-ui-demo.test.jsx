import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SectionUiDemo from '../src/demos/section-ui/SectionUiDemo'
import data from '../src/demos/section-ui/demoContent.json'

vi.mock('../src/components/SeoMeta', () => ({ default: () => null }))

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const postHref = (post) => `/posts/${encodeURIComponent(post.slug)}`

beforeEach(() => {
  // JSDOM has a dialog element but no native dialog methods. Preserve its real
  // open attribute and close event instead of replacing the preview component.
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

it('shows an honest empty daily search and restores all real sample reports', async () => {
  const user = userEvent.setup()
  renderDemo()
  await user.type(screen.getByRole('textbox', { name: '筛选日报样本' }), '__section_demo_no_match_9f3b__')
  expect(screen.getByRole('status')).toHaveTextContent('找到 0 篇报道')
  expect(screen.getByRole('heading', { name: '这组样本里还没有这条线索' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '日报重点报道' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(screen.getByRole('textbox', { name: '筛选日报样本' })).toHaveValue('')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  for (const post of data.daily) {
    expect(within(screen.getByRole('main')).getByRole('link', { name: post.title, exact: true })).toHaveAttribute('href', postHref(post))
  }
})

it('filters daily reports by their actual publication date and resets the selection', async () => {
  const user = userEvent.setup()
  renderDemo()
  const counts = new Map()
  data.daily.forEach((post) => {
    const day = post.created_at.slice(0, 10)
    counts.set(day, (counts.get(day) || 0) + 1)
  })
  const day = [...counts].find(([, count]) => count > 1)[0]
  const matches = data.daily.filter((post) => post.created_at.startsWith(day))
  await user.selectOptions(screen.getByRole('combobox', { name: '按发布日期筛选' }), day)
  expect(screen.getByRole('status')).toHaveTextContent(`找到 ${matches.length} 篇报道`)
  const main = screen.getByRole('main')
  for (const post of data.daily) {
    const title = within(main).queryByRole('link', { name: post.title, exact: true })
    if (post.created_at.startsWith(day)) expect(title).toHaveAttribute('href', postHref(post))
    else expect(title).not.toBeInTheDocument()
  }
  const times = [...main.querySelectorAll('time')]
  expect(times).toHaveLength(matches.length)
  expect(times.every((time) => time.dateTime.startsWith(day))).toBe(true)

  await user.click(screen.getByRole('button', { name: /查看全部样本/ }))
  expect(screen.getByRole('combobox', { name: '按发布日期筛选' })).toHaveValue('all')
  expect(screen.getByRole('link', { name: data.daily[0].title, exact: true })).toHaveAttribute('href', postHref(data.daily[0]))
})

it('opens the native article dialog with its real reading link and closes through both controls', async () => {
  const user = userEvent.setup()
  renderDemo()
  const post = data.daily[0]
  await user.click(screen.getByRole('button', { name: /快速预览/ }))
  let dialog = screen.getByRole('dialog', { name: post.title })
  expect(dialog).toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
  expect(within(dialog).getByRole('link', { name: /打开完整报道/ })).toHaveAttribute('href', postHref(post))
  expect(dialog.querySelector('time')).toHaveAttribute('datetime', post.created_at)
  expect(dialog).toHaveTextContent(post.summary)
  await user.click(within(dialog).getByRole('button', { name: '关闭文章预览' }))
  expect(dialog).not.toBeInTheDocument()
  expect(dialog).not.toHaveAttribute('open')
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: /快速预览/ }))
  dialog = screen.getByRole('dialog', { name: post.title })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('link', { name: post.title, exact: true })).toHaveAttribute('href', postHref(post))
})

it('navigates all five demo sections to matching content and preserves real comparison destinations', async () => {
  const user = userEvent.setup()
  renderDemo()
  const sections = [
    { view: 'daily', label: '日报', content: data.daily[0].title, destination: postHref(data.daily[0]) },
    { view: 'weekly', label: '周报', content: data.weekly[0].title, destination: postHref(data.weekly[0]) },
    { view: 'topics', label: '主题', content: data.topics[0].display_title, destination: `/topics/${encodeURIComponent(data.topics[0].topic_key)}` },
    { view: 'series', label: '系列', content: data.series[0].description, destination: `/series/${encodeURIComponent(data.series[0].slug)}` },
    { view: 'start-here', label: '开始阅读', content: '阅读', destination: '/demo/sections/daily' },
  ]
  for (const section of sections) {
    const link = within(screen.getByRole('navigation', { name: 'Demo 主导航' })).getByRole('link', { name: section.label, exact: true })
    expect(link).toHaveAttribute('href', `/demo/sections/${section.view}`)
    await user.click(link)
    expect(link).toHaveAttribute('aria-current', 'page')
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(main).toHaveTextContent(section.content)
    expect(main.querySelector(`a[href="${section.destination}"]`)).not.toBeNull()
    expect(screen.getByRole('link', { name: /对照当前版本/ })).toHaveAttribute('href', `/${section.view}`)
  }
})

it('keeps the existing homepage reachable and closes the mobile section menu on navigation or Escape', async () => {
  const user = userEvent.setup()
  renderDemo('/demo/sections/weekly')
  expect(screen.getByRole('link', { name: 'AI 资讯观察首页' })).toHaveAttribute('href', '/')
  expect(within(screen.getByRole('navigation', { name: 'Demo 主导航' })).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: /对照当前版本/ })).toHaveAttribute('href', '/weekly')
  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  const menu = screen.getByRole('navigation', { name: 'Demo 手机导航' })
  expect(within(menu).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
  await user.click(within(menu).getByRole('link', { name: '主题', exact: true }))
  expect(screen.queryByRole('navigation', { name: 'Demo 手机导航' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /对照当前版本/ })).toHaveAttribute('href', '/topics')

  await user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Demo 手机导航' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开栏目菜单' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: 'AI 资讯观察首页' })).toHaveAttribute('href', '/')
})
