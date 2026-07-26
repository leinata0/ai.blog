import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SeoMeta from '../components/SeoMeta'
import { SITE_COPY } from '../utils/contentPresentation'

export default function NotFoundPage() {
  const location = useLocation()

  return (
    <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Without SeoMeta this page inherits the canonical / og:image of whatever article
          the visitor arrived from, and the SPA catch-all serves it under any unknown URL. */}
      <SeoMeta
        title={`404 页面未找到 - ${SITE_COPY.brand}`}
        description="你访问的页面不存在或已被移除，可以从首页重新进入 AI 日报、周报与主题追踪。"
        path={location.pathname}
        noindex
      />
      <Navbar />
      <div className="flex-1 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h1 className="text-8xl font-bold mb-4" style={{ color: 'var(--accent)' }}>404</h1>
          <p className="text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>页面未找到</p>
          <p className="text-sm mb-8" style={{ color: 'var(--text-tertiary)' }}>你访问的页面不存在或已被移除</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            返回首页
          </Link>
        </motion.div>
      </div>
      <Footer />
    </main>
  )
}
