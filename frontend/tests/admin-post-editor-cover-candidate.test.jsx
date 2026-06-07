import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const {
  adminUpdatePostMock,
  fetchPostDetailMock,
  generateAdminPostCoverMock,
  waitForAdminImageGenerationJobMock,
} = vi.hoisted(() => ({
  adminUpdatePostMock: vi.fn(),
  fetchPostDetailMock: vi.fn(),
  generateAdminPostCoverMock: vi.fn(),
  waitForAdminImageGenerationJobMock: vi.fn(),
}))

vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: fetchPostDetailMock,
}))

vi.mock('../src/api/admin', () => ({
  adminCreatePost: vi.fn(),
  adminUpdatePost: adminUpdatePostMock,
  adminUploadImage: vi.fn(),
  generateAdminPostCover: generateAdminPostCoverMock,
  waitForAdminImageGenerationJob: waitForAdminImageGenerationJobMock,
}))

import AdminPostEditor from '../src/components/admin/AdminPostEditor'

const existingPost = { id: 123, slug: 'post-slug' }
const postDetail = {
  title: 'Post title',
  slug: 'post-slug',
  summary: 'Summary',
  content_md: 'Content',
  tags: [{ slug: 'ai' }],
  cover_image: 'https://example.com/current.jpg',
  is_published: true,
  is_pinned: false,
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  fetchPostDetailMock.mockResolvedValue(postDetail)
  generateAdminPostCoverMock.mockResolvedValue({ job_id: 1, status: 'queued' })
  waitForAdminImageGenerationJobMock.mockResolvedValue({
    status: 'succeeded',
    generated: true,
    result_image_url: 'https://example.com/candidate.jpg',
  })
  adminUpdatePostMock.mockResolvedValue({})
})

describe('AdminPostEditor cover candidate chooser', () => {
  it('previews generated cover for posts with an existing cover and only applies after choosing it', async () => {
    render(<AdminPostEditor editingPost={existingPost} onBack={vi.fn()} onSaved={vi.fn()} />)

    await screen.findByDisplayValue('https://example.com/current.jpg')
    fireEvent.click(screen.getByRole('button', { name: '重生成封面' }))

    await waitFor(() => {
      expect(generateAdminPostCoverMock).toHaveBeenCalledWith(123, { mode: 'preview' })
    })
    expect(waitForAdminImageGenerationJobMock).toHaveBeenCalledWith({ job_id: 1, status: 'queued' })
    expect(screen.getByDisplayValue('https://example.com/current.jpg')).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: '保留当前封面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '使用新封面' })).toBeInTheDocument()
    expect(screen.getByAltText('当前封面')).toHaveAttribute('src', 'https://example.com/current.jpg')
    expect(screen.getByAltText('生成候选封面')).toHaveAttribute('src', 'https://example.com/candidate.jpg')

    fireEvent.click(screen.getByRole('button', { name: '使用新封面' }))

    expect(screen.getByDisplayValue('https://example.com/candidate.jpg')).toBeInTheDocument()
    expect(screen.getByText('已使用新封面，请保存修改后生效。')).toBeInTheDocument()
  })

  it('applies generation directly for posts without a cover', async () => {
    fetchPostDetailMock.mockResolvedValue({ ...postDetail, cover_image: '' })

    render(<AdminPostEditor editingPost={existingPost} onBack={vi.fn()} onSaved={vi.fn()} />)

    await screen.findByPlaceholderText('https://... 或留空')
    fireEvent.click(screen.getByRole('button', { name: '生成封面' }))

    await waitFor(() => {
      expect(generateAdminPostCoverMock).toHaveBeenCalledWith(123, { mode: 'apply', overwrite: false })
    })
    await screen.findByDisplayValue('https://example.com/candidate.jpg')
    expect(screen.queryByRole('button', { name: '使用新封面' })).not.toBeInTheDocument()
  })
})
