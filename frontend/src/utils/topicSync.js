/**
 * Adapter over follow/history tracking.
 *
 * Anonymous visitors keep using the pure-localStorage functions in
 * topicRetention.js (zero behavior change). Logged-in users go through the
 * cloud API and also mirror into localStorage as an offline cache. Pass the
 * current `user` (from UserContext) into each call to pick the path.
 */
import {
  followTopicCloud,
  unfollowTopicCloud,
  recordHistoryCloud,
} from '../api/user'
import {
  getFollowedTopics as localGetFollowedTopics,
  isTopicFollowed as localIsTopicFollowed,
  toggleFollowedTopic as localToggleFollowedTopic,
  recordReadingHistory as localRecordReadingHistory,
} from './topicRetention'

/**
 * Toggle a topic follow. Always updates localStorage so the UI stays responsive
 * and offline-friendly; when logged in, also syncs the change to the cloud.
 * Returns the new local list and whether the topic is now followed.
 */
export async function toggleFollow(user, topic) {
  const topicKey = String(topic?.topic_key || '').trim()
  const wasFollowed = localIsTopicFollowed(topicKey)
  const next = localToggleFollowedTopic(topic)
  const nowFollowed = next.some((item) => item.topic_key === topicKey)

  if (user && wasFollowed !== nowFollowed) {
    try {
      if (nowFollowed) {
        await followTopicCloud({ topic_key: topicKey, display_title: topic?.display_title || topic?.title || '' })
      } else {
        await unfollowTopicCloud(topicKey)
      }
    } catch {
      // Non-fatal: local state is the source of truth for the current session;
      // a later login merge or manual retry reconciles the cloud.
    }
  }
  return { topics: next, followed: nowFollowed }
}

/**
 * Record a reading-history visit. Mirrors to localStorage; syncs to cloud when
 * logged in. Best-effort — never throws into the caller's render path.
 */
export function recordHistory(user, post) {
  const local = localRecordReadingHistory(post)
  if (user) {
    recordHistoryCloud({
      slug: post?.slug,
      title: post?.title || '',
      topic_key: post?.topic_key || '',
      topic_display_title: post?.topic_display_title || post?.display_title || '',
      content_type: post?.content_type || '',
      coverage_date: post?.coverage_date || '',
    }).catch(() => {})
  }
  return local
}

export function getFollowed() {
  return localGetFollowedTopics()
}

export function isFollowed(topicKey) {
  return localIsTopicFollowed(topicKey)
}
