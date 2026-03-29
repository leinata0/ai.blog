export default function Navbar() {
  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-20 transition-all duration-300"
      style={{
        height: '60px',
        backgroundColor: 'rgba(255, 255, 255, 0.87)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }}
    >
      <a href="/" className="text-xl font-semibold transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: '#49B1F5' }}>
        极客开发日志
      </a>

      <div className="flex items-center gap-8 text-[15px]">
        <a href="/" className="font-medium transition-colors duration-200" style={{ color: '#49B1F5' }}>首页</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: '#4C4948' }}>归档</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: '#4C4948' }}>分类</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: '#4C4948' }}>标签</a>
        <a href="#" className="transition-colors duration-200 hover:text-[#49B1F5]" style={{ color: '#4C4948' }}>留言板</a>
      </div>
    </nav>
  )
}
