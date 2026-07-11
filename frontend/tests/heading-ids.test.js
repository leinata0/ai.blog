import { expect, it } from 'vitest'

import {
  createHeadingIdAllocator,
  parseMarkdownHeadings,
  READING_SCROLL_OFFSET_PX,
  slugifyHeading,
} from '../src/utils/headingIds'

it('slugifies CJK and latin headings', () => {
  expect(slugifyHeading('OpenAI 新模型')).toBe('openai-新模型')
  expect(slugifyHeading('Hello World!')).toBe('hello-world')
  expect(slugifyHeading('')).toBe('')
})

it('parses h2/h3 with unique ids for duplicates (ignores h1)', () => {
  const md = [
    '# Title',
    '## 背景',
    '### 细节',
    '## 背景',
    '## 总结',
  ].join('\n')
  const headings = parseMarkdownHeadings(md)
  expect(headings.map((h) => h.id)).toEqual(['背景', '细节', '背景-2', '总结'])
  expect(headings.every((h) => h.level >= 2)).toBe(true)
})

it('allocator matches parseMarkdownHeadings for h2/h3 order', () => {
  const md = '## A\n### B\n## A\n'
  const parsed = parseMarkdownHeadings(md)
  const allocate = createHeadingIdAllocator()
  const fromAllocator = ['A', 'B', 'A'].map(allocate)
  expect(fromAllocator).toEqual(parsed.map((h) => h.id))
})

it('exports a stable reading offset', () => {
  expect(READING_SCROLL_OFFSET_PX).toBe(96)
})
