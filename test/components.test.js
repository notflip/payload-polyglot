import assert from 'node:assert/strict'
import { test } from 'node:test'
import { componentUnits, getComponentValue, setComponentValue, cloneLexical } from '../dist/lexical.js'
import { collectUnits } from '../dist/flatten.js'

/** What the Payload config says about the two components of this project. */
const COMPONENTS = [
  { slug: 'inlineButton', label: 'Knop', fields: [{ path: 'link.label', label: 'Tekst van de link', kind: 'text' }] },
  {
    slug: 'inlineFaq',
    label: 'Inline FAQ',
    fields: [
      { path: 'items[].title', label: 'Vraag', kind: 'text' },
      { path: 'items[].content', label: 'Antwoord', kind: 'richtext' },
    ],
  },
]

const answer = (text) => ({
  root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
    { type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] },
})

const document = (items, lang) => ({
  root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
    { type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'text', text: lang === 'nl' ? 'Lees meer over ' : 'Read about ', format: 0, style: '', mode: 'normal', detail: 0, version: 1 },
      { type: 'inlineBlock', version: 1, fields: { id: 'b1', blockType: 'inlineButton', variant: 'default',
        link: { type: 'custom', url: '/aanpak', newTab: false, label: lang === 'nl' ? 'onze aanpak' : 'our approach' } } },
      { type: 'text', text: '.', format: 0, style: '', mode: 'normal', detail: 0, version: 1 },
    ] },
    { type: 'block', version: 2, format: '', fields: { id: 'f1', blockType: 'inlineFaq',
      items: Array.from({ length: items }, (_, index) => ({
        id: `i${index}`,
        title: lang === 'nl' ? `Vraag ${index + 1}?` : '',
        content: answer(lang === 'nl' ? `Antwoord ${index + 1}.` : ''),
      })) } },
  ] },
})

test('every translatable field of every component is found', () => {
  const units = componentUnits(document(12, 'nl'), COMPONENTS)
  // One button label, twelve questions, twelve answers.
  assert.equal(units.length, 25)

  assert.deepEqual(
    units.slice(0, 5).map((unit) => unit.suffix),
    ['@0/1#link.label', '@1#items[0].title', '@1#items[0].content', '@1#items[1].title', '@1#items[1].content'],
  )
  assert.equal(units[1].label, 'Inline FAQ')
  assert.equal(units[1].fieldLabel, 'Vraag')
  assert.equal(units[1].kind, 'text')
  assert.equal(units[2].kind, 'richtext')
  assert.equal(units[0].value, 'onze aanpak')
})

test('a component that the project did not declare is left alone', () => {
  assert.deepEqual(componentUnits(document(1, 'nl'), []), [])
  assert.deepEqual(componentUnits(document(1, 'nl'), [{ slug: 'other', label: 'Other', fields: [{ path: 'title', label: 'T', kind: 'text' }] }]), [])
})

test('writing one field of one component touches nothing else', () => {
  const source = document(3, 'nl')
  const copy = cloneLexical(source)
  assert.equal(setComponentValue(copy, '1', 'items[1].title', 'Question 2?'), true)

  assert.equal(getComponentValue(copy, '1', 'items[1].title'), 'Question 2?')
  assert.equal(getComponentValue(copy, '1', 'items[0].title'), 'Vraag 1?')
  assert.equal(getComponentValue(source, '1', 'items[1].title'), 'Vraag 2?', 'the source changed')
  assert.deepEqual(copy.root.children[0], source.root.children[0], 'the sentence changed')
})

test('a write into a shape that is not there is refused', () => {
  const copy = cloneLexical(document(2, 'nl'))
  assert.equal(setComponentValue(copy, '9/9', 'items[0].title', 'x'), false)
  assert.equal(setComponentValue(copy, '1', 'items[5].title', 'x'), false)
  assert.equal(setComponentValue(copy, '1', 'nothing', 'x'), false)
})

test('the report holds one row per string, with the state of each language', () => {
  const schema = [{
    nodeKind: 'leaf', name: 'content', type: 'richText', label: 'Inhoud', required: false,
    kind: 'richtext', role: 'content', translatable: true, localized: true, components: COMPONENTS,
  }]
  const units = collectUnits(schema, { content: { nl: document(12, 'nl'), en: document(12, 'en') } }, ['nl', 'en'], 'nl')

  // The text itself, plus twenty-five strings inside the two components.
  assert.equal(units.length, 26)
  const faq = units.find((unit) => unit.path === 'content@1#items[3].title')
  assert.equal(faq.template, 'content#items[].title')
  assert.equal(faq.parentPath, 'content')
  assert.equal(faq.componentSlug, 'inlineFaq')
  assert.equal(faq.rowTitle, 'Inline FAQ')
  assert.equal(faq.label, 'Vraag')
  assert.equal(faq.values.nl.status, 'ok')
  assert.notEqual(faq.values.en.status, 'ok')

  // The button label is translated, so it is not reported as work.
  const button = units.find((unit) => unit.path === 'content@0/1#link.label')
  assert.equal(button.values.en.status, 'ok')
})
