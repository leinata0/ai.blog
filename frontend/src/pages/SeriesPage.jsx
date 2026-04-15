import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Layers3 } from 'lucide-react'

import { fetchSeriesList } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeriesEditorialStack from '../components/SeriesEditorialStack'
import { motionItemVariants } from '../utils/contentPresentation'

export default function SeriesPage() {
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '内容系列 - AI 资讯观察'
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
        >
          <EditorialSectionHeader
            eyebrow="系列总览"
            title="把文章整理成更容易持续阅读的路径"
            description="系列强调的是“如何组织阅读”。它会把日报、周报与专题文章串成长期栏目，帮助你从单篇阅读走向整条内容主线。"
            actionLabel="去发现页继续浏览"
            actionTo="/discover"
            actionIcon={ArrowRight}
          />
        </motion.section>

        <div className="mt-8">
          {loading ? (
            <LoadingSkeletonSet count={2} className="space-y-4" minHeight="22rem" />
          ) : (
            <SeriesEditorialStack
              items={seriesList}
              mode="full"
              emptyText="系列内容正在整理中，稍后这里会出现完整的阅读路径。"
              dataUi="series-page-showcase"
            />
          )}
        </div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
