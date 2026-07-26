import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'

import ArticleMarkdownRenderer from '../src/components/ArticleMarkdownRenderer'
import { createHeadingIdLookup, parseMarkdownHeadings } from '../src/utils/headingIds'

const MARKDOWN = [
  '# 标题',
  '',
  '## 背景',
  '',
  '正文一。',
  '',
  '### 细节',
  '',
  '正文二。',
  '',
  '## 背景',
  '',
  '正文三。',
  '',
  '## 结论',
  '',
  '正文四。',
].join('\n')

function headingIdsInDom(container) {
  return Array.from(container.querySelectorAll('h2, h3')).map((el) => el.id)
}

/** Wrapper that lets the test force parent re-renders, like a copy click or a lazy chunk landing. */
function Harness({ markdown }) {
  const [tick, setTick] = useState(0)
  return (
    <div>
      <button type="button" onClick={() => setTick((value) => value + 1)}>rerender</button>
      <span data-testid="tick">{tick}</span>
      <ArticleMarkdownRenderer markdown={markdown} copiedCode="" onCopy={() => {}} />
    </div>
  )
}

afterEach(() => {
  cleanup()
})

it('keeps heading ids stable across re-renders instead of incrementing them', () => {
  const { container } = render(<Harness markdown={MARKDOWN} />)

  const first = headingIdsInDom(container)
  expect(first).toEqual(['背景', '细节', '背景-2', '结论'])

  fireEvent.click(screen.getByRole('button', { name: 'rerender' }))
  fireEvent.click(screen.getByRole('button', { name: 'rerender' }))
  fireEvent.click(screen.getByRole('button', { name: 'rerender' }))

  expect(screen.getByTestId('tick')).toHaveTextContent('3')
  expect(headingIdsInDom(container)).toEqual(first)
})

it('renders exactly the ids the table of contents links to', () => {
  const { container } = render(<Harness markdown={MARKDOWN} />)

  const tocIds = parseMarkdownHeadings(MARKDOWN).map((heading) => heading.id)
  expect(headingIdsInDom(container)).toEqual(tocIds)

  fireEvent.click(screen.getByRole('button', { name: 'rerender' }))
  tocIds.forEach((id) => {
    expect(container.querySelector(`#${CSS.escape(id)}`)).not.toBeNull()
  })
})

it('ignores headings inside fenced code so the TOC has no dead links', () => {
  const markdown = [
    '## 真实标题',
    '',
    '```md',
    '## 假标题',
    '```',
    '',
    '## 结尾',
  ].join('\n')

  const { container } = render(<Harness markdown={markdown} />)

  expect(parseMarkdownHeadings(markdown).map((h) => h.id)).toEqual(['真实标题', '结尾'])
  expect(headingIdsInDom(container)).toEqual(['真实标题', '结尾'])
})

it('lookup is pure: repeated calls for the same heading return the same id', () => {
  const lookup = createHeadingIdLookup(MARKDOWN)
  const headings = parseMarkdownHeadings(MARKDOWN)

  for (let pass = 0; pass < 3; pass += 1) {
    expect(headings.map((h) => lookup(h.text, h.line))).toEqual(headings.map((h) => h.id))
  }
})

it('renders a fenced block without a language tag as a scrollable code block', () => {
  const markdown = ['前言。', '', '```', 'line one', 'line two', '```'].join('\n')
  const { container } = render(<Harness markdown={markdown} />)

  const pre = container.querySelector('pre')
  expect(pre).not.toBeNull()
  expect(pre.className).toContain('overflow-x-auto')
  expect(pre.textContent).toContain('line one')
  expect(pre.textContent).toContain('line two')
  // Block code must not be rendered through the inline `nowrap` branch.
  expect(pre.querySelector('code')?.className || '').not.toContain('whitespace-nowrap')
  expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
})

it('does not leak the react-markdown node object into DOM attributes', () => {
  const markdown = ['行内 `code` 示例。', '', '```', 'plain', '```'].join('\n')
  const { container } = render(<Harness markdown={markdown} />)

  container.querySelectorAll('code, pre').forEach((el) => {
    expect(el.getAttribute('node')).toBeNull()
  })
})
