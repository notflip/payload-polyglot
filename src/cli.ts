#!/usr/bin/env node
import { pullStrings } from './strings/pull.js'
import type { StringItem } from './strings/messages.js'

/**
 * `polyglot-pull` — write the translated interface texts back into the JSON
 * files of the project.
 *
 * It reads the global over the REST API of the site, so it needs no database
 * and no Payload instance. Point it at production: that is where the texts an
 * editor wrote actually live.
 *
 * ```bash
 * pnpm exec polyglot-pull --url https://example.com --locales nl,en --dirs messages
 * git diff messages/
 * ```
 *
 * Run it when you start work, never when you finish. A pull at the end would
 * meet the keys you just wrote, which production does not have yet.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]

  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const url = (flag('url') ?? process.env.POLYGLOT_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '')
  .trim()
  .replace(/\/$/, '')
const locales = list(flag('locales'))
const dirs = list(flag('dirs') ?? 'messages')
const slug = flag('slug') ?? 'translations'
const key = flag('key') ?? process.env.POLYGLOT_API_KEY
const dryRun = process.argv.includes('--dry')

if (!url || locales.length === 0) {
  console.error('usage: polyglot-pull --url <site> --locales nl,en [--dirs messages,src/kit/messages]')
  console.error('       [--slug translations] [--key <payload api key>] [--dry]')
  process.exit(1)
}

/**
 * `fallback-locale=null` is the rule that matters. Without it a project with
 * the fallback on hands back the text of the default language for every
 * untranslated key, and the pull would write that into the other file as if
 * someone had translated it.
 */
async function read(locale: string): Promise<StringItem[]> {
  const address = `${url}/api/globals/${slug}?locale=${locale}&depth=0&fallback-locale=null`
  const response = await fetch(address, {
    headers: key ? { Authorization: `users API-Key ${key}` } : {},
  })

  if (!response.ok) {
    throw new Error(`${address} answered ${response.status}`)
  }

  const body = (await response.json()) as { items?: StringItem[] | null }
  return body.items ?? []
}

const result = await pullStrings({ read, locales, dirs, dryRun })

for (const change of result.changes) {
  console.log(`${change.file}  ${change.key}`)
  console.log(`  - ${change.from}`)
  console.log(`  + ${change.to}`)
}

if (result.unknown.length > 0) {
  console.log(`\n${result.unknown.length} keys in Payload that no file carries, left alone:`)
  console.log(`  ${result.unknown.join(', ')}`)
}

console.log(
  result.changes.length === 0
    ? '\nThe files already hold every translation.'
    : `\n${result.changes.length} texts in ${result.files.length} files${dryRun ? ' (nothing written)' : ''}.`,
)
if (!dryRun && result.changes.length > 0) console.log('Read the diff before you commit it.')
