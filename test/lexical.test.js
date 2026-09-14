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

/** A real shape from anndeman: two paragraphs, the second with a line break. */
const withBreak = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: null,
    children: [
      { type: 'paragraph', format: '', indent: 0, version: 1, direction: null,
        children: [text('Wil je een werk komen zien?')] },
      { type: 'paragraph', format: '', indent: 0, version: 1, direction: null,
        children: [
          text('Elk weekend van 14:00 - 18:00'),
          { type: 'linebreak', version: 1 },
          text('Lindestraat 3, 8573 Tiegem'),
        ] },
    ],
  },
}

test('a line break survives the tagged form', () => {
  const units = toUnits(withBreak)
  assert.equal(units.length, 2)
  assert.equal(units[1].tagged, 'Elk weekend van 14:00 - 18:00<x k="0"/>Lindestraat 3, 8573 Tiegem')
})

test('write back keeps the line break node', () => {
  const target = cloneLexical(withBreak)
  const source = toUnits(withBreak)[1]
  applyUnit(target, source.unit, 'Every weekend 14:00 - 18:00<x k="0"/>Lindestraat 3, 8573 Tiegem', source.segments)

  const kinds = target.root.children[1].children.map((c) => c.type)
  assert.deepEqual(kinds, ['text', 'linebreak', 'text'])
  assert.equal(target.root.children[1].children[0].text, 'Every weekend 14:00 - 18:00')
  assert.equal(target.root.children[1].children[2].text, 'Lindestraat 3, 8573 Tiegem')
  assertRoundTrip(withBreak, target)
})

test('a translation that drops a line break is refused', () => {
  const target = cloneLexical(withBreak)
  const source = toUnits(withBreak)[1]
  assert.throws(
    () => applyUnit(target, source.unit, 'Every weekend 14:00 - 18:00 Lindestraat 3', source.segments),
    TagMismatchError,
  )
})

test('two links in one unit keep their own fields', () => {
  const doc = {
    root: { type: 'root', children: [{ type: 'paragraph', version: 1, children: [
      text('Bel '),
      { type: 'link', version: 3, fields: { url: 'tel:0032478882301', newTab: true, linkType: 'custom' },
        children: [text('00 32 478 88 23 01')] },
      text(' of mail '),
      { type: 'autolink', version: 2, fields: { url: 'mailto:info@anndeman.be', linkType: 'custom' },
        children: [text('info@anndeman.be')] },
      text('.'),
    ] }] },
  }
  const unit = toUnits(doc)[0]
  assert.equal(unit.tagged, 'Bel <a k="0">00 32 478 88 23 01</a> of mail <a k="1">info@anndeman.be</a>.')

  const target = cloneLexical(doc)
  applyUnit(target, unit.unit, 'Call <a k="0">00 32 478 88 23 01</a> or mail <a k="1">info@anndeman.be</a>.', unit.segments)
  const children = target.root.children[0].children
  assert.equal(children[1].fields.url, 'tel:0032478882301')
  assert.equal(children[1].type, 'link')
  assert.equal(children[3].fields.url, 'mailto:info@anndeman.be')
  assert.equal(children[3].type, 'autolink')
  assert.equal(children[0].text, 'Call ')
  assertRoundTrip(doc, target)
})

test('a unit says what each of its links points at', () => {
  const doc = {
    root: { type: 'root', children: [{ type: 'paragraph', version: 1, children: [
      text('Bel '),
      { type: 'link', version: 3, fields: { url: 'tel:0032478882301', newTab: true, linkType: 'custom' },
        children: [text('00 32 478 88 23 01')] },
      text(' of lees '),
      { type: 'link', version: 3, fields: { linkType: 'internal', doc: { relationTo: 'pages', value: 7 } },
        children: [text('deze pagina')] },
    ] }] },
  }
  const unit = toUnits(doc)[0]
  assert.deepEqual(unit.links, [
    { index: 0, target: 'tel:0032478882301', kind: 'address' },
    { index: 1, target: 'pages 7', kind: 'page' },
  ])
})
