import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Send } from 'lucide-react'
import { fetchComments, postComment } from '../api/posts'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const d = new Date(dateStr)
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

export default function CommentSection({ slug }) {
  const [comments, setComments] = useState([])
  const [nickname, setNickname] = useState(() => localStorage.getItem('comment_nickname') || '')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (slug) {
      fetchComments(slug).then(setComments).catch(() => {})
    }
  }, [slug])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!nickname.trim() || !content.trim()) return
    setSubmitting(true)
    setError('')
    try {
      localStorage.setItem('comment_nickname', nickname.trim())
      const newComment = await postComment(slug, nickname.trim(), content.trim())
      setComments((prev) => [newComment, ...prev])
      setContent('')
    } catch {
      setError('评论提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="mt-10">
      <h3 className="flex items-center gap-2 text-xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
        <MessageCircle size={20} />
        评论 ({comments.length})
      </h3>

      {/* 评论表单 */}
      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        <div className="flex gap-4">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="flex-shrink-0 w-40 px-4 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
            placeholder="你的昵称"
            maxLength={50}
            required
          />
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
            placeholder="说点什么..."
            maxLength={500}
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 flex-shrink-0"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            <Send size={14} />
            {submitting ? '提交中...' : '发送'}
          </button>
        </div>
        {error && (
          <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
        )}
      </form>

      {/* 评论列表 */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--text-faint)' }}>
            暂无评论，来做第一个留言的人吧
          </p>
        ) : (
          comments.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="comment-card"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                  {c.nickname}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {timeAgo(c.created_at)}
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {c.content}
              </p>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
