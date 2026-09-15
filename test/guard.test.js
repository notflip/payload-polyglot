import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLexical, toUnits, applyUnit, cloneLexical, assertRoundTrip } from '../dist/lexical.js'

/**
 * The promise this package makes about rich text: the only thing a translation
 * can change is the words. Everything else is carried over untouched.
 */
const doc = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: null,
    children: [
      { type: 'heading', tag: 'h2', version: 1, format: 'center', indent: 1, direction: null,
        children: [{ type: 'text', text: 'Titel', format: 1, style: 'color: red', mode: 'normal', detail: 0, version: 1 }] },
      { type: 'list', listType: 'number', tag: 'ol', start: 3, version: 1, indent: 0, format: '', direction: null,
        children: [
          { type: 'listitem', value: 1, version: 1, checked: false, children: [
            { type: 'text', text: 'Bel ', format: 0, style: '', mode: 'normal', detail: 0, version: 1 },
            { type: 'link', version: 3, format: '', indent: 0, direction: null,
              fields: { url: 'tel:123', newTab: true, linkType: 'custom' },
              children: [{ type: 'text', text: 'ons', format: 2, style: '', mode: 'normal', detail: 0, version: 1 }] },
          ] },
        ] },
      { type: 'upload', version: 3, relationTo: 'media', value: 42, format: '',
        fields: { caption: { root: { type: 'root', children: [{ type: 'paragraph', version: 1, children: [
          { type: 'text', text: 'Bijschrift', format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] } } } },
      { type: 'horizontalrule', version: 1 },
      { type: 'block', version: 2, format: '',
        fields: { id: 'b1', blockType: 'callout', tone: 'warning', image: 9 } },
    ],
  },
}

test('translating every unit changes the words and nothing else', () => {
  const before = JSON.parse(JSON.stringify(doc))
  const after = cloneLexical(doc)
  // Translate by putting the words in capitals. The tags stay as they are,
  // because a translator never retypes them.
  const translate = (tagged) => tagged.replace(/<[^>]*>|([^<]+)/g, (tag, words) => words?.toUpperCase() ?? tag)
  for (const unit of toUnits(doc)) applyUnit(after, unit.unit, translate(unit.tagged), unit.segments)
  assertRoundTrip(doc, after)

  // The source must not have been touched at all.
  assert.deepEqual(doc, before)

  // Strip the words from both trees. What is left has to be identical.
  const shape = (node) => {
    if (Array.isArray(node)) return node.map(shape)
    if (!node || typeof node !== 'object') return node
    const out = {}
    // `direction` is the one key the write-back changes on purpose: lexical
    // recomputes it, so a right-to-left translation renders correctly.
    for (const [key, value] of Object.entries(node)) {
      out[key] = key === 'text' ? '' : key === 'direction' ? null : shape(value)
    }
    return out
  }
  assert.deepEqual(shape(after), shape(before), 'the structure changed')

  // And the words really did change.
  assert.equal(after.root.children[0].children[0].text, 'TITEL')
  assert.equal(after.root.children[0].tag, 'h2')
  assert.equal(after.root.children[0].format, 'center')
  assert.equal(after.root.children[0].indent, 1)
  assert.equal(after.root.children[0].children[0].style, 'color: red')
  assert.equal(after.root.children[0].children[0].format, 1)
  assert.equal(after.root.children[1].start, 3)
  assert.equal(after.root.children[1].children[0].children[1].fields.url, 'tel:123')
  assert.equal(after.root.children[1].children[0].children[1].children[0].format, 2)
  assert.equal(after.root.children[2].value, 42)
  assert.equal(after.root.children[4].fields.tone, 'warning')
})

test('an empty translation leaves the whole document alone', () => {
  const after = cloneLexical(doc)
  for (const unit of toUnits(doc)) applyUnit(after, unit.unit, unit.tagged, unit.segments)
  assert.deepEqual(after, doc)
})

test('a rich text value is recognised, so a plain string can be refused', () => {
  assert.equal(isLexical(doc), true)
  assert.equal(isLexical('Titel'), false)
  assert.equal(isLexical(null), false)
})
