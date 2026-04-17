import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import StartHerePage from '../src/pages/StartHerePage'

it('renders onboarding path for first-time readers', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <StartHerePage />
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByRole('heading', { name: '第一次来到这里，先按这条路径进入会更轻松' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /从 AI 周报开始/i })).toHaveAttribute('href', '/weekly')
  expect(screen.getByRole('link', { name: /进入日报/i })).toHaveAttribute('href', '/daily')
  expect(screen.getByRole('link', { name: /浏览主题/i })).toHaveAttribute('href', '/topics')
  expect(screen.getByText(/如果你已经知道自己想怎么读/i)).toBeInTheDocument()
})
