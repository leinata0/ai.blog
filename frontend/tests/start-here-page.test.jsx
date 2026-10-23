import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import StartHerePage from '../src/pages/StartHerePage'

it('guides news readers to headlines, daily and weekly coverage, topics and subscriptions', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <StartHerePage />
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByRole('heading', { name: '从头条开始，读懂 AI 的重要变化' })).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /查看最新资讯/ }).every((link) => link.getAttribute('href') === '/')).toBe(true)
  expect(screen.getByRole('link', { name: /阅读日报/ })).toHaveAttribute('href', '/daily')
  expect(screen.getByRole('link', { name: /阅读周报/ })).toHaveAttribute('href', '/weekly')
  expect(screen.getByRole('link', { name: /浏览主题/ })).toHaveAttribute('href', '/topics')
  expect(screen.getByRole('link', { name: /打开归档/ })).toHaveAttribute('href', '/archive')
  expect(screen.getByRole('link', { name: /前往订阅中心/ })).toHaveAttribute('href', '/feeds')
  expect(screen.getByText('发布日期')).toBeInTheDocument()
  expect(screen.getByText('覆盖日期')).toBeInTheDocument()
  expect(screen.getByText('原始来源')).toBeInTheDocument()
  expect(screen.getByText(/实际更新以公开发布日期为准/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /查看博客源码/ })).not.toBeInTheDocument()
})
