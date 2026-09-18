/**
 * The interface strings of a project: the fixed words of buttons, labels and
 * messages.
 *
 * A key is born in a JSON file, because the code that reads it ships in the
 * same commit. The translated text lives in Payload, so an editor changes it
 * without a deploy. `polyglotMessages` lays the second over the first on the
 * request.
 *
 * Every step fails softly. A language without a file and a database that is
 * not reachable both leave the site standing, because the files carry every
 * key and one of them is always the language the project is written in.
 */

export type MessageTree = Record<string, unknown>

/** One row of the strings global. */
export type StringItem = { key?: string | null; value?: string | null }

/** A module that holds a message tree, as `import()` returns it. */
export type MessageSource = () => Promise<{ default: MessageTree } | MessageTree>

export type PolyglotMessagesArgs = {
  /** The files, in rising order of precedence. A later file wins a key. */
  files?: MessageSource[]
  /** Reads the strings global in one locale. It wins over every file. */
  overrides?: () => Promise<{ items?: StringItem[] | null } | null | undefined>
}

function isTree(value: unknown): value is MessageTree {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Lay one message tree over another, key by key.
 *
 * A plain spread replaces a whole namespace, so an override of one key inside
 * `Navigation` would drop the rest of it.
 */
export function mergeMessages(...sources: MessageTree[]): MessageTree {
  const out: MessageTree = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const existing = out[key]
      out[key] = isTree(value) && isTree(existing) ? mergeMessages(existing, value) : value
    }
  }
  return out
}

/** `{ Navigation: { search: 'Zoeken' } }` becomes `{ 'Navigation.search': 'Zoeken' }`. */
export function flattenMessages(source: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else if (isTree(value)) Object.assign(out, flattenMessages(value, path))
  }
  return out
}

/** The rows of the global, back into the tree that next-intl reads. */
export function messagesFromItems(items: StringItem[] | null | undefined): MessageTree {
  const out: MessageTree = {}

  for (const item of items ?? []) {
    const key = item?.key
    const value = item?.value
    if (!key || !value) continue

    const parts = key.split('.')
    const last = parts.pop()
    if (!last) continue

    let target = out
    for (const part of parts) {
      if (!isTree(target[part])) target[part] = {}
      target = target[part] as MessageTree
    }
    target[last] = value
  }

  return out
}

/** Every source of one locale, merged in order. */
export async function polyglotMessages({
  files = [],
  overrides,
}: PolyglotMessagesArgs): Promise<MessageTree> {
  const trees: MessageTree[] = []

  for (const load of files) {
    try {
      const loaded = await load()
      trees.push(((loaded as { default?: MessageTree }).default ?? loaded) as MessageTree)
    } catch {
      // A language without a file must not take the site down. Another file,
      // or the global, may still carry the key.
    }
  }

  if (overrides) {
    try {
      trees.push(messagesFromItems((await overrides())?.items))
    } catch {
      // The database is not reachable. The files already carry every key.
    }
  }

  return mergeMessages(...trees)
}
