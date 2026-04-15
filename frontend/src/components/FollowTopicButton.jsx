import { useEffect, useState } from 'react'
import { BellPlus, BellRing } from 'lucide-react'

import { isTopicFollowed, toggleFollowedTopic } from '../utils/topicRetention'

export default function FollowTopicButton({ topic, onChange }) {
  const topicKey = String(topic?.topic_key || '').trim()
  const [followed, setFollowed] = useState(() => isTopicFollowed(topicKey))

  useEffect(() => {
    setFollowed(isTopicFollowed(topicKey))
  }, [topicKey])

  if (!topicKey) return null

  function handleClick() {
    const next = toggleFollowedTopic(topic)
    const nextFollowed = next.some((item) => item.topic_key === topicKey)
    setFollowed(nextFollowed)
    onChange?.(next, nextFollowed)
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
