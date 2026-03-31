import { Link } from 'react-router-dom'

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
        <Link to="/" className="font-medium transition-colors duration-200" style={{ color: 'var(--accent)' }}>首页</Link>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: 'var(--text-secondary)' }}>归档</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: 'var(--text-secondary)' }}>分类</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: 'var(--text-secondary)' }}>标签</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: 'var(--text-secondary)' }}>留言板</a>
      </div>
    </nav>
  )
}
