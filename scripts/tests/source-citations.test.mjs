import assert from 'node:assert/strict'
import test from 'node:test'

import { findInvalidCitationLinks, linkSourceCitations } from '../lib/source-citations.mjs'
import { evaluateQualityGate } from '../lib/quality-gate.mjs'

const researchPack = {
  sources: [{ source_id: 'S3', url: 'https://example.com/research', source_type: 'official_blog' }],
}
const formatProfile = { required_sections: [], required_tail_sections: [], banned_phrases: [], analysis_markers: [] }

function gate(content, pack = researchPack) {
  return evaluateQualityGate({ post: { content_md: content }, researchPack: pack, formatProfile, config: {} })
}

test('malformed links seen in a published article are replaced by the research URL', () => {
  const original = '出处 [S3]([object Object],[object Object],[object Object])。'
  const repaired = linkSourceCitations(original, researchPack)
  assert.equal(repaired, '出处 [S3](https://example.com/research)。')
  assert.equal(gate(original).passed, false)
  assert.deepEqual(gate(original).metrics.invalid_citation_links, ['S3'])
  assert.equal(gate(repaired).passed, true)
})

test('a valid-looking but unrelated link cannot impersonate a known source ID', () => {
  const original = '事实 [S3](https://wrong.example/fabricated)。'
  assert.equal(gate(original).passed, false)
  assert.equal(linkSourceCitations(original, researchPack), '事实 [S3](https://example.com/research)。')
})

test('bare IDs remain accepted in drafts and link deterministically on finalization', () => {
  assert.equal(gate('事实 [S3]。').passed, true)
  assert.equal(linkSourceCitations('事实 [S3]。', researchPack), '事实 [S3](https://example.com/research)。')
  assert.equal(gate('事实 [S99]。').passed, false)
})

test('non-string and non-HTTP source URLs cannot produce published source links', () => {
  for (const url of [[{ url: 'https://example.com/a' }], 'javascript:alert(1)', 'invalid']) {
    const pack = { sources: [{ source_id: 'S3', url }] }
    assert.equal(linkSourceCitations('事实 [S3]。', pack), '事实 [S3]。')
    assert.equal(gate('事实 [S3]。', pack).passed, false)
  }
})

test('parentheses in existing and canonical URLs are replaced without a broken Markdown tail', () => {
  const pack = { sources: [{ source_id: 'S3', url: 'https://example.com/wiki/Agent_(AI)' }] }
  const repaired = linkSourceCitations('事实 [S3](https://wrong.example/wiki/Test_(old))。', pack)
  assert.equal(repaired, '事实 [S3](https://example.com/wiki/Agent_%28AI%29)。')
  assert.equal(gate(repaired, pack).passed, true)
})

test('source-like image alt text retains its image URL and is excluded from link validation', () => {
  const image = '![S3](https://example.com/chart_(draft_(v2)).png)'
  const original = `${image}\n\n事实 [S3]。`
  assert.equal(linkSourceCitations(original, researchPack), `${image}\n\n事实 [S3](https://example.com/research)。`)
  assert.deepEqual(findInvalidCitationLinks(original, researchPack), [])
  assert.equal(linkSourceCitations('![plot][S3]', researchPack), '![plot][S3]')
})

test('inline code and backtick or tilde fenced examples remain byte-for-byte intact', () => {
  const examples = [
    '`[S3](https://wrong.example/code)`',
    '``code with ` and [S3](https://wrong.example/code)``',
    '```md\n[S3](https://wrong.example/code)\n```',
    '~~~md\n[S3](https://wrong.example/code)\n~~~',
    '   ````md\n```\n[S3](https://wrong.example/code)\n   ````',
  ].join('\n\n')
  const original = `${examples}\n\n事实 [S3]。`
  assert.equal(linkSourceCitations(original, researchPack), `${examples}\n\n事实 [S3](https://example.com/research)。`)
  assert.deepEqual(findInvalidCitationLinks(original, researchPack), [])
})

test('deeply nested destinations are consumed fully and cannot leave an old URL behind', () => {
  const original = '事实 [S3](https://example.com/a_(b_(c)))，还有 [S3]。'
  const repaired = linkSourceCitations(original, researchPack)
  assert.equal(repaired, '事实 [S3](https://example.com/research)，还有 [S3](https://example.com/research)。')
  assert.deepEqual(findInvalidCitationLinks(original, researchPack), ['S3'])
  assert.equal(gate(repaired).passed, true)
})

test('an unterminated source destination remains unchanged and is rejected', () => {
  const original = '事实 [S3](https://example.com/a_(b_(c))'
  assert.equal(linkSourceCitations(original, researchPack), original)
  assert.deepEqual(findInvalidCitationLinks(original, researchPack), ['S3'])
  assert.equal(gate(original).passed, false)
})

test('escaped source markers and markers within unrelated link destinations are not rewritten', () => {
  const original = '\\[S3](https://wrong.example/escaped) [文档](https://example.com/[S3])'
  assert.equal(linkSourceCitations(original, researchPack), original)
  assert.deepEqual(findInvalidCitationLinks(original, researchPack), [])
})

test('an unmatched code delimiter run does not hide later prose citations', () => {
  const original = '`` unmatched [S3] and ` punctuation'
  assert.equal(linkSourceCitations(original, researchPack), '`` unmatched [S3](https://example.com/research) and ` punctuation')
})
