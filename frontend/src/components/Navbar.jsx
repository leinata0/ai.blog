import { Link } from 'react-router-dom'

function NavLink({ to, href, active, children }) {
  const cls = 'relative font-medium transition-colors duration-200 pb-1 group'
  const style = { color: active ? 'var(--accent)' : 'var(--text-secondary)' }
  const underline = (
    <span
      className="absolute left-0 bottom-0 h-[2px] w-0 group-hover:w-full transition-all duration-300"
      style={{ backgroundColor: 'var(--accent)' }}
    />
  )
  if (to) {
    return <Link to={to} className={cls} style={style}>{children}{underline}</Link>
  }
  return <a href={href} className={cls} style={style}>{children}{underline}</a>
}

export default function Navbar() {
  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10 lg:px-20 transition-all duration-300"
      style={{
        height: '60px',
        backgroundColor: 'rgba(255, 255, 255, 0.87)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }}
    >
      <Link to="/" className="text-xl font-semibold transition-colors duration-200" style={{ color: 'var(--accent)' }}>
        极客开发日志
      </Link>

      <div className="flex items-center gap-8 text-[15px]">
        <NavLink to="/" active>首页</NavLink>
        <NavLink href="#">归档</NavLink>
        <NavLink href="#">分类</NavLink>
        <NavLink href="#">标签</NavLink>
        <NavLink href="#">留言板</NavLink>
      </div>
    </nav>
  )
}
