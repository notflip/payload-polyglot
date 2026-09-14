import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyUnit,
  assertRoundTrip,
  cloneLexical,
  extractPlainText,
  hasMediaNodes,
  toUnits,
} from '../dist/lexical.js'

const text = (t, format = 0) => ({
  type: 'text', text: t, format, style: '', mode: 'normal', detail: 0, version: 1,
})
const root = (...children) => ({ root: { type: 'root', format: '', indent: 0, version: 1, direction: null, children } })

/** Translate every unit by putting it through a function, the way the hub does. */
function translateAll(doc, change) {
  const target = cloneLexical(doc)
  for (const unit of toUnits(doc)) applyUnit(target, unit.unit, change(unit.tagged), unit.segments)
  assertRoundTrip(doc, target)
  return target
}

test('a bulleted list keeps its structure', () => {
  const doc = root({
    type: 'list', listType: 'bullet', tag: 'ul', start: 1, version: 1, indent: 0, format: '', direction: null,
    children: [
      { type: 'listitem', value: 1, version: 1, indent: 0, format: '', direction: null, children: [text('Eerste')] },
      { type: 'listitem', value: 2, version: 1, indent: 0, format: '', direction: null, children: [text('Tweede')] },
    ],
  })
  const units = toUnits(doc)
  assert.deepEqual(units.map((u) => u.tagged), ['Eerste', 'Tweede'])

  const out = translateAll(doc, (s) => s.toUpperCase())
  const list = out.root.children[0]
  assert.equal(list.type, 'list')
  assert.equal(list.listType, 'bullet')
  assert.equal(list.children[0].value, 1)
  assert.equal(list.children[1].value, 2)
  assert.equal(list.children[0].children[0].text, 'EERSTE')
})

test('a nested list keeps its nesting', () => {
  const doc = root({
    type: 'list', listType: 'number', tag: 'ol', start: 1, version: 1, indent: 0, format: '', direction: null,
    children: [
      { type: 'listitem', value: 1, version: 1, children: [text('Buiten')] },
      {
        type: 'listitem', value: 2, version: 1,
        children: [{
          type: 'list', listType: 'bullet', tag: 'ul', start: 1, version: 1,
          children: [{ type: 'listitem', value: 1, version: 1, children: [text('Binnen')] }],
        }],
      },
    ],
  })
  const out = translateAll(doc, (s) => `${s}!`)
  const inner = out.root.children[0].children[1].children[0]
  assert.equal(inner.type, 'list')
  assert.equal(inner.children[0].children[0].text, 'Binnen!')
})

test('a quote keeps its node', () => {
  const doc = root({ type: 'quote', version: 1, format: '', indent: 0, direction: null, children: [text('Een citaat')] })
  const out = translateAll(doc, () => 'A quote')
  assert.equal(out.root.children[0].type, 'quote')
  assert.equal(out.root.children[0].children[0].text, 'A quote')
})

test('a heading keeps its level, indent and alignment', () => {
  const doc = root({
    type: 'heading', tag: 'h3', version: 1, format: 'center', indent: 2, direction: null,
    children: [text('Titel', 1)],
  })
  const out = translateAll(doc, (s) => s.replace('Titel', 'Title'))
  const heading = out.root.children[0]
  assert.equal(heading.tag, 'h3')
  assert.equal(heading.format, 'center')
  assert.equal(heading.indent, 2)
  assert.equal(heading.children[0].format, 1)
})

test('an upload keeps its file, and its caption is translated', () => {
  const doc = root(
    { type: 'paragraph', version: 1, children: [text('Boven')] },
    {
      type: 'upload', version: 3, relationTo: 'media', value: 42, format: '',
      fields: { caption: root({ type: 'paragraph', version: 1, children: [text('Een bijschrift')] }) },
    },
  )
  assert.equal(hasMediaNodes(doc), true)
  const out = translateAll(doc, (s) => s.toUpperCase())
  const upload = out.root.children[1]
  assert.equal(upload.type, 'upload')
  assert.equal(upload.value, 42)
  assert.equal(upload.relationTo, 'media')
  assert.equal(extractPlainText(out).includes('EEN BIJSCHRIFT'), true)
})

test('a relationship and a horizontal rule survive untouched', () => {
  const doc = root(
    { type: 'paragraph', version: 1, children: [text('Voor')] },
    { type: 'horizontalrule', version: 1 },
    { type: 'relationship', version: 1, relationTo: 'pages', value: 7, format: '' },
    { type: 'paragraph', version: 1, children: [text('Na')] },
  )
  const out = translateAll(doc, (s) => s.toUpperCase())
  assert.deepEqual(out.root.children.map((c) => c.type), ['paragraph', 'horizontalrule', 'relationship', 'paragraph'])
  assert.equal(out.root.children[2].value, 7)
})

test('a payload block inside rich text keeps its fields, and its text is translated', () => {
  const doc = root({
    type: 'block', version: 2, format: '',
    fields: {
      id: 'b1',
      blockType: 'callout',
      blockName: 'Waarschuwing',
      tone: 'warning',
      image: 12,
      heading: 'Let op',
      body: root({ type: 'paragraph', version: 1, children: [text('Kom niet te laat')] }),
    },
  })
  const out = translateAll(doc, (s) => `EN:${s}`)
  const block = out.root.children[0]
  assert.equal(block.type, 'block')
  assert.equal(block.fields.blockType, 'callout')
  assert.equal(block.fields.tone, 'warning')
  assert.equal(block.fields.image, 12)
  assert.equal(block.fields.id, 'b1')
  assert.equal(extractPlainText(out).includes('EN:Kom niet te laat'), true)
})

test('a table keeps its shape', () => {
  const doc = root({
    type: 'table', version: 1,
    children: [{
      type: 'tablerow', version: 1,
      children: [
        { type: 'tablecell', version: 1, headerState: 1, colSpan: 1, rowSpan: 1, children: [text('Naam')] },
        { type: 'tablecell', version: 1, headerState: 0, colSpan: 2, rowSpan: 1, children: [text('Waarde')] },
      ],
    }],
  })
  const out = translateAll(doc, (s) => s.toUpperCase())
  const cells = out.root.children[0].children[0].children
  assert.equal(cells[0].headerState, 1)
  assert.equal(cells[1].colSpan, 2)
  assert.equal(cells[0].children[0].text, 'NAAM')
})
