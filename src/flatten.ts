import { evaluate } from './status.js'
import type { SchemaNode } from './schema.js'
import type { LeafKind, LeafRole, ReportUnit, UnitValue } from './types.js'

type AnyData = Record<string, any>

/**
 * Read a value at a concrete path such as `blocks[2].items[0].title`.
 * Returns the marker `MISSING` when any step of the path does not exist, so a
 * caller can tell "absent" apart from "present and null".
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

/** The first path segment. `payload.update` receives only these fields. */
export function topLevelField(path: string): string {
  const first = parsePath(path)[0]
  return typeof first === 'string' ? first : ''
}

// ---------------------------------------------------------------------------
// Collecting report units
// ---------------------------------------------------------------------------

type Draft = {
  path: string
  template: string
  kind: LeafKind
  role: LeafRole
  label: string
  blockSlug?: string
  localeScoped: boolean
  values: Record<string, UnitValue>
}

/**
 * `path` and `breadcrumbs` are written by the nested-docs plugin.
 * Polyglot reports them but never offers them for editing.
 */
function roleOf(name: string, path: string): LeafRole {
  if (name === 'path' || name === 'breadcrumbs' || path.startsWith('breadcrumbs')) return 'derived'
  if (name === 'slug') return 'slug'
  if (name.startsWith('seo') || path.startsWith('seo.') || path.startsWith('meta.')) return 'seo'
  return 'content'
}

/**
 * Walk a document that was read with `locale: 'all'` and produce one unit per
 * localized leaf.
 *
 * Payload returns a localized leaf as an object keyed by locale. When a whole
 * container carries `localized: true`, the locale key sits on the container
 * instead, and the structure below it can differ per locale. Both shapes are
 * handled here; `localeScoped` marks the second one for the hub.
 */
export function collectUnits(tree: SchemaNode[], doc: AnyData, locales: string[]): ReportUnit[] {
  const drafts = new Map<string, Draft>()

  const record = (draft: Omit<Draft, 'values'>, locale: string, value: UnitValue): void => {
    let existing = drafts.get(draft.path)
    if (!existing) {
      existing = { ...draft, values: {} }
      drafts.set(draft.path, existing)
    }
    existing.values[locale] = value
  }

  const visit = (
    nodes: SchemaNode[],
    data: unknown,
    path: string,
    template: string,
    blockSlug: string | undefined,
    localeCtx: string | null,
    scoped: boolean,
  ): void => {
    if (data === null || data === undefined || typeof data !== 'object') return
    const object = data as AnyData

    for (const node of nodes) {
      if (node.nodeKind === 'leaf') {
        if (!node.localized || node.name === '_status') continue
        const leafPath = path + node.name
        const leafTemplate = template + node.name
        const raw = object[node.name]
        const draft: Omit<Draft, 'values'> = {
          path: leafPath,
          template: leafTemplate,
          kind: node.kind,
          role: roleOf(node.name, leafTemplate),
          label: node.label,
          localeScoped: scoped,
        }
        if (blockSlug) draft.blockSlug = blockSlug

        if (localeCtx !== null) {
          // Inside a locale-scoped branch the value is already plain.
          record(draft, localeCtx, evaluate(node.kind, raw, node.name in object))
          continue
        }
        // Otherwise Payload returned an object keyed by locale.
        const byLocale = (raw ?? {}) as AnyData
        for (const locale of locales) {
          const present = raw !== null && raw !== undefined && locale in byLocale
          record(draft, locale, evaluate(node.kind, present ? byLocale[locale] : null, present))
        }
        continue
      }

      if (node.nodeKind === 'object') {
        const next = node.name ? object[node.name] : object
        const nextPath = node.name ? `${path}${node.name}.` : path
        const nextTemplate = node.name ? `${template}${node.name}.` : template
        if (node.localeBoundary && localeCtx === null) {
          const byLocale = (next ?? {}) as AnyData
          for (const locale of locales) {
            visit(node.children, byLocale[locale], nextPath, nextTemplate, blockSlug, locale, true)
          }
        } else {
          visit(node.children, next, nextPath, nextTemplate, blockSlug, localeCtx, scoped)
        }
        continue
      }

      // An array or a blocks field.
      const value = object[node.name]
      const nextScoped = scoped || node.localeBoundary

      const walkList = (list: unknown, locale: string | null) => {
        if (!Array.isArray(list)) return
        for (const [index, item] of list.entries()) {
          const itemPath = `${path}${node.name}[${index}].`
          const itemTemplate = `${template}${node.name}[].`
          if (node.nodeKind === 'array') {
            visit(node.children, item, itemPath, itemTemplate, blockSlug, locale, nextScoped)
          } else {
            const slug = String((item as AnyData)?.blockType ?? '')
            const block = node.blocks.find((b) => b.slug === slug)
            if (block) visit(block.children, item, itemPath, itemTemplate, block.slug, locale, nextScoped)
          }
        }
      }

      if (node.localeBoundary && localeCtx === null) {
        const byLocale = (value ?? {}) as AnyData
        for (const locale of locales) walkList(byLocale[locale], locale)
      } else {
        walkList(value, localeCtx)
      }
    }
  }

  visit(tree, doc, '', '', undefined, null, false)

  // A path that one locale produced and another did not means the row is absent.
  const units: ReportUnit[] = []
  for (const draft of drafts.values()) {
    for (const locale of locales) {
      if (!draft.values[locale]) draft.values[locale] = { status: 'missing_row', len: 0 }
    }
    units.push(draft as ReportUnit)
  }
  return units
}

/** Collect the raw values of every localized leaf for one locale. */
export function collectValues(tree: SchemaNode[], doc: AnyData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const visit = (nodes: SchemaNode[], data: unknown, path: string): void => {
    if (data === null || data === undefined || typeof data !== 'object') return
    const object = data as AnyData
    for (const node of nodes) {
      if (node.nodeKind === 'leaf') {
        if (node.localized) out[path + node.name] = object[node.name] ?? null
        continue
      }
      if (node.nodeKind === 'object') {
        visit(node.children, node.name ? object[node.name] : object, node.name ? `${path}${node.name}.` : path)
        continue
      }
      const list = object[node.name]
      if (!Array.isArray(list)) continue
      for (const [index, item] of list.entries()) {
        const itemPath = `${path}${node.name}[${index}].`
        if (node.nodeKind === 'array') {
          visit(node.children, item, itemPath)
        } else {
          const block = node.blocks.find((b) => b.slug === String((item as AnyData)?.blockType ?? ''))
          if (block) visit(block.children, item, itemPath)
        }
      }
    }
  }
  visit(tree, doc, '')
  return out
}
