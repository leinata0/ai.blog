import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import HomePage from '../src/pages/HomePage'

vi.mock('../src/api/posts', () => ({
  fetchPosts: vi.fn((tag) => {
    const allPosts = [
      {
        title: 'Hello React',
        slug: 'hello-react',
        summary: 'A post about React',
        tags: [{ name: 'React', slug: 'react' }],
      },
      {
        title: 'FastAPI Guide',
        slug: 'fastapi-guide',
        summary: 'A guide to FastAPI',
        tags: [{ name: 'FastAPI', slug: 'fastapi' }],
      },
    ]
    return Promise.resolve(tag ? allPosts.filter((post) => post.tags.some((t) => t.slug === tag)) : allPosts)
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders posts and filters by tag click', async () => {
  render(<HomePage />)
  expect(await screen.findByText(/hello react/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /react/i }))
  expect(await screen.findByText(/hello react/i)).toBeInTheDocument()
  expect(screen.queryByText(/fastapi guide/i)).not.toBeInTheDocument()
})
