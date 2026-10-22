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

  expect(await screen.findByRole('heading', { name: '从一个真实项目，认识这里的 AI 实践' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /查看博客源码/i })).toHaveAttribute('href', 'https://github.com/leinata0/ai.blog')
  expect(screen.getByRole('link', { name: /浏览已有文章/i })).toHaveAttribute('href', '/archive')
  expect(screen.getByRole('link', { name: /浏览主题/i })).toHaveAttribute('href', '/topics')
  expect(screen.getByText(/如果你已经知道自己想怎么读/i)).toBeInTheDocument()
})
