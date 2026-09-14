import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMessage, comparePlaceholders, placeholdersOf } from '../dist/icu.js'

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
