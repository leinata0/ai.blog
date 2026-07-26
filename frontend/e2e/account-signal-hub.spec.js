import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const user = {
  email: 'reader@example.com',
  nickname: 'Signal Reader',
  bio: '关注智能体、推理与开发工具。',
  avatar_url: '',
  email_verified: true,
  password_set: true,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: '2026-07-20T10:00:00Z',
}

const dashboard = {
  counts: { following: 2, history: 3, comments: 1, likes: 2 },
  recent_history: [
    {
      kind: 'history', id: 'history-recent', slug: 'reasoning-systems',
      title: '从推理模型到智能体系统', summary: '从模型能力走向可验证的工作流。',
      content_type: 'post', occurred_at: '2026-07-20T10:00:00Z', available: true,
    },
  ],
  followed_updates: [
    {
      topic_key: 'agents', display_title: '智能体', followed_at: '2026-07-01T10:00:00Z',
      latest_post: { slug: 'agent-runtime', title: '智能体运行时正在成为新的应用层', published_at: '2026-07-21T10:00:00Z' },
    },
    {
      topic_key: 'devtools', display_title: '开发工具', followed_at: '2026-07-02T10:00:00Z',
      latest_post: { slug: 'coding-agents', title: '编码代理的交互边界', published_at: '2026-07-22T10:00:00Z' },
    },
  ],
  security: { email_verified: true, password_set: true, last_login_at: '2026-07-20T10:00:00Z' },
}

const libraryItems = [
  {
    kind: 'history', id: 'h1', slug: 'reasoning-systems', title: '从推理模型到智能体系统',
    summary: '从模型能力走向可验证的工作流。', content_type: 'post',
    occurred_at: '2026-07-20T10:00:00Z', available: true,
  },
  {
    kind: 'likes', id: 'l1', slug: 'small-models', title: '小模型的端侧机会',
    summary: '低时延、低成本与隐私形成的新产品空间。', content_type: 'post',
    occurred_at: '2026-07-19T10:00:00Z', available: true,
  },
  {
    kind: 'comments', id: 'c1', slug: 'offline-post', title: '已经下线的旧文章',
    comment_content: '这条评论仍属于你的数据资产。', content_type: 'post',
    occurred_at: '2026-07-18T10:00:00Z', available: false,
  },
]

async function installApiMocks(page, { dashboardStatus = 200, libraryDelay = 0 } = {}) {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    localStorage.setItem('user_token', `e30.${payload}.test`)
    localStorage.setItem('theme', 'dark')
  })

  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const { pathname, searchParams } = url

    if (pathname === '/api/users/me' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: user })
      return
    }
    if (pathname === '/api/users/me/dashboard') {
      await route.fulfill({ status: dashboardStatus, json: dashboardStatus === 200 ? dashboard : { detail: 'temporary outage' } })
      return
    }
    if (pathname === '/api/users/me/library') {
      if (libraryDelay) await new Promise((resolve) => setTimeout(resolve, libraryDelay))
      const kind = searchParams.get('kind') || 'all'
      const query = (searchParams.get('q') || '').toLowerCase()
      const items = libraryItems.filter((item) => (
        (kind === 'all' || item.kind === kind)
        && (!query || `${item.title} ${item.summary || ''} ${item.comment_content || ''}`.toLowerCase().includes(query))
      ))
      await route.fulfill({ status: 200, json: { kind, items, total: items.length, page: 1, page_size: 20 } })
      return
    }
    if (pathname === '/api/settings') {
      await route.fulfill({ status: 200, json: { site_name: 'Signal Desk' } })
      return
    }
    if (pathname === '/api/stats') {
      await route.fulfill({ status: 200, json: {} })
      return
    }
    await route.fulfill({ status: 200, json: {} })
  })
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page)
})

test('renders the private signal overview responsively', async ({ page }, testInfo) => {
  await page.goto('/account?tab=overview')
  await expect(page.getByRole('heading', { name: 'Signal Reader', level: 1 })).toBeVisible()
  await expect(page.getByText('从推理模型到智能体系统')).toBeVisible()
  await expect(page.locator('#main-content')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'auth')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')

  const viewport = page.viewportSize()
  const navigation = viewport.width <= 1023
    ? page.getByRole('navigation', { name: '个人信号中心导航' })
    : page.getByRole('complementary', { name: '个人信号中心导航' })
  await expect(navigation).toBeVisible()
  const activeTarget = navigation.getByRole('link', { name: /信号总览/ })
  const targetBox = await activeTarget.boundingBox()
  expect(targetBox?.height).toBeGreaterThanOrEqual(44)

  await expect(page).toHaveScreenshot(`account-overview-${testInfo.project.name}.png`, { fullPage: true })
})

test('supports URL search, keyboard commands, focus restore and theme switching', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Full keyboard flow runs once on desktop')
  await page.goto('/account?tab=library&kind=likes')
  await expect(page.getByText('小模型的端侧机会')).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索个人资料库' }).fill('端侧')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/tab=library.*kind=likes.*q=%E7%AB%AF%E4%BE%A7/)

  const trigger = page.getByRole('button', { name: /快速跳转与搜索/ })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '个人中心快速跳转与搜索' })
  await expect(dialog.getByRole('searchbox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.getByRole('button', { name: '切换主题' }).first().click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('keeps a dashboard failure local and passes an automated accessibility scan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'laptop-1024', 'Failure and accessibility audit run once')
  await page.unroute('**://*/api/**')
  await installApiMocks(page, { dashboardStatus: 503 })
  await page.goto('/account?tab=overview')
  await expect(page.getByText('个人信号暂时离线')).toBeVisible()
  await expect(page.getByRole('complementary', { name: '个人信号中心导航' })).toBeVisible()
  await expect(page.getByRole('button', { name: /快速跳转与搜索/ })).toBeVisible()

  const result = await new AxeBuilder({ page })
    .include('#main-content')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([])
})

test('reveals a slow library request and honors reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Slow-network and reduced-motion checks run once on mobile')
  await page.unroute('**://*/api/**')
  await installApiMocks(page, { libraryDelay: 1800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/account?tab=library&kind=all')
  await expect(page.getByRole('status', { name: '正在整理你的个人信号…' })).toBeVisible()
  await expect(page.getByText('从推理模型到智能体系统')).toBeVisible()
  const duration = await page.locator('.account-section-motion').evaluate((element) => getComputedStyle(element).animationDuration)
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001)
})
