import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link2 } from 'lucide-react'
import { fetchFriendLinks } from '../api/posts'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

export default function FriendsPage() {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '友链 - 极客开发日志'
    fetchFriendLinks()
      .then((data) => setFriends(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 sm:px-10 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            友情链接
          </h1>
          <p className="text-sm mb-12" style={{ color: 'var(--text-faint)' }}>
            <Link2 size={14} className="inline mr-1" />
            互相学习，共同进步
          </p>
        </motion.div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 rounded-xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>暂无友链</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {friends.map((friend, i) => (
              <motion.a
                key={friend.url || i}
                href={friend.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                whileHover={{ y: -5, boxShadow: '0 8px 30px rgba(73,177,245,0.12), 0 2px 8px rgba(0,0,0,0.06)' }}
                className="rounded-xl p-6 flex flex-col items-center text-center transition-all duration-200"
                style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
              >
                <div className="w-16 h-16 rounded-full overflow-hidden mb-4 bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] flex items-center justify-center">
                  {friend.avatar ? (
                    <img src={proxyImageUrl(friend.avatar)} alt={friend.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-2xl">🌐</span>
                  )}
                </div>
                <h3 className="font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{friend.name}</h3>
                <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{friend.description}</p>
              </motion.a>
            ))}
          </div>
        )}
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
