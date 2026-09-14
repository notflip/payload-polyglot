import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMessage, comparePlaceholders, placeholdersOf, tagsOf } from '../dist/icu.js'

test('finds a plain placeholder', () => {
  assert.deepEqual(placeholdersOf('Geen werk gevonden voor “{query}”'), ['query'])
  assert.deepEqual(placeholdersOf('{field} is verplicht'), ['field'])
  assert.deepEqual(placeholdersOf('PAST. The exhibition ran until {date}'), ['date'])
})

test('finds no placeholder in plain text', () => {
  assert.deepEqual(placeholdersOf('Menu sluiten'), [])
})

test('takes only the argument name of a plural', () => {
  assert.deepEqual(placeholdersOf('{count, plural, one {# werk} other {# werken}}'), ['count'])
  assert.deepEqual(
    placeholdersOf('{name} heeft {count, plural, one {# bericht} other {# berichten}}'),
    ['count', 'name'],
  )
})

test('takes only the argument name of a select', () => {
  assert.deepEqual(placeholdersOf('{gender, select, male {hij} female {zij} other {hen}}'), ['gender'])
})

test('an escaped brace is not a placeholder', () => {
  assert.deepEqual(placeholdersOf('Gebruik {{ en }} om een accolade te tonen'), [])
})

test('a translation that drops a placeholder is caught', () => {
  const problem = comparePlaceholders('Geen werk gevonden voor “{query}”', 'No work found')
  assert.deepEqual(problem, { missing: ['query'], unknown: [] })
})

test('a translation that invents a placeholder is caught', () => {
  const problem = comparePlaceholders('{field} is verplicht', '{fields} is required')
  assert.deepEqual(problem, { missing: ['field'], unknown: ['fields'] })
})

test('a sound translation reports nothing', () => {
  assert.equal(comparePlaceholders('{field} is verplicht', '{field} is required'), null)
  assert.equal(comparePlaceholders('Menu sluiten', 'Close menu'), null)
})

test('a plural may change its categories between languages', () => {
  // Dutch has two categories, Polish has four. Only the name is compared.
  assert.equal(
    comparePlaceholders(
      '{count, plural, one {# werk} other {# werken}}',
      '{count, plural, one {# praca} few {# prace} many {# prac} other {# pracy}}',
    ),
    null,
  )
})

test('an unbalanced brace is an error', () => {
  const problem = checkMessage('{field} is verplicht', '{field is required')
  assert.equal(problem.level, 'error')
  assert.equal(problem.malformed, true)
})

test('an invented placeholder is an error, because nothing supplies it', () => {
  const problem = checkMessage('{field} is verplicht', '{fields} is required')
  assert.equal(problem.level, 'error')
  assert.deepEqual(problem.unknown, ['fields'])
})

test('a dropped placeholder is a warning, not an error', () => {
  const problem = checkMessage('Geen werk gevonden voor “{query}”', 'No work found')
  assert.equal(problem.level, 'warning')
  assert.deepEqual(problem.missing, ['query'])
})

test('a sound translation reports nothing', () => {
  assert.equal(checkMessage('{field} is verplicht', '{field} is required'), null)
  assert.equal(checkMessage('Menu sluiten', 'Close menu'), null)
  assert.equal(checkMessage('Gebruik {{ }} zo', 'Use {{ }} like this'), null)
})

test('an empty translation is not a problem: it is simply missing', () => {
  assert.equal(checkMessage('{field} is verplicht', ''), null)
})

test('a rich text tag is found and balanced', () => {
  assert.deepEqual(tagsOf('Lees onze <link>voorwaarden</link>'), { names: ['link'], balanced: true })
  assert.deepEqual(tagsOf('<important><very>heel</very> belangrijk</important>').names, ['important', 'very'])
  assert.equal(tagsOf('<important><very>heel</very> belangrijk</important>').balanced, true)
})

test('a tag closed in the wrong order is not balanced', () => {
  assert.equal(tagsOf('<a><b>tekst</a></b>').balanced, false)
  assert.equal(tagsOf('<link>tekst').balanced, false)
})

test('a stray angle bracket in plain text is not a tag', () => {
  assert.deepEqual(tagsOf('a < b en c > d'), { names: [], balanced: true })
  assert.equal(checkMessage('a < b', 'a < b'), null)
})

test('a self closing tag still needs its closing tag', () => {
  // The parser asks for one, so `<br></br>` is what a message holds.
  assert.deepEqual(tagsOf('Hallo,<br></br>hoe gaat het?'), { names: ['br'], balanced: true })
})

test('losing a tag is a warning', () => {
  const problem = checkMessage('Lees onze <link>voorwaarden</link>', 'Read our terms')
  assert.equal(problem.level, 'warning')
  assert.deepEqual(problem.missing, ['link'])
})

test('inventing a tag is an error, because nothing supplies it', () => {
  const problem = checkMessage('Lees onze <link>voorwaarden</link>', 'Read our <terms>terms</terms>')
  assert.equal(problem.level, 'error')
  assert.deepEqual(problem.unknown, ['terms'])
})

test('a tag that only moves is fine', () => {
  assert.equal(
    checkMessage('Lees onze <link>voorwaarden</link> nu', 'Now read <link>our terms</link>'),
    null,
  )
})

test('tags and placeholders are checked together', () => {
  const problem = checkMessage(
    'Geen werk gevonden voor <b>{query}</b>',
    'No work found for {query}',
  )
  assert.equal(problem.level, 'warning')
  assert.deepEqual(problem.missing, ['b'])
})
