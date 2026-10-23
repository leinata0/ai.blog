import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import StartHerePage from '../src/pages/StartHerePage'

beforeEach(() => { window.localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })) })
afterEach(cleanup)
const renderGuide = () => render(<MemoryRouter><ThemeProvider><StartHerePage /></ThemeProvider></MemoryRouter>)

it('updates the visible reading path and destination when a reader changes their reading rhythm', async () => {
  const { container } = renderGuide()
  expect(container.querySelector('[data-tech-page="reading"]')).toBeTruthy()
  const choices = screen.getByRole('group', { name: '选择阅读路径' })
  await userEvent.click(within(choices).getByRole('button', { name: /按周梳理/ }))
  const preview = container.querySelector('.tech-guide-navigator__selection')
  expect(within(preview).getByRole('heading', { name: 'AI 周报' })).toBeInTheDocument()
  expect(within(preview).getByRole('link', { name: /进入这条路径/ })).toHaveAttribute('href', '/weekly')
  expect(within(choices).getByRole('button', { name: /按周梳理/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
})

it('switches back to a separate paper guide without the interactive tech layout', async () => {
  const { container } = renderGuide()
  await userEvent.click(screen.getByRole('button', { name: '报刊版', exact: true }))
  expect(container.querySelector('[data-tech-page="reading"]')).toBeNull()
  expect(container.querySelector('.news-guide__routes')).toBeTruthy()
  expect(screen.getByRole('link', { name: /阅读周报/ })).toHaveAttribute('href', '/weekly')
})
