export const NEWS_NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '日报', to: '/daily' },
  { label: '周报', to: '/weekly' },
  { label: '主题', to: '/topics' },
  { label: '系列', to: '/series' },
  { label: '开始阅读', to: '/start-here' },
]

export function isNewsNavActive(pathname, to) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
}
