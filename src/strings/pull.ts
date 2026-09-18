import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { flattenMessages, type MessageTree, type StringItem } from './messages.js'

/**
 * Write the translated texts back into the JSON files of the project.
 *
 * The files slowly become a lie: an editor changes a word in the admin and the
 * file still holds the old one, so a developer reads text that is not on the
 * site. This closes that gap, and it does it as a diff that a person reads
 * before committing.
 *
 * Three rules keep it safe:
 *
 * - It merges. A key that is not already in a file is never added, so a key
 *   written this morning and not deployed yet cannot be deleted by a pull.
 * - It skips an empty value, so a cleared field never writes an empty string
 *   over a real default.
 * - It reads with no fallback, so an untranslated language stays untranslated
 *   instead of receiving the text of the default one.
 *
 * The third rule belongs to the caller: `read` must ask for one language and
 * refuse the fallback.
 */
export type PullStringsArgs = {
  /** The rows of the global in one language, read with no fallback. */
  read: (locale: string) => Promise<StringItem[]>
  /** Every language to write. */
  locales: string[]
  /** The folders that hold `<locale>.json`. A missing file is left alone. */
  dirs: string[]
  /** What the folders are relative to. Default the working directory. */
  root?: string
  /** Report the changes and write nothing. */
  dryRun?: boolean
}

export type PullChange = {
  file: string
  locale: string
  key: string
  from: string
  to: string
}

export type PullStringsResult = {
  changes: PullChange[]
  /** The files that were written, or that would be written under `dryRun`. */
  files: string[]
  /** Keys the global holds that no file carries. They are not written. */
  unknown: string[]
}

/** The key came from flattening this same tree, so every parent is there. */
function setAtPath(tree: MessageTree, key: string, value: string): void {
  const parts = key.split('.')
  const last = parts.pop()
  if (!last) return

  let target = tree
  for (const part of parts) target = target[part] as MessageTree
  target[last] = value
}

async function readTree(file: string): Promise<MessageTree | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as MessageTree
  } catch {
    // A language a project does not carry, or a folder it does not have.
    // Never create the file: the key list belongs to the code.
    return null
  }
}

export async function pullStrings({
  read,
  locales,
  dirs,
  root = process.cwd(),
  dryRun = false,
}: PullStringsArgs): Promise<PullStringsResult> {
  const changes: PullChange[] = []
  const files: string[] = []
  const unknown = new Set<string>()

  for (const locale of locales) {
    const translated = new Map<string, string>()
    for (const item of await read(locale)) {
      if (item?.key && item.value) translated.set(item.key, item.value)
    }

    const placed = new Set<string>()

    for (const dir of dirs) {
      const relative = path.join(dir, `${locale}.json`)
      const tree = await readTree(path.join(root, relative))
      if (!tree) continue

      let touched = false
      for (const [key, current] of Object.entries(flattenMessages(tree))) {
        const next = translated.get(key)
        if (next === undefined) continue

        placed.add(key)
        if (next === current) continue

        setAtPath(tree, key, next)
        changes.push({ file: relative, locale, key, from: current, to: next })
        touched = true
      }

      if (!touched) continue
      files.push(relative)
      if (!dryRun) await writeFile(path.join(root, relative), `${JSON.stringify(tree, null, 2)}\n`)
    }

    for (const key of translated.keys()) {
      if (!placed.has(key)) unknown.add(key)
    }
  }

  return { changes, files, unknown: [...unknown].sort() }
}
