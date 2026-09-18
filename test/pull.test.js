import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pullStrings } from '../dist/strings/pull.js'

/** A project with one message folder, holding the tree given. */
async function project(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'polyglot-'))
  for (const [name, tree] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(name)), { recursive: true })
    await writeFile(path.join(root, name), `${JSON.stringify(tree, null, 2)}\n`)
  }
  return root
}

const readTree = async (root, name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))

/** The rows of the global, one language at a time. */
const rows = (byLocale) => async (locale) =>
  Object.entries(byLocale[locale] ?? {}).map(([key, value]) => ({ key, value }))

test('a translated text replaces the one in the file', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  const result = await pullStrings({
    read: rows({ nl: { 'Work.next': 'Verder' } }),
    locales: ['nl'],
    dirs: ['messages'],
    root,
  })

  assert.deepEqual(await readTree(root, 'messages/nl.json'), { Work: { next: 'Verder' } })
  assert.equal(result.changes.length, 1)
  assert.deepEqual(result.changes[0], {
    file: 'messages/nl.json',
    locale: 'nl',
    key: 'Work.next',
    from: 'Volgende',
    to: 'Verder',
  })
})

test('a key the file does not carry is never added', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  const result = await pullStrings({
    read: rows({ nl: { 'Work.next': 'Volgende', 'Work.brandNew': 'Nieuw' } }),
    locales: ['nl'],
    dirs: ['messages'],
    root,
  })

  assert.deepEqual(await readTree(root, 'messages/nl.json'), { Work: { next: 'Volgende' } })
  assert.deepEqual(result.unknown, ['Work.brandNew'])
  assert.equal(result.changes.length, 0)
})

test('an empty value never overwrites a default', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  await pullStrings({
    read: async () => [{ key: 'Work.next', value: '' }],
    locales: ['nl'],
    dirs: ['messages'],
    root,
  })

  assert.deepEqual(await readTree(root, 'messages/nl.json'), { Work: { next: 'Volgende' } })
})

test('a file that does not exist is not created', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  const result = await pullStrings({
    read: rows({ en: { 'Work.next': 'Next' } }),
    locales: ['en'],
    dirs: ['messages'],
    root,
  })

  await assert.rejects(() => readTree(root, 'messages/en.json'))
  assert.deepEqual(result.files, [])
  assert.deepEqual(result.unknown, ['Work.next'])
})

test('a key goes to the folder that already carries it', async () => {
  const root = await project({
    'kit/nl.json': { Form: { send: 'Verzenden' } },
    'messages/nl.json': { Work: { next: 'Volgende' } },
  })

  const result = await pullStrings({
    read: rows({ nl: { 'Form.send': 'Versturen', 'Work.next': 'Verder' } }),
    locales: ['nl'],
    dirs: ['kit', 'messages'],
    root,
  })

  assert.deepEqual(await readTree(root, 'kit/nl.json'), { Form: { send: 'Versturen' } })
  assert.deepEqual(await readTree(root, 'messages/nl.json'), { Work: { next: 'Verder' } })
  assert.deepEqual(result.files.sort(), ['kit/nl.json', 'messages/nl.json'])
})

test('a dry run reports and writes nothing', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  const result = await pullStrings({
    read: rows({ nl: { 'Work.next': 'Verder' } }),
    locales: ['nl'],
    dirs: ['messages'],
    root,
    dryRun: true,
  })

  assert.deepEqual(await readTree(root, 'messages/nl.json'), { Work: { next: 'Volgende' } })
  assert.equal(result.changes.length, 1)
  assert.deepEqual(result.files, ['messages/nl.json'])
})

test('a text that is already right is left alone', async () => {
  const root = await project({ 'messages/nl.json': { Work: { next: 'Volgende' } } })

  const result = await pullStrings({
    read: rows({ nl: { 'Work.next': 'Volgende' } }),
    locales: ['nl'],
    dirs: ['messages'],
    root,
  })

  assert.deepEqual(result.changes, [])
  assert.deepEqual(result.files, [])
  assert.deepEqual(result.unknown, [])
})

test('the shape of the file survives, and every language is written', async () => {
  const root = await project({
    'messages/nl.json': { Work: { next: 'Volgende', deep: { one: 'Een' } }, Menu: 'Menu' },
    'messages/en.json': { Work: { next: 'Next', deep: { one: 'One' } }, Menu: 'Menu' },
  })

  await pullStrings({
    read: rows({
      nl: { 'Work.deep.one': 'Eén' },
      en: { 'Work.next': 'Onward', Menu: 'Main menu' },
    }),
    locales: ['nl', 'en'],
    dirs: ['messages'],
    root,
  })

  assert.deepEqual(await readTree(root, 'messages/nl.json'), {
    Work: { next: 'Volgende', deep: { one: 'Eén' } },
    Menu: 'Menu',
  })
  assert.deepEqual(await readTree(root, 'messages/en.json'), {
    Work: { next: 'Onward', deep: { one: 'One' } },
    Menu: 'Main menu',
  })
})
