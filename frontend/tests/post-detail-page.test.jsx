import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import PostDetailPage from '../src/pages/PostDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: vi.fn((slug) => {
    if (slug === 'missing') {
      return Promise.reject(new Error('HTTP 404'))
    }
    return Promise.resolve({
      title: 'Hello React',
      slug: 'hello-react',
      summary: 'A post about React',
      content_md: '# Hello React\n\nThis is a post about React.',
      tags: [{ name: 'React', slug: 'react' }],
    })
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders post detail', async () => {
  render(<PostDetailPage slug="hello-react" />)
  expect(await screen.findByRole('heading', { name: /hello react/i })).toBeInTheDocument()
})

it('shows not found message on404', async () => {
  render(<PostDetailPage slug="missing" />)
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
})
