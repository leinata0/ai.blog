import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import ContentTypePage from '../src/pages/ContentTypePage'
import SeriesDetailPage from '../src/pages/SeriesDetailPage'

const postApiMocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
  fetchPosts: vi.fn(),
  fetchSeriesDetail: vi.fn(),
}))

vi.mock('../src/api/posts', () => postApiMocks)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('keeps content-type data aligned with the latest prop and resets while loading', async () => {
  const staleDaily = deferred()
  const currentWeekly = deferred()
  const freshDaily = deferred()
  postApiMocks.fetchDiscover
    .mockReturnValueOnce(staleDaily.promise)
    .mockReturnValueOnce(currentWeekly.promise)
    .mockReturnValueOnce(freshDaily.promise)

  const { container, rerender } = render(
    <MemoryRouter>
      <ThemeProvider>
        <ContentTypePage contentType="daily_brief" />
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(postApiMocks.fetchDiscover).toHaveBeenCalledTimes(1))
  const firstSignal = postApiMocks.fetchDiscover.mock.calls[0][1].signal

  rerender(
    <MemoryRouter>
      <ThemeProvider>
        <ContentTypePage contentType="weekly_review" />
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(postApiMocks.fetchDiscover).toHaveBeenCalledTimes(2))
  expect(firstSignal.aborted).toBe(true)

  await act(async () => {
    staleDaily.resolve({
      items: [{ slug: 'stale-daily', title: 'Stale daily response', content_type: 'daily_brief' }],
    })
    await staleDaily.promise
  })
  expect(screen.queryByText('Stale daily response')).not.toBeInTheDocument()
  expect(container.querySelector('.loading-skeleton')).toBeInTheDocument()

  await act(async () => {
    currentWeekly.resolve({
      items: [{ slug: 'weekly', title: 'Current weekly response', content_type: 'weekly_review' }],
    })
    await currentWeekly.promise
  })
  expect(await screen.findByText('Current weekly response')).toBeInTheDocument()

  rerender(
    <MemoryRouter>
      <ThemeProvider>
        <ContentTypePage contentType="daily_brief" />
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(postApiMocks.fetchDiscover).toHaveBeenCalledTimes(3))
  expect(screen.queryByText('Current weekly response')).not.toBeInTheDocument()
  expect(container.querySelector('.loading-skeleton')).toBeInTheDocument()

  await act(async () => {
    freshDaily.resolve({
      items: [{ slug: 'fresh-daily', title: 'Fresh daily response', content_type: 'daily_brief' }],
    })
    await freshDaily.promise
  })
  expect(await screen.findByText('Fresh daily response')).toBeInTheDocument()
  expect(postApiMocks.fetchPosts).not.toHaveBeenCalled()
})

it('prevents an old series response from replacing the latest route', async () => {
  const oldSeries = deferred()
  const newSeries = deferred()
  postApiMocks.fetchSeriesDetail
    .mockReturnValueOnce(oldSeries.promise)
    .mockReturnValueOnce(newSeries.promise)

  function SeriesRoute() {
    return (
      <>
        <Link to="/series/new-series">Open new series</Link>
        <SeriesDetailPage />
      </>
    )
  }

  const { container } = render(
    <MemoryRouter initialEntries={['/series/old-series']}>
      <ThemeProvider>
        <Routes>
          <Route path="/series/:slug" element={<SeriesRoute />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(postApiMocks.fetchSeriesDetail).toHaveBeenCalledTimes(1))
  const oldSignal = postApiMocks.fetchSeriesDetail.mock.calls[0][1].signal
  fireEvent.click(screen.getByRole('link', { name: 'Open new series' }))

  await waitFor(() => expect(postApiMocks.fetchSeriesDetail).toHaveBeenCalledTimes(2))
  expect(oldSignal.aborted).toBe(true)

  await act(async () => {
    oldSeries.resolve({
      slug: 'old-series',
      title: 'Stale old series',
      description: 'Old data',
      posts: [],
    })
    await oldSeries.promise
  })
  expect(screen.queryByText('Stale old series')).not.toBeInTheDocument()
  expect(container.querySelector('.loading-skeleton')).toBeInTheDocument()

  await act(async () => {
    newSeries.resolve({
      slug: 'new-series',
      title: 'Current new series',
      description: 'New data',
      posts: [],
    })
    await newSeries.promise
  })
  expect(await screen.findByRole('heading', { name: 'Current new series' })).toBeInTheDocument()
  expect(screen.queryByText('Stale old series')).not.toBeInTheDocument()
})
