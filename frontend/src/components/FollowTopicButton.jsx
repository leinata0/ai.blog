import { useEffect, useState } from 'react'
import { BellPlus, BellRing } from 'lucide-react'

import { isFollowed as isTopicFollowed, toggleFollow } from '../utils/topicSync'
import { useUser } from '../contexts/UserContext'

export default function FollowTopicButton({ topic, onChange }) {
  const topicKey = String(topic?.topic_key || '').trim()
  const { user } = useUser()
  const [followed, setFollowed] = useState(() => isTopicFollowed(topicKey))

  useEffect(() => {
    setFollowed(isTopicFollowed(topicKey))
  }, [topicKey])

  if (!topicKey) return null

  async function handleClick() {
    const { topics, followed: nextFollowed } = await toggleFollow(user, topic)
    setFollowed(nextFollowed)
    onChange?.(topics, nextFollowed)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: followed ? 'rgba(37, 99, 235, 0.12)' : 'var(--accent-soft)',
        color: followed ? '#2563eb' : 'var(--accent)',
      }}
    >
      {followed ? <BellRing size={15} /> : <BellPlus size={15} />}
      {followed ? '已关注主题' : '关注主题'}
    </button>
  )
}
