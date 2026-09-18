import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { flattenMessages, type MessageTree } from './messages.js'
import { rowId } from './rowId.js'

type AnyPayload = Record<string, any>

export type SyncStringsArgs = {
  payload: AnyPayload
  /** The language the files are written in. This script writes only this one. */
  locale: string
  /** Folders that hold `<locale>.json`, in rising order of precedence. */
  dirs: string[]
  /** Slug of the global. Default `translations`. */
  slug?: string
  /** What the folders are relative to. Default the working directory. */
  root?: string
}

export type SyncStringsResult = {
  /** Every key the global holds after the write. */
  total: number
  added: string[]
  /** Keys that left the code. They are gone from the global too. */
  removed: string[]
}

async function readTree(file: string): Promise<MessageTree> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as MessageTree
  } catch {
    // The folders are a list of places to look. A project is free to have
    // only one of them, and a language is free to have no file at all.
    return {}
  }
}

/**
 * Copy the keys of the JSON files into the strings global.
 *
 * A project that passes `defaults` to `stringsGlobal` needs none of this: the
 * global fills itself on read. This stays for a project that does not.
 *
 * The files own the list of keys. This carries them, and their text in the
 * language they are written in, into Payload so they can be translated.
 *
 * It never overwrites a text that is already there, and it touches no language
 * but the one given. A key that left the code leaves the global with it.
 */
export async function syncStrings({
  payload,
  locale,
  dirs,
  slug = 'translations',
  root = process.cwd(),
}: SyncStringsArgs): Promise<SyncStringsResult> {
  const fromFiles: Record<string, string> = {}
  for (const dir of dirs) {
    Object.assign(fromFiles, flattenMessages(await readTree(path.join(root, dir, `${locale}.json`))))
  }

  const current = (await payload.findGlobal({
    slug,
    locale,
    depth: 0,
    overrideAccess: true,
  })) as { items?: { id?: string; key?: string; value?: string }[] }

  const existing = new Map(
    (current.items ?? [])
      .filter((item) => item.key)
      .map((item) => [item.key as string, item] as const),
  )

  // A row that is already there keeps its id, so the texts translated into
  // every other language stay attached to it.
  const items = Object.entries(fromFiles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const found = existing.get(key)
      return found ? { ...found, key, value: found.value ?? value } : { id: rowId(key), key, value }
    })

  await payload.updateGlobal({ slug, locale, depth: 0, overrideAccess: true, data: { items } })

  return {
    total: items.length,
    added: items.filter((item) => !existing.has(item.key)).map((item) => item.key),
    removed: [...existing.keys()].filter((key) => !(key in fromFiles)),
  }
}
