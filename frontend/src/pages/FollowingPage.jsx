import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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

export default function FollowingPage() {
  const [followedTopics, setFollowedTopics] = useState([])
  const [recentTopics, setRecentTopics] = useState([])
  const [historyItems, setHistoryItems] = useState([])

  useEffect(() => {
    document.title = '关注主题 - 极客开发日志'
    setFollowedTopics(getFollowedTopics())
    setRecentTopics(getRecentTopics())
    setHistoryItems(getContinueReadingItems())
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <section
          className="rounded-3xl px-8 py-8"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>关注与继续阅读</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            这里保存你本机关注过的主题和最近阅读过的文章，不需要登录，也不会影响现有自动发文流程。
          </p>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <RecentTopicsSection
            items={followedTopics}
            title="已关注主题"
            emptyText="当你在文章页或主题页关注主题后，会在这里形成追踪入口。"
          />
          <RecentTopicsSection
            items={recentTopics}
            title="最近浏览主题"
            emptyText="读过带 topic_key 的文章后，会在这里自动沉淀最近主题。"
          />
        </section>

        <section className="mt-8">
          <ContinueReadingSection items={historyItems} />
        </section>

        {followedTopics.length > 0 ? (
          <section
            className="mt-8 rounded-3xl px-6 py-6"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>快速进入主题页</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {followedTopics.map((topic) => (
                <Link
                  key={topic.topic_key}
                  to={`/topics/${topic.topic_key}`}
                  className="rounded-2xl px-4 py-4 transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
                >
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {topic.display_title || topic.topic_key}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                    关注于 {new Date(topic.followed_at).toLocaleDateString('zh-CN')}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
