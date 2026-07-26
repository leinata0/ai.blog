import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// A named argument that the callee does not destructure is not an error in JavaScript.
// It is silently discarded, every unit test on both sides stays green, and the feature
// does nothing. That has now happened twice on this exact seam: `excludeUrls` vs
// `isImageUrlExcluded` in one round, `sectionAttribution` and `media_candidates` in the
// next. Both were caught by hand, after the fact.
//
// This test reads the call sites and the signature out of the source and compares them,
// so the next rename fails in CI instead of in production.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = resolve(__dirname, '..')

function readObjectLiteralAt(source, startIndex) {
  // startIndex points at the `{` that opens the argument object. Walk forward keeping a
  // depth count and skipping strings/template literals/comments, and return the body.
  let depth = 0
  let index = startIndex
  let quote = ''
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
    } else if (char === '\'' || char === '"' || char === '`') {
      quote = char
    } else if (char === '/' && next === '/') {
      index = source.indexOf('\n', index)
      if (index < 0) break
    } else if (char === '/' && next === '*') {
      index = source.indexOf('*/', index) + 1
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(startIndex + 1, index)
    }
    index += 1
  }
  throw new Error('unbalanced object literal')
}

// Top-level `key:` / shorthand `key,` names of an object literal body, ignoring anything
// nested inside braces, brackets or parentheses.
function topLevelKeys(body) {
  const keys = []
  let depth = 0
  let quote = ''
  let atKeyPosition = true
  let buffer = ''
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    const next = body[index + 1]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue }
    if (char === '/' && next === '/') { index = body.indexOf('\n', index); if (index < 0) break; continue }
    if (char === '/' && next === '*') { index = body.indexOf('*/', index) + 1; continue }
    if ('{[('.includes(char)) { depth += 1; continue }
    if ('}])'.includes(char)) { depth -= 1; continue }
    if (depth > 0) continue
    if (char === ',') { if (atKeyPosition && buffer.trim()) keys.push(buffer.trim()); buffer = ''; atKeyPosition = true; continue }
    if (char === ':') { if (buffer.trim()) keys.push(buffer.trim()); buffer = ''; atKeyPosition = false; continue }
    if (atKeyPosition) buffer += char
  }
  if (atKeyPosition && buffer.trim()) keys.push(buffer.trim())
  return keys.map((key) => key.replace(/^\.\.\./, '').trim()).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key))
}

const pickerSource = await readFile(resolve(SCRIPTS, 'lib', 'source-image-picker.mjs'), 'utf8')

test('every named argument passed to pickSourceImages is one the function destructures', async () => {
  const signatureStart = pickerSource.indexOf('{', pickerSource.indexOf('export async function pickSourceImages('))
  const accepted = new Set(topLevelKeys(readObjectLiteralAt(pickerSource, signatureStart)))
  assert.ok(accepted.has('sections'), 'signature parse failed')
  // The two that were silently dropped. Named explicitly so deleting the parameter fails
  // here with a readable message rather than only through a behavioural test.
  assert.ok(accepted.has('sectionAttribution'), 'the section -> source attribution must be accepted')

  for (const file of ['auto-blog.mjs', 'repair-post-media.mjs']) {
    const source = await readFile(resolve(SCRIPTS, file), 'utf8')
    let searchFrom = 0
    let callSites = 0
    for (;;) {
      const callIndex = source.indexOf('pickSourceImages({', searchFrom)
      if (callIndex < 0) break
      searchFrom = callIndex + 1
      callSites += 1
      const passed = topLevelKeys(readObjectLiteralAt(source, source.indexOf('{', callIndex)))
      for (const key of passed) {
        assert.ok(
          accepted.has(key),
          `${file} passes "${key}" to pickSourceImages, which does not destructure it — it would be silently ignored`,
        )
      }
    }
    assert.ok(callSites > 0, `expected at least one pickSourceImages call site in ${file}`)
  }
})

test('the picker consumes the candidate field name lib/feed-media.mjs actually writes', async () => {
  // feed-media builds `media_candidates`; blogwatcher attaches it to every feed item and
  // auto-blog forwards it on researchPack.sources. If the picker stops reading that exact
  // name, the whole feed-supply channel goes quiet without a single test failing.
  const feedMedia = await readFile(resolve(SCRIPTS, 'lib', 'feed-media.mjs'), 'utf8')
  const blogwatcher = await readFile(resolve(SCRIPTS, 'lib', 'blogwatcher.mjs'), 'utf8')
  const autoBlog = await readFile(resolve(SCRIPTS, 'auto-blog.mjs'), 'utf8')

  assert.ok(blogwatcher.includes('media_candidates:'), 'blogwatcher must attach media_candidates to feed items')
  assert.ok(autoBlog.includes('media_candidates: media'), 'auto-blog must forward media_candidates onto researchPack.sources')
  assert.ok(pickerSource.includes('item?.media_candidates'), 'the picker must read media_candidates')
  assert.ok(feedMedia.includes('caption'), 'feed-media must emit the caption field the scorer reads')
  assert.ok(pickerSource.includes('candidate.caption'), 'the picker must read the caption field')
})
