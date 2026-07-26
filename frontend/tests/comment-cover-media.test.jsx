import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import CommentSection from '../src/components/CommentSection'
import CoverCard from '../src/components/CoverCard'
import { proxyImageUrl } from '../src/utils/proxyImage'

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({ user: null }),
  UserProvider: ({ children }) => children,
}))

vi.mock('../src/api/posts', () => ({
  fetchComments: vi.fn(() => Promise.resolve([
    {
      id: 1,
      nickname: '路人甲',
      content: '写得不错',
      created_at: '2026-04-14T08:00:00Z',
      avatar_url: 'https://avatars.example.com/a.png',
      is_registered: true,
    },
  ])),
  postComment: vi.fn(() => Promise.resolve({})),
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

it('routes user-controlled comment avatars through the image proxy', async () => {
  render(<MemoryRouter><CommentSection slug="a-post" /></MemoryRouter>)

  const avatar = await waitFor(() => {
    const found = document.querySelector('.comment-card img')
    expect(found).not.toBeNull()
    return found
  })

  // avatar_url is arbitrary user input: it must not become a direct cross-site load.
  expect(avatar).toHaveAttribute('src', proxyImageUrl('https://avatars.example.com/a.png'))
  expect(avatar.getAttribute('src')).not.toBe('https://avatars.example.com/a.png')
  expect(avatar).toHaveAttribute('loading', 'lazy')
  expect(avatar).toHaveAttribute('referrerpolicy', 'no-referrer')
})

it('drops a broken comment avatar instead of leaving a broken image box', async () => {
  render(<MemoryRouter><CommentSection slug="a-post" /></MemoryRouter>)

  const avatar = await waitFor(() => {
    const found = document.querySelector('.comment-card img')
    expect(found).not.toBeNull()
    return found
  })

  fireEvent.error(avatar)
  await waitFor(() => {
    expect(document.querySelector('.comment-card img')).toBeNull()
  })
  expect(screen.getByText('路人甲')).toBeInTheDocument()
})

it('gives the comment form fields accessible names, not just placeholders', async () => {
  render(<MemoryRouter><CommentSection slug="a-post" /></MemoryRouter>)

  expect(screen.getByLabelText('你的昵称')).toBeInTheDocument()
  expect(screen.getByLabelText('评论内容')).toBeInTheDocument()
})

it('falls back to the placeholder media when a cover image fails to load', () => {
  const { container } = render(
    <MemoryRouter>
      <CoverCard title="封面文章" image="https://img.563118077.xyz/covers/a.png" imageAlt="封面" />
    </MemoryRouter>,
  )

  const cover = container.querySelector('.cover-card__media img')
  expect(cover).not.toBeNull()
  expect(container.querySelector('.cover-card__media--placeholder')).toBeNull()

  fireEvent.error(cover)

  expect(container.querySelector('.cover-card__media img')).toBeNull()
  expect(container.querySelector('.cover-card__media--placeholder')).not.toBeNull()
  expect(screen.getByText('封面文章')).toBeInTheDocument()
})
