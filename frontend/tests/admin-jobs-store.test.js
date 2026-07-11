import { afterEach, beforeEach, expect, it } from 'vitest'

import {
  clearFinishedAdminJobs,
  countActiveAdminJobs,
  dismissAdminJob,
  getAdminJobs,
  jobStatusLabel,
  mergeServerHistory,
  summarizeImageJobResult,
  summarizeTextJobResult,
  trackAdminImageJob,
  trackAdminTextJob,
  upsertAdminJob,
} from '../src/components/admin/adminJobsStore'

beforeEach(() => {
  window.sessionStorage.clear()
  // Reset module-level store by dismissing everything via clear path:
  // re-upsert is easier — clear by dismissing known ids after each test.
  getAdminJobs().forEach((job) => dismissAdminJob(job.localId))
})

afterEach(() => {
  getAdminJobs().forEach((job) => dismissAdminJob(job.localId))
  window.sessionStorage.clear()
})

it('upserts and counts active jobs', () => {
  const job = upsertAdminJob({
    label: '封面 · Demo',
    status: 'running',
    jobId: 42,
  })
  expect(job.jobId).toBe(42)
  expect(countActiveAdminJobs()).toBe(1)
  expect(jobStatusLabel('running')).toBe('生成中')

  upsertAdminJob({ jobId: 42, status: 'succeeded', resultUrl: '/uploads/a.png' })
  expect(countActiveAdminJobs()).toBe(0)
  expect(getAdminJobs()[0].resultUrl).toBe('/uploads/a.png')
})

it('summarizes image job results', () => {
  expect(summarizeImageJobResult({ generated: true, cover_image: '/x.png', status: 'succeeded' }).status).toBe('succeeded')
  expect(summarizeImageJobResult({ maybe_running: true, error: 'slow' }).status).toBe('timeout')
  expect(summarizeImageJobResult({ status: 'failed', error: 'boom' }).error).toBe('boom')
})

it('summarizes text job results', () => {
  const ok = summarizeTextJobResult({
    status: 'succeeded',
    generated: true,
    content: 'hello world from the model',
    job_id: 7,
  })
  expect(ok.status).toBe('succeeded')
  expect(ok.jobId).toBe(7)
  expect(ok.resultPreview).toContain('hello')

  expect(summarizeTextJobResult({ status: 'failed', error: 'no key' }).error).toBe('no key')
  expect(summarizeTextJobResult({ error_code: 'poll_timeout', job_id: 3 }).status).toBe('timeout')
})

it('tracks submit and wait lifecycle', async () => {
  const result = await trackAdminImageJob({
    label: '测试任务',
    detail: 'unit',
    submit: async () => ({ job_id: 9, status: 'queued' }),
    wait: async () => ({ job_id: 9, status: 'succeeded', generated: true, cover_image: '/ok.png' }),
  })
  expect(result.cover_image).toBe('/ok.png')
  const jobs = getAdminJobs()
  expect(jobs[0].status).toBe('succeeded')
  expect(jobs[0].resultUrl).toBe('/ok.png')
})

it('tracks text generation on the same store', async () => {
  const result = await trackAdminTextJob({
    label: '大纲生成',
    detail: 'pipeline',
    submit: async () => ({ job_id: 11, status: 'queued' }),
    wait: async () => ({
      job_id: 11,
      status: 'succeeded',
      generated: true,
      content: '## Outline\n- point a\n- point b',
      provider: 'openai_compatible',
      model: 'deepseek-v3',
    }),
  })
  expect(result.content).toContain('Outline')
  const job = getAdminJobs().find((item) => item.jobId === 11)
  expect(job).toBeTruthy()
  expect(job.kind).toBe('text_generation')
  expect(job.status).toBe('succeeded')
  expect(job.resultPreview).toBeTruthy()
})

it('marks failed submit without wait', async () => {
  await expect(
    trackAdminImageJob({
      label: '失败任务',
      submit: async () => {
        throw new Error('network down')
      },
    }),
  ).rejects.toThrow(/network down/)
  expect(getAdminJobs()[0].status).toBe('failed')
})

it('mergeServerHistory hydrates image and text jobs without wiping local ones', () => {
  upsertAdminJob({
    localId: 'local-only',
    label: '本机排队',
    status: 'queued',
    kind: 'image_generation',
    source: 'local',
  })

  mergeServerHistory([
    {
      kind: 'image_generation',
      job_id: 101,
      status: 'succeeded',
      label: '文章封面 #1',
      detail: 'post_cover',
      result_url: '/uploads/cover.png',
      created_at: '2026-07-01T10:00:00Z',
    },
    {
      kind: 'text_generation',
      job_id: 202,
      status: 'running',
      label: '文本 · deepseek',
      detail: 'openai_compatible · deepseek',
      result_preview: '',
      created_at: '2026-07-01T11:00:00Z',
    },
  ])

  const jobs = getAdminJobs()
  expect(jobs.some((j) => j.localId === 'local-only')).toBe(true)
  const image = jobs.find((j) => j.jobId === 101)
  const text = jobs.find((j) => j.jobId === 202)
  expect(image?.kind).toBe('image_generation')
  expect(image?.source).toBe('server')
  expect(image?.resultUrl).toBe('/uploads/cover.png')
  expect(text?.kind).toBe('text_generation')
  expect(text?.status).toBe('running')
  expect(countActiveAdminJobs()).toBeGreaterThanOrEqual(2)
})

it('clearFinishedAdminJobs keeps active ones', () => {
  upsertAdminJob({ localId: 'a', label: 'done', status: 'succeeded' })
  upsertAdminJob({ localId: 'b', label: 'busy', status: 'running' })
  clearFinishedAdminJobs()
  const remaining = getAdminJobs()
  expect(remaining).toHaveLength(1)
  expect(remaining[0].localId).toBe('b')
})
