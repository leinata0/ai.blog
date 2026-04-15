import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Compass, Flame, Sparkles } from 'lucide-react'

import { fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { formatDate } from '../utils/date'
import {
  getTopicBadgeLabel,
  getTopicDescription,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'
import { proxyImageUrl } from '../utils/proxyImage'

export default function TopicsPage() {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '主题追踪'
    fetchTopics({ limit: 24 })
      .then((payload) => setTopics(Array.isArray(payload?.items) ? payload.items : []))
      .catch(() => setTopics([]))
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
          className="editorial-panel rounded-3xl px-8 py-8"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
            <Compass size={16} />
            主题总览
          </div>
          <h1 className="mt-3 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            用主题，把分散消息串成长期主线
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            这里聚合的是“内容在讲什么”。日报、周报和系列里的相关文章会沿着同一条主题继续沉淀，帮助你更快看清某家公司、模型或产品方向的持续变化。
          </p>
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {loading ? (
            [1, 2, 3, 4, 5, 6].map((item) => (
              <motion.div
                key={item}
                variants={motionItemVariants}
                className="h-72 rounded-3xl skeleton-pulse"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              />
            ))
          ) : topics.length > 0 ? (
            topics.map((topic) => (
              <motion.article
                key={topic.topic_key}
                variants={motionItemVariants}
                whileHover={hoverLift}
                className="editorial-card overflow-hidden rounded-3xl border"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-muted)',
                  boxShadow: 'var(--card-shadow)',
                }}
              >
                <Link to={`/topics/${topic.topic_key}`} className="block">
                  {topic.cover_image ? (
                    <div className="editorial-cover h-44 overflow-hidden">
                      <img
                        src={proxyImageUrl(topic.cover_image)}
                        alt={getTopicTitle(topic)}
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : null}
                  <div className="px-6 py-6">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                        style={{
                          backgroundColor: topic.is_featured ? 'rgba(37, 99, 235, 0.12)' : 'var(--accent-soft)',
                          color: topic.is_featured ? '#2563eb' : 'var(--accent)',
                        }}
                      >
                        {topic.is_featured ? <Sparkles size={12} /> : <Flame size={12} />}
                        {getTopicBadgeLabel(topic)}
                      </span>
                      {topic.avg_quality_score ? (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          平均分 {topic.avg_quality_score}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-4 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {getTopicTitle(topic)}
                    </h2>
                    <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                      {getTopicDescription(topic)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                      {topic.post_count ? <span>{topic.post_count} 篇文章</span> : null}
                      {topic.source_count ? <span>{topic.source_count} 个来源</span> : null}
                      {topic.latest_post_at ? <span>最近更新于 {formatDate(topic.latest_post_at)}</span> : null}
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))
          ) : (
            <motion.div
              variants={motionItemVariants}
              className="rounded-3xl px-6 py-10 md:col-span-2 xl:col-span-3"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-faint)' }}
            >
              当前还没有可展示的主题。等带有 `topic_key` 的文章发布后，这里会自动汇总主题入口。
            </motion.div>
          )}
        </motion.section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
