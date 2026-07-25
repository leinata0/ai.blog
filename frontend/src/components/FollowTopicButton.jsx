import { useEffect, useState } from 'react'
import { BellPlus, BellRing } from 'lucide-react'

import { isFollowed as isTopicFollowed, toggleFollow } from '../utils/topicSync'
import { useUser } from '../contexts/UserContext'

export default function FollowTopicButton({ topic, onChange }) {
  const topicKey = String(topic?.topic_key || '').trim()
  const { user } = useUser()
  const [followed, setFollowed] = useState(() => isTopicFollowed(topicKey))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setFollowed(isTopicFollowed(topicKey))
  }, [topicKey])

  if (!topicKey) return null

  async function handleClick() {
    if (pending) return
    setPending(true)
    setMessage('')
    try {
      const { topics, followed: nextFollowed } = await toggleFollow(user, topic)
      setFollowed(nextFollowed)
      setMessage(nextFollowed ? '已关注这个主题。' : '已取消关注这个主题。')
      onChange?.(topics, nextFollowed)
    } catch {
      setMessage('关注状态未保存，请检查网络后重试。')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="signal-button signal-button--ghost"
        style={{
          backgroundColor: followed ? 'var(--signal-violet-soft)' : 'var(--accent-soft)',
          color: followed ? 'var(--signal-violet)' : 'var(--accent)',
        }}
        aria-pressed={followed}
      >
        {followed ? <BellRing size={15} aria-hidden="true" /> : <BellPlus size={15} aria-hidden="true" />}
        {pending ? '正在同步…' : followed ? '已关注主题' : '关注主题'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </span>
  )
}
