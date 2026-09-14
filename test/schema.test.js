import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeTree, hasLocalizedLeaf, resolveStatusScope, walkFields } from '../dist/schema.js'
import { collectUnits, collectValues, getByPath, MISSING, parsePath, setByPath, topLevelField } from '../dist/flatten.js'
import { evaluate, normalize } from '../dist/status.js'

/** Mirrors the shape of child-focus-web: pages with a seo group and a faq block. */
const pageFields = [
  { name: 'title', type: 'text', label: 'Titel', localized: true, required: true },
  { name: 'slug', type: 'text', label: 'Slug', localized: true },
  { name: 'path', type: 'text', localized: true },
  { name: 'parent', type: 'relationship', relationTo: 'pages' },
  {
    type: 'tabs',
    tabs: [
      {
        name: 'seo',
        label: 'SEO',
        fields: [
          { name: 'title', type: 'text', label: 'SEO titel', localized: true },
          { name: 'image', type: 'upload', relationTo: 'media', localized: true },
          { name: 'noindex', type: 'checkbox' },
        ],
      },
      {
        label: 'Inhoud',
        fields: [
          {
            name: 'blocks',
            type: 'blocks',
            label: 'Blokken',
            blocks: [
              {
                slug: 'faq',
                labels: { singular: 'Veelgestelde vragen' },
                fields: [
                  { name: 'title', type: 'text', label: 'Titel', localized: true },
                  { type: 'row', fields: [{ name: 'subtitle', type: 'text', localized: true }] },
                  {
                    name: 'items',
                    type: 'array',
                    label: 'Vragen',
                    fields: [
                      { name: 'title', type: 'text', label: 'Vraag', localized: true },
                      { name: 'content', type: 'richText', label: 'Antwoord', localized: true },
                    ],
                  },
                ],
              },
              {
                slug: 'media',
                fields: [{ name: 'image', type: 'upload', relationTo: 'media' }],
              },
            ],
          },
          // A whole array marked localized: its structure differs per locale.
          {
            name: 'highlights',
            type: 'array',
            localized: true,
            fields: [{ name: 'text', type: 'text', label: 'Tekst' }],
          },
        ],
      },
    ],
  },
  { name: '_status', type: 'select', localized: true, options: ['draft', 'published'] },
]

const tree = walkFields(pageFields, 'nl', false)

test('finds every localized leaf and skips the rest', () => {
  const { leaves } = describeTree(tree)
  assert.deepEqual(leaves.map((l) => l.path), [
    'title',
    'slug',
    'path',
    'seo.title',
    'seo.image',
    'blocks[faq].title',
    'blocks[faq].subtitle',
    'blocks[faq].items[].title',
    'blocks[faq].items[].content',
    'highlights[].text',
  ])
})

test('classifies kind, role and translatability', () => {
  const { leaves } = describeTree(tree)
  const by = Object.fromEntries(leaves.map((l) => [l.path, l]))
  assert.equal(by['blocks[faq].items[].content'].kind, 'richtext')
  assert.equal(by['blocks[faq].items[].content'].blockSlug, 'faq')
  assert.equal(by['seo.image'].kind, 'relation')
  assert.equal(by['seo.image'].translatable, false)
  assert.equal(by['seo.title'].role, 'seo')
  assert.equal(by['slug'].role, 'slug')
  // The nested-docs plugin owns `path`. Polyglot reports it but never writes it.
  assert.equal(by['path'].role, 'derived')
  assert.equal(by['path'].translatable, false)
  assert.equal(by['title'].required, true)
  assert.equal(by['title'].label, 'Titel')
  assert.equal(by['blocks[faq].items[].title'].label, 'Vraag')
})

test('two blocks with the same field name keep separate paths', () => {
  const { leaves } = describeTree(tree)
  const templates = leaves.map((l) => l.path)
  assert.equal(new Set(templates).size, templates.length)
})

test('a container without a localized leaf is left out', () => {
  const { containers } = describeTree(tree)
  // The `media` block holds no localized field, so no container is reported for it.
  assert.equal(containers.some((c) => c.path.includes('media')), false)
})

test('marks a localized container as locale scoped', () => {
  const { containers } = describeTree(tree)
  const by = Object.fromEntries(containers.map((c) => [c.path, c]))
  assert.equal(by['blocks[]'].localeScoped, false)
  assert.equal(by['blocks[]'].label, 'Blokken')
  assert.equal(by['highlights[]'].localeScoped, true)
})

test('reads the status scope from the injected field', () => {
  assert.equal(resolveStatusScope(pageFields), 'locale')
  assert.equal(resolveStatusScope([{ name: '_status', type: 'select' }]), 'doc')
  assert.equal(resolveStatusScope([{ name: 'title', type: 'text' }]), 'none')
})

test('an entity without a localized field is skipped', () => {
  assert.equal(hasLocalizedLeaf(walkFields([{ name: 'x', type: 'text' }], 'nl', false)), false)
  assert.equal(hasLocalizedLeaf(tree), true)
})

// ---------------------------------------------------------------------------

test('path helpers walk array indices', () => {
  assert.deepEqual(parsePath('blocks[2].items[0].title'), ['blocks', 2, 'items', 0, 'title'])
  assert.equal(topLevelField('blocks[2].items[0].title'), 'blocks')
  const doc = { blocks: [{}, {}, { items: [{ title: 'Vraag' }] }] }
  assert.equal(getByPath(doc, 'blocks[2].items[0].title'), 'Vraag')
  assert.equal(getByPath(doc, 'blocks[9].items[0].title'), MISSING)
  assert.equal(getByPath(doc, 'blocks[2].items[0].missing'), MISSING)
  assert.equal(setByPath(doc, 'blocks[2].items[0].title', 'Question'), true)
  assert.equal(doc.blocks[2].items[0].title, 'Question')
})

test('gap detection', () => {
  assert.equal(evaluate('text', null, true).status, 'missing_null')
  assert.equal(evaluate('text', '   ', true).status, 'missing_empty')
  assert.equal(evaluate('text', 'ok', false).status, 'missing_row')
  assert.equal(evaluate('text', 'Titel', true).status, 'ok')
  const empty = { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: ' ' }] }] } }
  assert.equal(evaluate('richtext', empty, true).status, 'missing_empty')
  const mediaOnly = { root: { children: [{ type: 'upload', value: 1 }] } }
  assert.equal(evaluate('richtext', mediaOnly, true).status, 'empty_media_only')
})

test('normalization ignores spacing and unicode form', () => {
  assert.equal(normalize('  a  b \n c '), 'a b c')
  assert.equal(evaluate('text', 'Café', true).hash, evaluate('text', 'Café', true).hash)
})

// ---------------------------------------------------------------------------

/** A document as Payload returns it with `locale: 'all'` and `fallbackLocale: null`. */
const doc = {
  id: 1,
  updatedAt: '2026-09-14T10:00:00.000Z',
  _status: { nl: 'published', fr: 'draft' },
  title: { nl: 'Home', fr: 'Home' },
  slug: { nl: 'home', fr: 'accueil' },
  path: { nl: '/home', fr: '/accueil' },
  seo: { title: { nl: 'Home | Child Focus' }, image: {} },
  blocks: [
    {
      id: 'b1',
      blockType: 'faq',
      title: { nl: 'Veelgestelde vragen', fr: '' },
      subtitle: {},
      items: [
        {
          id: 'i1',
          title: { nl: 'Voor wie?', fr: 'Pour qui?' },
          content: {
            nl: { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Voor professionals.' }] }] } },
          },
        },
      ],
    },
    { id: 'b2', blockType: 'media', image: 4 },
  ],
  highlights: {
    nl: [{ id: 'h1', text: 'Eén' }, { id: 'h2', text: 'Twee' }],
    fr: [{ id: 'h3', text: 'Un' }],
  },
}

const units = collectUnits(tree, doc, ['nl', 'fr'])
const byPath = Object.fromEntries(units.map((u) => [u.path, u]))

test('collects one unit per localized leaf, with concrete indices', () => {
  assert.deepEqual(Object.keys(byPath).sort(), [
    'blocks[0].items[0].content',
    'blocks[0].items[0].title',
    'blocks[0].subtitle',
    'blocks[0].title',
    'highlights[0].text',
    'highlights[1].text',
    'path',
    'seo.image',
    'seo.title',
    'slug',
    'title',
  ])
})

test('reports the real gaps of the sample document', () => {
  assert.equal(byPath['seo.title'].values.nl.status, 'ok')
  assert.equal(byPath['seo.title'].values.fr.status, 'missing_row')
  assert.equal(byPath['blocks[0].title'].values.fr.status, 'missing_empty')
  assert.equal(byPath['blocks[0].subtitle'].values.nl.status, 'missing_row')
  assert.equal(byPath['blocks[0].items[0].content'].values.fr.status, 'missing_row')
  assert.equal(byPath['blocks[0].items[0].content'].values.nl.status, 'ok')
  assert.equal(byPath['blocks[0].items[0].content'].values.nl.preview, 'Voor professionals.')
})

test('a locale scoped array reports each locale on its own structure', () => {
  assert.equal(byPath['highlights[0].text'].localeScoped, true)
  assert.equal(byPath['highlights[0].text'].values.nl.status, 'ok')
  assert.equal(byPath['highlights[0].text'].values.fr.status, 'ok')
  // Dutch has two highlights, French has one.
  assert.equal(byPath['highlights[1].text'].values.nl.status, 'ok')
  assert.equal(byPath['highlights[1].text'].values.fr.status, 'missing_row')
})

test('the block that holds no localized field produces no unit', () => {
  assert.equal(units.some((u) => u.path.startsWith('blocks[1]')), false)
})

test('collects the raw values of one locale', () => {
  const single = {
    title: 'Home', slug: 'home', path: '/home',
    seo: { title: 'Home | Child Focus', image: null },
    blocks: [{ id: 'b1', blockType: 'faq', title: 'Veelgestelde vragen', subtitle: null, items: [{ id: 'i1', title: 'Voor wie?', content: null }] }],
    highlights: [{ id: 'h1', text: 'Eén' }],
  }
  const values = collectValues(tree, single)
  assert.equal(values['blocks[0].items[0].title'], 'Voor wie?')
  assert.equal(values['seo.title'], 'Home | Child Focus')
  assert.equal(values['highlights[0].text'], 'Eén')
})

test('an array row is named by its key field', () => {
  const fields = [
    {
      name: 'items',
      type: 'array',
      label: 'Teksten',
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'text', label: 'Waarde', localized: true },
      ],
    },
  ]
  const built = walkFields(fields, 'nl', false)
  const { containers } = describeTree(built)
  assert.equal(containers[0].titleField, 'key')

  const doc = {
    items: [
      { id: 'a', key: 'Navigation.search', value: { nl: 'Zoeken', en: '' } },
      { id: 'b', key: 'Form.send', value: { nl: 'Verstuur', en: 'Send' } },
    ],
  }
  const units = collectUnits(built, doc, ['nl', 'en'])
  assert.deepEqual(
    units.map((unit) => [unit.path, unit.rowTitle]),
    [
      ['items[0].value', 'Navigation.search'],
      ['items[1].value', 'Form.send'],
    ],
  )
  // The key itself is not translated, so it is not offered as work.
  assert.equal(units.some((unit) => unit.path.endsWith('.key')), false)
})

test('a field that is not translated is preferred as the row name', () => {
  const built = walkFields(
    [
      {
        name: 'items',
        type: 'array',
        fields: [
          { name: 'title', type: 'text', localized: true },
          { name: 'name', type: 'text' },
        ],
      },
    ],
    'nl',
    false,
  )
  // `name` wins over `title`: a key stays the same in every language.
  assert.equal(describeTree(built).containers[0].titleField, 'name')
})
