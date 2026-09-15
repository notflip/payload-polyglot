import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeComponent } from '../dist/schema.js'
import { cloneLexical, componentUnits, setComponentValue } from '../dist/lexical.js'

/**
 * A component of the kind a project writes months from now: plain text, a
 * textarea, rich text, a loop of rich text, a group, a tab, a row, a nested
 * blocks field, and a pile of fields that hold no words.
 *
 * Nothing here is registered anywhere in Polyglot. The only thing that decides
 * what a translator sees is what Payload says this block is.
 */
const BLOCK = {
  slug: 'inlineOffer',
  labels: { singular: 'Aanbod' },
  fields: [
    { name: 'heading', type: 'text', label: 'Titel' },
    { name: 'intro', type: 'textarea', label: 'Inleiding' },
    { name: 'body', type: 'richText', label: 'Tekst' },

    // A loop of rich text, the case that matters most.
    {
      name: 'items',
      type: 'array',
      label: 'Items',
      fields: [
        { name: 'question', type: 'text', label: 'Vraag', required: true },
        { name: 'answer', type: 'richText', label: 'Antwoord' },
        { name: 'url', type: 'text', label: 'Link' },
      ],
    },

    // A loop inside a loop.
    {
      name: 'columns',
      type: 'array',
      label: 'Kolommen',
      fields: [{ name: 'lines', type: 'array', label: 'Regels', fields: [{ name: 'line', type: 'text', label: 'Regel' }] }],
    },

    // A group, a row and a collapsible add no surprises.
    {
      name: 'cta',
      type: 'group',
      label: 'Oproep',
      fields: [
        { type: 'row', fields: [{ name: 'label', type: 'text', label: 'Knoptekst' }, { name: 'href', type: 'text', label: 'Adres' }] },
        { type: 'collapsible', label: 'Meer', fields: [{ name: 'note', type: 'textarea', label: 'Notitie' }] },
      ],
    },

    // Tabs: a named tab adds a segment, an unnamed one does not.
    {
      type: 'tabs',
      tabs: [
        { name: 'seo', label: 'SEO', fields: [{ name: 'title', type: 'text', label: 'Paginatitel' }] },
        { label: 'Overig', fields: [{ name: 'footnote', type: 'text', label: 'Voetnoot' }] },
      ],
    },

    // A blocks field inside a component.
    {
      name: 'sections',
      type: 'blocks',
      label: 'Secties',
      blocks: [
        { slug: 'quote', fields: [{ name: 'text', type: 'textarea', label: 'Citaat' }] },
        { slug: 'media', fields: [{ name: 'caption', type: 'text', label: 'Bijschrift' }, { name: 'image', type: 'upload', relationTo: 'media' }] },
      ],
    },

    // None of these hold words.
    { name: 'variant', type: 'select', label: 'Stijl', options: ['a', 'b'] },
    { name: 'count', type: 'number', label: 'Aantal' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'page', type: 'relationship', relationTo: 'pages' },
    { name: 'active', type: 'checkbox', label: 'Aan' },
    { name: 'when', type: 'date', label: 'Datum' },
    { name: 'icon', type: 'text', label: 'Icoon' },
    { name: 'anchor', type: 'text', label: 'Anker' },
    { type: 'ui', name: 'spacer' },
  ],
}

test('every field that holds words is found, and nothing else', () => {
  const described = describeComponent(BLOCK)
  assert.equal(described.label, 'Aanbod')

  assert.deepEqual(
    described.fields.map((field) => `${field.path}:${field.kind}`),
    [
      'heading:text',
      'intro:text',
      'body:richtext',
      'items[].question:text',
      'items[].answer:richtext',
      'columns[].lines[].line:text',
      'cta.label:text',
      'cta.note:text',
      'seo.title:text',
      'footnote:text',
      'sections[quote].text:text',
      'sections[media].caption:text',
    ],
  )
  // The label of each row is kept, so a translator reads names, not paths.
  assert.equal(described.fields.find((f) => f.path === 'items[].answer').label, 'Antwoord')
})

test('a component without words is not offered at all', () => {
  assert.equal(describeComponent({ slug: 'spacer', fields: [{ name: 'height', type: 'number' }] }), undefined)
  assert.equal(describeComponent({ slug: 'image', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] }), undefined)
})

const rich = (text) => ({
  root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
    { type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] },
})

test('the loops are counted against the content that is there', () => {
  const doc = {
    root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'inlineBlock', version: 1, fields: {
        id: 'o1',
        blockType: 'inlineOffer',
        heading: 'Ons aanbod',
        intro: 'Kort',
        body: rich('De tekst'),
        items: [
          { id: 'a', question: 'Vraag 1', answer: rich('Antwoord 1'), url: '/een' },
          { id: 'b', question: 'Vraag 2', answer: rich('Antwoord 2'), url: '/twee' },
          { id: 'c', question: 'Vraag 3', answer: rich('Antwoord 3'), url: '/drie' },
        ],
        columns: [{ id: 'c1', lines: [{ id: 'l1', line: 'Regel A' }, { id: 'l2', line: 'Regel B' }] }],
        cta: { label: 'Bel ons', href: '/contact', note: 'Alleen overdag' },
        seo: { title: 'Aanbod' },
        footnote: 'Kleine letters',
        sections: [
          { id: 's1', blockType: 'quote', text: 'Een citaat' },
          { id: 's2', blockType: 'media', caption: 'Een bijschrift', image: 4 },
          { id: 's3', blockType: 'quote', text: 'Nog een citaat' },
        ],
        variant: 'a',
        icon: 'star',
      } },
    ] },
  }

  const units = componentUnits(doc, [describeComponent(BLOCK)])
  assert.deepEqual(
    units.map((unit) => unit.suffix),
    [
      // The order of the fields in the block, with each loop opened where it
      // stands: question 1, answer 1, question 2, answer 2.
      '@0#heading',
      '@0#intro',
      '@0#body',
      '@0#items[0].question',
      '@0#items[0].answer',
      '@0#items[1].question',
      '@0#items[1].answer',
      '@0#items[2].question',
      '@0#items[2].answer',
      '@0#columns[0].lines[0].line',
      '@0#columns[0].lines[1].line',
      '@0#cta.label',
      '@0#cta.note',
      '@0#seo.title',
      '@0#footnote',
      '@0#sections[0].text',
      '@0#sections[1].caption',
      '@0#sections[2].text',
    ],
  )

  // A rich text field inside a loop comes back as rich text, not as a string.
  const answer = units.find((unit) => unit.suffix === '@0#items[1].answer')
  assert.equal(answer.kind, 'richtext')
  assert.equal(answer.value.root.children[0].children[0].text, 'Antwoord 2')

  // The block rows keep to their own type: a quote never reads as a caption.
  assert.equal(units.find((u) => u.suffix === '@0#sections[2].text').value, 'Nog een citaat')
  assert.equal(units.find((u) => u.suffix === '@0#sections[1].caption').value, 'Een bijschrift')

  // Nothing that holds no words is offered.
  for (const unit of units) {
    assert.ok(!unit.field.endsWith('url'), `${unit.field} should not be offered`)
    assert.ok(!unit.field.endsWith('href'), `${unit.field} should not be offered`)
    assert.ok(!unit.field.endsWith('icon'), `${unit.field} should not be offered`)
  }
})

test('a row that is not filled in produces no empty promise', () => {
  const doc = {
    root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'inlineBlock', version: 1, fields: { id: 'o2', blockType: 'inlineOffer', heading: 'Alleen een titel' } },
    ] },
  }
  assert.deepEqual(componentUnits(doc, [describeComponent(BLOCK)]).map((unit) => unit.suffix), ['@0#heading'])
})

test('each of those fields can be written back on its own', () => {
  const doc = {
    root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'inlineBlock', version: 1, fields: {
        id: 'o3', blockType: 'inlineOffer', heading: 'Titel',
        items: [{ id: 'a', question: 'Vraag 1', answer: rich('Antwoord 1') }, { id: 'b', question: 'Vraag 2', answer: rich('Antwoord 2') }],
        columns: [{ id: 'c1', lines: [{ id: 'l1', line: 'Regel A' }, { id: 'l2', line: 'Regel B' }] }],
        sections: [{ id: 's1', blockType: 'quote', text: 'Citaat' }, { id: 's2', blockType: 'media', caption: 'Bijschrift' }],
      } },
    ] },
  }
  const copy = cloneLexical(doc)

  assert.equal(setComponentValue(copy, '0', 'items[1].question', 'Question 2'), true)
  assert.equal(setComponentValue(copy, '0', 'items[1].answer', rich('Answer 2')), true)
  assert.equal(setComponentValue(copy, '0', 'columns[0].lines[1].line', 'Line B'), true)
  assert.equal(setComponentValue(copy, '0', 'sections[1].caption', 'A caption'), true)

  const fields = copy.root.children[0].fields
  assert.equal(fields.items[1].question, 'Question 2')
  assert.equal(fields.items[1].answer.root.children[0].children[0].text, 'Answer 2')
  assert.equal(fields.columns[0].lines[1].line, 'Line B')
  assert.equal(fields.sections[1].caption, 'A caption')

  // Everything the translator did not touch is exactly as it was.
  assert.equal(fields.items[0].question, 'Vraag 1')
  assert.equal(fields.items[0].answer.root.children[0].children[0].text, 'Antwoord 1')
  assert.equal(fields.columns[0].lines[0].line, 'Regel A')
  assert.equal(fields.sections[0].text, 'Citaat')
  assert.equal(fields.items[1].id, 'b', 'the row id changed, which would orphan the other languages')
  assert.deepEqual(doc.root.children[0].fields.items[1].question, 'Vraag 2', 'the source changed')
})

test('the manifest name of a path comes from the document, not from the shape of the path', async () => {
  const { templateOf } = await import('../dist/flatten.js')
  const document = {
    fields: [
      { blockType: 'text', label: 'Volledige naam' },
      { blockType: 'checkbox', label: { root: { type: 'root', children: [] } } },
    ],
    items: [{ title: 'Een' }, { title: 'Twee' }],
    seo: { title: 'Titel' },
  }

  // A blocks field carries the kind of block; an array does not.
  assert.equal(templateOf(document, 'fields[0].label'), 'fields[text].label')
  assert.equal(templateOf(document, 'fields[1].label'), 'fields[checkbox].label')
  assert.equal(templateOf(document, 'items[1].title'), 'items[].title')
  assert.equal(templateOf(document, 'seo.title'), 'seo.title')
})
