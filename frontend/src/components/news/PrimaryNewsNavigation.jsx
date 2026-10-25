import { Link, useLocation } from 'react-router-dom'
import { NEWS_NAV_ITEMS, isNewsNavActive } from '../../utils/newsNavigation'
import { preloadNewsRoute } from '../../utils/newsRouteLoaders'

export default function PrimaryNewsNavigation({ className }) {
  const { pathname } = useLocation()
  return <nav className={className} aria-label="主导航">{NEWS_NAV_ITEMS.map((item) => <Link key={item.to} to={item.to} onPointerEnter={(event) => { if (event.pointerType === 'mouse') preloadNewsRoute(item.to) }} onFocus={() => preloadNewsRoute(item.to)} aria-current={isNewsNavActive(pathname, item.to) ? 'page' : undefined}>{item.label}</Link>)}</nav>
}
