import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  followTopicCloud: vi.fn(() => Promise.resolve([])),
  unfollowTopicCloud: vi.fn(() => Promise.resolve([])),
  recordHistoryCloud: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../src/api/user', () => ({
  followTopicCloud: mocks.followTopicCloud,
  unfollowTopicCloud: mocks.unfollowTopicCloud,
  recordHistoryCloud: mocks.recordHistoryCloud,
}))

let toggleFollow
let recordHistory

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  ;({ toggleFollow, recordHistory } = await import('../src/utils/topicSync'))
})

afterEach(() => {
  localStorage.clear()
})

const topic = { topic_key: 'llm', display_title: '大模型' }

describe('topicSync (anonymous → localStorage)', () => {
  it('toggles locally without calling the cloud API', async () => {
    const res = await toggleFollow(null, topic)
    expect(res.followed).toBe(true)
    expect(mocks.followTopicCloud).not.toHaveBeenCalled()
    // persisted to localStorage
    expect(localStorage.getItem('blog.followed_topics')).toContain('llm')
  })

  it('records history locally without cloud', () => {
    recordHistory(null, { slug: 'post-a', title: 'A' })
    expect(mocks.recordHistoryCloud).not.toHaveBeenCalled()
    expect(localStorage.getItem('blog.reading_history')).toContain('post-a')
  })
})

describe('topicSync (logged-in → cloud + local mirror)', () => {
  const user = { id: 1, email: 'u@example.com' }

  it('follows via cloud and mirrors to localStorage', async () => {
    const res = await toggleFollow(user, topic)
    expect(res.followed).toBe(true)
    expect(mocks.followTopicCloud).toHaveBeenCalledWith({ topic_key: 'llm', display_title: '大模型' })
    expect(localStorage.getItem('blog.followed_topics')).toContain('llm')
  })

  it('unfollows via cloud when toggling off', async () => {
    await toggleFollow(user, topic) // on
    await toggleFollow(user, topic) // off
    expect(mocks.unfollowTopicCloud).toHaveBeenCalledWith('llm')
  })

  it('records history via cloud', () => {
    recordHistory(user, { slug: 'post-a', title: 'A', topic_key: 'llm' })
    expect(mocks.recordHistoryCloud).toHaveBeenCalled()
  })
})
