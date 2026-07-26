import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiPostMock, apiGetMock, clearApiGetCacheMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  apiGetMock: vi.fn(),
  clearApiGetCacheMock: vi.fn(),
}))

vi.mock('../src/api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: apiGetMock,
  apiPost: apiPostMock,
  apiPut: vi.fn(),
  buildApiUrl: vi.fn((path) => path),
  clearApiGetCache: clearApiGetCacheMock,
}))

import {
  ADMIN_IMAGE_PAGE_SIZE,
  fetchAdminImages,
  generateAdminHeroImage,
  generateAdminPostCover,
  waitForAdminImageGenerationJob,
} from '../src/api/admin'

beforeEach(() => {
  apiPostMock.mockReset()
  apiGetMock.mockReset()
  clearApiGetCacheMock.mockReset()
})

describe('admin image generation API', () => {
  it('returns a soft running result when the initial submit request times out', async () => {
    const timeoutError = new Error('请求超时，请稍后重试')
    timeoutError.name = 'AbortError'
    apiPostMock.mockRejectedValue(timeoutError)

    const result = await generateAdminPostCover(123, { overwrite: true })

    expect(apiPostMock).toHaveBeenCalledWith('/api/admin/posts/123/generate-cover', { overwrite: true }, {
      auth: true,
      timeout: 60000,
    })
    expect(result).toMatchObject({
      generated: false,
      status: 'running',
      error_code: 'submit_timeout_no_job_id',
      maybe_running: true,
    })
    expect(result.error).toContain('任务可能仍在后台执行')
    expect(result.error).not.toBe('请求超时，请稍后重试')
  })

  it('allows submit timeout overrides for bulk job submission', async () => {
    const payload = { job_id: 43, status: 'queued', generated: false }
    apiPostMock.mockResolvedValue(payload)

    await expect(generateAdminPostCover(123, { overwrite: false }, { timeout: 12000 })).resolves.toBe(payload)

    expect(apiPostMock).toHaveBeenCalledWith('/api/admin/posts/123/generate-cover', { overwrite: false }, {
      auth: true,
      timeout: 12000,
    })
  })

  it('continues to throw non-timeout submit errors', async () => {
    apiPostMock.mockRejectedValue(new Error('登录已过期，请重新登录'))

    await expect(generateAdminHeroImage({ overwrite: true })).rejects.toThrow('登录已过期，请重新登录')
  })

  it('returns successful job submit responses unchanged', async () => {
    const payload = { job_id: 42, status: 'queued', generated: false }
    apiPostMock.mockResolvedValue(payload)

    await expect(generateAdminPostCover(123, {})).resolves.toBe(payload)
  })

  it('passes through soft no-job results without polling', async () => {
    const softResult = {
      generated: false,
      status: 'running',
      error_code: 'submit_timeout_no_job_id',
      error: '生成请求已发送，但服务器响应较慢；任务可能仍在后台执行，请稍后刷新页面查看结果。',
      maybe_running: true,
    }

    await expect(waitForAdminImageGenerationJob(softResult)).resolves.toBe(softResult)
    expect(apiGetMock).not.toHaveBeenCalled()
  })
})

/**
 * The backend answers `GET /api/admin/images` with a bare JSON array and puts the
 * continuation token in the `X-Next-Cursor` response header (listed in the CORS
 * `expose_headers` so the Vercel origin can read it). `fetchAdminImages` therefore has to
 * go through `includeResponseMeta` and flatten the envelope for the panel.
 */
describe('admin image listing pagination', () => {
  it('sends the bounded limit and reads the cursor out of the response header', async () => {
    apiGetMock.mockResolvedValue({
      data: [{ filename: 'a.png' }],
      headers: { 'x-next-cursor': 'cur-2' },
    })

    const page = await fetchAdminImages()

    expect(apiGetMock).toHaveBeenCalledWith(`/api/admin/images?limit=${ADMIN_IMAGE_PAGE_SIZE}`, {
      auth: true,
      includeResponseMeta: true,
    })
    expect(page).toEqual({ items: [{ filename: 'a.png' }], nextCursor: 'cur-2' })
    // The backend caps `limit` at 200 — never request more than it will accept.
    expect(ADMIN_IMAGE_PAGE_SIZE).toBeLessThanOrEqual(200)
  })

  it('forwards a cursor as a query param for follow-up pages', async () => {
    apiGetMock.mockResolvedValue({ data: [], headers: {} })

    await fetchAdminImages({ cursor: 'cur-2' })

    expect(apiGetMock).toHaveBeenCalledWith(
      `/api/admin/images?limit=${ADMIN_IMAGE_PAGE_SIZE}&cursor=cur-2`,
      { auth: true, includeResponseMeta: true },
    )
  })

  it('degrades to a single exhausted page when the header is not readable', async () => {
    // e.g. CORS `expose_headers` dropped, or a backend rolled back to the pre-cursor build.
    apiGetMock.mockResolvedValue({ data: [{ filename: 'a.png' }], headers: {} })

    expect(await fetchAdminImages()).toEqual({ items: [{ filename: 'a.png' }], nextCursor: '' })
  })
})
