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
