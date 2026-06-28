import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import ContinueReadingSection from '../components/ContinueReadingSection'
import RecentTopicsSection from '../components/RecentTopicsSection'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'
import { fetchCloudTopics, fetchCloudHistory } from '../api/user'
import { useUser } from '../contexts/UserContext'
import { motionContainerVariants, motionItemVariants } from '../utils/contentPresentation'

export default function FollowingPage() {
  const { user } = useUser()
  const [followedTopics, setFollowedTopics] = useState([])
  const [recentTopics, setRecentTopics] = useState([])
  const [historyItems, setHistoryItems] = useState([])

  useEffect(() => {
    document.title = '关注主题 - 极客开发日志'
  }, [])

  useEffect(() => {
    if (user) {
      // Logged in: read the cloud-synced data (cross-device).
      fetchCloudTopics().then(setFollowedTopics).catch(() => setFollowedTopics(getFollowedTopics()))
      fetchCloudHistory()
        .then((items) => {
          setHistoryItems(items)
          // derive recent topics from history order
          const seen = new Set()
          const topics = []
          for (const item of items) {
            if (!item.topic_key || seen.has(item.topic_key)) continue
            seen.add(item.topic_key)
            topics.push({
              topic_key: item.topic_key,
              display_title: item.topic_display_title || item.topic_key,
              latest_post_at: item.visited_at,
            })
          }
          setRecentTopics(topics.slice(0, 6))
        })
        .catch(() => {
          setHistoryItems(getContinueReadingItems())
          setRecentTopics(getRecentTopics())
        })
    } else {
      // Anonymous: browser-local data.
      setFollowedTopics(getFollowedTopics())
      setRecentTopics(getRecentTopics())
      setHistoryItems(getContinueReadingItems())
    }
  }, [user])

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
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>关注与继续阅读</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            {user
              ? '这里保存你关注过的主题和最近阅读过的文章，已同步到云端，登录后在任意设备都能看到。'
              : '这里保存你在当前浏览器里关注过的主题和最近阅读过的文章，不需要登录。登录后可同步到云端、跨设备可见。'}
          </p>
        </motion.section>

        <motion.section initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-8 grid gap-6 lg:grid-cols-2">
          <motion.div variants={motionItemVariants}>
            <RecentTopicsSection
              items={followedTopics}
              title="已关注主题"
              emptyText="当你在文章页或主题页关注主题后，这里会形成追踪入口。"
            />
          </motion.div>
          <motion.div variants={motionItemVariants}>
            <RecentTopicsSection
              items={recentTopics}
              title="最近浏览主题"
              emptyText="读过带 topic_key 的文章后，会在这里自动沉淀最近主题。"
            />
          </motion.div>
        </motion.section>

        <motion.section initial="hidden" animate="visible" variants={motionItemVariants} className="mt-8">
          <ContinueReadingSection items={historyItems} />
        </motion.section>

        {followedTopics.length > 0 ? (
          <motion.section
            initial="hidden"
            animate="visible"
            variants={motionContainerVariants}
            className="mt-8 rounded-3xl px-6 py-6"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <motion.h2 variants={motionItemVariants} className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              快速进入主题页
            </motion.h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {followedTopics.map((topic) => (
                <motion.div key={topic.topic_key} variants={motionItemVariants}>
                  <Link
                    to={`/topics/${topic.topic_key}`}
                    className="block rounded-2xl border border-transparent px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                  >
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {topic.display_title || topic.topic_key}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                      关注于 {new Date(topic.followed_at).toLocaleDateString('zh-CN')}
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.section>
        ) : null}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
