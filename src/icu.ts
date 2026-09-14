/**
 * The named holes in a message.
 *
 * next-intl uses ICU message syntax, where `{query}` is replaced at render
 * time. A translation that loses one prints the braces to the reader, and a
 * translation that invents one throws. Both are caught by comparing the names
 * on each side.
 *
 * A plural or a select carries its own nested braces:
 *
 *   {count, plural, one {# werk} other {# werken}}
 *
 * Only the argument name counts, `count` here. The categories are not
 * compared, because a language decides its own: Dutch needs two, Polish needs
 * `few` and `many` as well.
 */
export function placeholdersOf(message: string): string[] {
  const found = new Set<string>()
  let depth = 0
  // Where the name of the argument now being read starts, or null between them.
  let nameStart: number | null = null

  for (let index = 0; index < message.length; index++) {
    const character = message[index]

    // A doubled brace is an escaped brace in ICU, not an argument.
    if ((character === '{' || character === '}') && message[index + 1] === character) {
      index += 1
      continue
    }

    if (character === '{') {
      depth += 1
      if (depth === 1) nameStart = index + 1
      continue
    }

    if (character === '}') {
      // Closing the outermost brace ends a plain `{name}`.
      if (depth === 1 && nameStart !== null) {
        const name = message.slice(nameStart, index).trim()
        if (name) found.add(name)
        nameStart = null
      }
      depth = Math.max(0, depth - 1)
      continue
    }

    // The name of a plural or a select runs up to its first comma. Anything
    // deeper is a category such as `one` or `other`, and is not an argument.
    if (depth === 1 && nameStart !== null && character === ',') {
      const name = message.slice(nameStart, index).trim()
      if (name) found.add(name)
      nameStart = null
    }
  }

  return [...found].sort()
}

/** True when the braces do not balance, which next-intl cannot parse at all. */
export function isMalformed(message: string): boolean {
  let depth = 0
  for (let index = 0; index < message.length; index++) {
    const character = message[index]
    if ((character === '{' || character === '}') && message[index + 1] === character) {
      index += 1
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth < 0) return true
    }
  }
  return depth !== 0
}

export type MessageProblem = {
  /**
   * `error` breaks the page, `warning` only looks wrong.
   *
   * Crowdin and Lokalise both grade a check this way: a warning can be saved
   * past, an error cannot. The grade here follows what next-intl actually
   * does at render.
   */
  level: 'error' | 'warning'
  /** The braces do not balance, so the message cannot be parsed. */
  malformed: boolean
  /** In the source but not in the translation. The value simply never appears. */
  missing: string[]
  /** In the translation but not in the source. Nothing supplies it, so it throws. */
  unknown: string[]
  message: string
}

/**
 * Check one translation against its source.
 *
 * An unbalanced brace or an invented placeholder stops the page, so both are
 * errors. A placeholder that was dropped only loses a word, so it is a
 * warning: sometimes a language genuinely reorders a sentence around it, and
 * the translator is the one who can tell.
 */
export function checkMessage(source: string, target: string): MessageProblem | null {
  if (!target) return null

  if (isMalformed(target)) {
    return {
      level: 'error',
      malformed: true,
      missing: [],
      unknown: [],
      message: 'the braces do not balance, so the text cannot be read',
    }
  }

  if (!source) return null
  const before = placeholdersOf(source)
  const after = placeholdersOf(target)
  const missing = before.filter((name) => !after.includes(name))
  const unknown = after.filter((name) => !before.includes(name))
  if (missing.length === 0 && unknown.length === 0) return null

  const named = (names: string[]) => names.map((name) => `{${name}}`).join(', ')
  const parts: string[] = []
  if (unknown.length > 0) parts.push(`nothing supplies ${named(unknown)}`)
  if (missing.length > 0) parts.push(`${named(missing)} is not used`)

  return {
    level: unknown.length > 0 ? 'error' : 'warning',
    malformed: false,
    missing,
    unknown,
    message: parts.join(', '),
  }
}

export type PlaceholderProblem = {
  /** In the source but not in the translation. The reader would see braces. */
  missing: string[]
  /** In the translation but not in the source. Rendering throws. */
  unknown: string[]
}

/** Compare the holes on each side. `null` when the translation is sound. */
export function comparePlaceholders(source: string, target: string): PlaceholderProblem | null {
  if (!source || !target) return null
  const before = placeholdersOf(source)
  const after = placeholdersOf(target)
  const missing = before.filter((name) => !after.includes(name))
  const unknown = after.filter((name) => !before.includes(name))
  return missing.length > 0 || unknown.length > 0 ? { missing, unknown } : null
}
