import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import CommandPalette from '../src/components/CommandPalette'
import { fetchSearch } from '../src/api/posts'

vi.mock('../src/api/posts', () => ({
  fetchSearch: vi.fn(() => Promise.resolve({
    items: [{ slug: 'agent-design', title: 'Agent design patterns', summary: 'A practical article.' }],
    topics: [{ topic_key: 'agents', display_title: 'AI Agents', description: 'Topic stream.' }],
    series_suggestions: [{ slug: 'tooling-workflow', title: '工具与工作流', description: 'Series stream.' }],
  })),
}))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('CommandPalette', () => {
  it('opens with Ctrl+K and supports keyboard navigation', async () => {
    render(
      <MemoryRouter>
        <CommandPalette />
        <LocationProbe />
      </MemoryRouter>,
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: '智能命令搜索' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '搜索文章、主题、系列或页面' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(screen.getByTestId('location')).toHaveTextContent('/discover')
  })

  it('searches across posts, topics and series', async () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    await userEvent.type(await screen.findByRole('combobox'), 'Agent')

    await waitFor(() => expect(fetchSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Agent' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
    expect(await screen.findByRole('option', { name: /Agent design patterns/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /AI Agents/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /工具与工作流/i })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
