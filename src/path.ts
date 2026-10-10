/**
 * Reading and writing a value at a dotted path, such as
 * `blocks[2].items[0].title`.
 *
 * Kept apart from the rest so both the document flattener and the rich text
 * reader can use it without importing each other.
 */

export const MISSING = Symbol('missing')

export function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = []
  for (const chunk of path.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(chunk)
    if (!match) {
      parts.push(chunk)
      continue
    }
    parts.push(match[1]!)
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) parts.push(Number(index[1]))
  }
  return parts
}

export function getByPath(data: unknown, path: string): unknown | typeof MISSING {
  let current: any = data
  for (const part of parsePath(path)) {
    if (current === null || current === undefined) return MISSING
    if (
      typeof part === 'number'
        ? !Array.isArray(current) || part >= current.length
        : typeof current !== 'object' || !(part in current)
    ) {
      return MISSING
    }
    current = current[part]
  }
  return current
}

export function setByPath(data: Record<string, any>, path: string, value: unknown): boolean {
  const parts = parsePath(path)
  const last = parts.pop()
  let current: any = data
  for (const part of parts) {
    if (current === null || current === undefined) return false
    current = current[part]
  }
  if (last === undefined || current === null || typeof current !== 'object') return false
  current[last] = value
  return true
}

