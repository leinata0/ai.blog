import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Layers3 } from 'lucide-react'

import { fetchSeriesList } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import SeriesEditorialStack from '../components/SeriesEditorialStack'
import { motionItemVariants } from '../utils/contentPresentation'

export default function SeriesPage() {
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '内容系列'
    fetchSeriesList()
      .then(setSeriesList)
      .catch(() => setSeriesList([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}>
            <Layers3 size={12} />
            系列总览
          </div>
          <h1 className="mt-4 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            把文章整理成更容易持续阅读的路径
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            系列强调的是“如何组织阅读”。它会把日报、周报与专题文章串成长期栏目，帮助你从单篇阅读转向整条内容主线。
          </p>
        </motion.section>

        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            选中一张主卡后，其余系列会像编辑卡组一样叠在后方，便于快速切换阅读路径。
          </p>
          <Link to="/discover" className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: '#2563eb' }}>
            去发现页继续浏览
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((item) => (
                <div key={item} className="h-56 rounded-[2rem] skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
              ))}
            </div>
          ) : (
            <SeriesEditorialStack
              items={seriesList}
              mode="full"
              emptyText="系列内容正在整理中，稍后这里会出现完整的阅读路径。"
            />
          )}
        </div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
