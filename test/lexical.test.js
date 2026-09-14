import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applySegments,
  applyUnit,
  assertRoundTrip,
  cloneLexical,
  extractPlainText,
  extractSegments,
  hasMediaNodes,
  parseTagged,
  renderTagged,
  TagMismatchError,
  toUnits,
} from '../dist/lexical.js'

const text = (t, format = 0) => ({
  type: 'text', text: t, format, style: '', mode: 'normal', detail: 0, version: 1,
})

/** A real shape, taken from a child-focus-web FAQ block. */
const simple = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: null,
    children: [{
      type: 'paragraph', format: '', indent: 0, version: 1,
      direction: null, textStyle: '', textFormat: 0,
      children: [text('Voor professionals die werken met jongeren.')],
    }],
  },
}

const withFormatAndLink = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: null,
    children: [{
      type: 'paragraph', format: '', indent: 0, version: 1, direction: null,
      children: [
        text('Boek je '),
        text('vandaag', 1),
        text(' via '),
        {
          type: 'link', version: 3, direction: null, format: '', indent: 0,
          fields: { linkType: 'internal', newTab: false, doc: { relationTo: 'pages', value: 7 } },
          children: [text('deze pagina')],
        },
        text('.'),
      ],
    }],
  },
}

test('extracts plain text', () => {
  assert.equal(extractPlainText(simple), 'Voor professionals die werken met jongeren.')
})

test('renders a unit with format and link tags', () => {
  const units = toUnits(withFormatAndLink)
  assert.equal(units.length, 1)
  assert.equal(units[0].tagged, 'Boek je <b>vandaag</b> via <a k="0">deze pagina</a>.')
})

test('parses a tagged string back into runs', () => {
  const runs = parseTagged('Book <b>today</b> via <a k="0">this page</a>.')
  assert.deepEqual(runs.map((r) => [r.text, r.format, r.linkIndex]), [
    ['Book ', 0, undefined],
    ['today', 1, undefined],
    [' via ', 0, undefined],
    ['this page', 0, 0],
    ['.', 0, undefined],
  ])
})

test('render and parse round trip through nested formats', () => {
  const segments = [
    { addr: '0/0', unit: '0', text: 'a', format: 0 },
    { addr: '0/1', unit: '0', text: 'b', format: 3 },
    { addr: '0/2', unit: '0', text: 'c', format: 1 },
    { addr: '0/3', unit: '0', text: 'd', format: 0 },
  ]
  const tagged = renderTagged(segments)
  const runs = parseTagged(tagged)
  assert.deepEqual(runs.map((r) => [r.text, r.format]), [['a', 0], ['b', 3], ['c', 1], ['d', 0]])
})

test('escapes angle brackets in the source text', () => {
  const tagged = renderTagged([{ addr: '0/0', unit: '0', text: 'a < b > c & d', format: 0 }])
  assert.equal(parseTagged(tagged)[0].text, 'a < b > c & d')
})

test('write back keeps the link fields and the paragraph node', () => {
  const target = cloneLexical(withFormatAndLink)
  const source = toUnits(withFormatAndLink)[0]
  applyUnit(target, source.unit, 'Book <b>today</b> via <a k="0">this page</a>.', source.segments)

  const paragraph = target.root.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.equal(paragraph.version, 1)
  const link = paragraph.children.find((c) => c.type === 'link')
  assert.deepEqual(link.fields, {
    linkType: 'internal', newTab: false, doc: { relationTo: 'pages', value: 7 },
  })
  assert.equal(link.children[0].text, 'this page')
  assert.equal(extractPlainText(target), 'Book  today  via  this page .')
  assertRoundTrip(withFormatAndLink, target)
})

test('a translation that drops a link is refused', () => {
  const target = cloneLexical(withFormatAndLink)
  const source = toUnits(withFormatAndLink)[0]
  assert.throws(
    () => applyUnit(target, source.unit, 'Book today via this page.', source.segments),
    TagMismatchError,
  )
})

test('the segment fallback changes only the text', () => {
  const target = cloneLexical(withFormatAndLink)
  const map = new Map(extractSegments(withFormatAndLink).map((s) => [s.addr, s.text.toUpperCase()]))
  applySegments(target, map)
  const paragraph = target.root.children[0]
  assert.equal(paragraph.children[1].format, 1)
  assert.equal(paragraph.children[1].text, 'VANDAAG')
  assert.equal(paragraph.children[3].fields.doc.value, 7)
  assert.equal(paragraph.children[3].children[0].text, 'DEZE PAGINA')
})

test('media nodes are recognised', () => {
  assert.equal(hasMediaNodes(simple), false)
  assert.equal(
    hasMediaNodes({ root: { children: [{ type: 'upload', value: 1 }] } }),
    true,
  )
})

test('descends into an upload caption', () => {
  const doc = {
    root: {
      type: 'root', children: [{
        type: 'upload', version: 1, relationTo: 'media', value: 3,
        fields: { caption: { root: { type: 'root', children: [{ type: 'paragraph', children: [text('Een bijschrift')] }] } } },
      }],
    },
  }
  assert.equal(extractPlainText(doc), 'Een bijschrift')
})
