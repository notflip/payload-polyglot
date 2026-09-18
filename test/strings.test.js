import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stringsGlobal } from '../dist/strings/global.js'
import {
  flattenMessages,
  mergeMessages,
  messagesFromItems,
  polyglotMessages,
} from '../dist/strings/messages.js'
import { rowId } from '../dist/strings/sync.js'

test('a later source wins one key and leaves the rest of the namespace', () => {
  const merged = mergeMessages(
    { Navigation: { search: 'Zoeken', close: 'Sluiten' } },
    { Navigation: { search: 'Search' } },
  )
  assert.deepEqual(merged, { Navigation: { search: 'Search', close: 'Sluiten' } })
})

test('an array replaces, it does not merge', () => {
  assert.deepEqual(mergeMessages({ a: [1, 2] }, { a: [3] }), { a: [3] })
})

test('flatten walks the whole tree', () => {
  assert.deepEqual(flattenMessages({ Work: { nav: { next: 'Volgende' } }, Menu: 'Menu' }), {
    'Work.nav.next': 'Volgende',
    Menu: 'Menu',
  })
})

test('rows become a tree, and an empty value is not one', () => {
  const tree = messagesFromItems([
    { key: 'Work.next', value: 'Volgende' },
    { key: 'Work.previous', value: '' },
    { key: 'Menu', value: 'Menu' },
    { key: '', value: 'nowhere' },
    { key: 'Work.nested.deep', value: 'Diep' },
  ])
  assert.deepEqual(tree, {
    Work: { next: 'Volgende', nested: { deep: 'Diep' } },
    Menu: 'Menu',
  })
})

test('a key whose parent is a string does not throw', () => {
  const tree = messagesFromItems([
    { key: 'Menu', value: 'Menu' },
    { key: 'Menu.close', value: 'Sluiten' },
  ])
  assert.deepEqual(tree, { Menu: { close: 'Sluiten' } })
})

test('the global wins over the files', async () => {
  const messages = await polyglotMessages({
    files: [
      async () => ({ default: { Work: { next: 'Volgende', previous: 'Vorige' } } }),
      async () => ({ default: { Work: { next: 'Verder' } } }),
    ],
    overrides: async () => ({ items: [{ key: 'Work.previous', value: 'Terug' }] }),
  })
  assert.deepEqual(messages, { Work: { next: 'Verder', previous: 'Terug' } })
})

test('a file that does not exist is skipped', async () => {
  const messages = await polyglotMessages({
    files: [
      async () => {
        throw new Error('ENOENT')
      },
      async () => ({ default: { Menu: 'Menu' } }),
    ],
  })
  assert.deepEqual(messages, { Menu: 'Menu' })
})

test('a database that is unreachable leaves the files standing', async () => {
  const messages = await polyglotMessages({
    files: [async () => ({ default: { Menu: 'Menu' } })],
    overrides: async () => {
      throw new Error('ECONNREFUSED')
    },
  })
  assert.deepEqual(messages, { Menu: 'Menu' })
})

test('a module without a default export is read as the tree itself', async () => {
  assert.deepEqual(await polyglotMessages({ files: [async () => ({ Menu: 'Menu' })] }), {
    Menu: 'Menu',
  })
})

test('a row id follows from the key and never changes', () => {
  assert.equal(rowId('Work.next'), rowId('Work.next'))
  assert.notEqual(rowId('Work.next'), rowId('Work.previous'))
  assert.match(rowId('Work.next'), /^[0-9a-f]{24}$/)
})

test('the global carries a localized value and a key that is not', () => {
  const global = stringsGlobal()
  assert.equal(global.slug, 'translations')

  const items = global.fields[0]
  assert.equal(items.name, 'items')

  const [key, value] = items.fields
  assert.equal(key.localized, undefined)
  assert.equal(key.required, true)
  assert.equal(value.localized, true)
})

test('the options reach the global', () => {
  const hooks = { afterChange: [] }
  const global = stringsGlobal({
    slug: 'strings',
    hooks,
    labels: { global: 'Interface texts', key: 'Key' },
  })
  assert.equal(global.slug, 'strings')
  assert.equal(global.label, 'Interface texts')
  assert.equal(global.hooks, hooks)
  assert.equal(global.fields[0].fields[0].label, 'Key')
})
