/**
 * Reading and writing a value at a dotted path, such as
 * `blocks[2].items[0].title`.
 *
 * Kept apart from the rest so both the document flattener and the rich text
 * reader can use it without importing each other.
 */

type AnyData = Record<string, any>

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
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length) return MISSING
      current = current[part]
    } else {
      if (typeof current !== 'object' || !(part in current)) return MISSING
      current = current[part]
    }
  }
  return current
}

export function setByPath(data: AnyData, path: string, value: unknown): boolean {
  const parts = parsePath(path)
  let current: any = data
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (current === null || current === undefined) return false
    current = typeof part === 'number' ? current?.[part] : current?.[part]
  }
  const last = parts[parts.length - 1]
  if (last === undefined || current === null || typeof current !== 'object') return false
  current[last as any] = value
  return true
}

