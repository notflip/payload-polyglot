import { componentUnits, getComponentValue } from './lexical.js'
import { getByPath, MISSING, parsePath, setByPath } from './path.js'
import { evaluate } from './status.js'
import type { SchemaNode } from './schema.js'
import type { ComponentDescriptor, LeafKind, LeafRole, ReportUnit, UnitValue } from './types.js'

type AnyData = Record<string, any>

export { getByPath, MISSING, parsePath, setByPath }

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
  componentSlug?: string
  parentPath?: string
  rowTitle?: string
  localeScoped: boolean
  values: Record<string, UnitValue>
}

/**
 * The value that names a row. A field read with `locale: 'all'` arrives as a
 * map, so the first entry is taken: a key is the same in every language.
 */
function readTitle(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && entry !== '') return entry
    }
  }
  return undefined
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
export function collectUnits(
  tree: SchemaNode[],
  doc: AnyData,
  locales: string[],
  sourceLocale?: string,
): ReportUnit[] {
  const source = sourceLocale ?? locales[0] ?? ''
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
    rowTitle?: string,
  ): void => {
    if (data === null || data === undefined || typeof data !== 'object') return
    const object = data as AnyData

    for (const node of nodes) {
      if (node.nodeKind === 'leaf') {
        if (!node.localized || node.name === '_status' || node.name === 'id') continue
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
        if (rowTitle) draft.rowTitle = rowTitle

        if (localeCtx !== null) {
          // Inside a locale-scoped branch the value is already plain.
          record(draft, localeCtx, evaluate(node.kind, raw, node.name in object))
          if (node.components) components({ [localeCtx]: raw }, [localeCtx], node.components, draft)
          continue
        }
        // Otherwise Payload returned an object keyed by locale.
        const byLocale = (raw ?? {}) as AnyData
        for (const locale of locales) {
          const present = raw !== null && raw !== undefined && locale in byLocale
          record(draft, locale, evaluate(node.kind, present ? byLocale[locale] : null, present))
        }
        if (node.components) components(byLocale, locales, node.components, draft)
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
          visit(node.children, next, nextPath, nextTemplate, blockSlug, localeCtx, scoped, rowTitle)
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
          if (node.nodeKind === 'array') {
            // The row is named by one of its own fields, so the reader sees the
            // key of a string rather than "Value" repeated down the list.
            const title = node.titleField ? readTitle((item as AnyData)?.[node.titleField]) : undefined
            visit(node.children, item, itemPath, `${template}${node.name}[].`, blockSlug, locale, nextScoped, title)
          } else {
            const slug = String((item as AnyData)?.blockType ?? '')
            const block = node.blocks.find((b) => b.slug === slug)
            // The template carries the block slug, so two blocks that both have
            // a `title` do not collapse into one path.
            if (block) {
              visit(block.children, item, itemPath, `${template}${node.name}[${slug}].`, block.slug, locale, nextScoped, rowTitle)
            }
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

  /**
   * The text that stands inside a custom component of a rich text field.
   *
   * The source locale says which components are there and how many rows they
   * hold. A target locale whose tree has a different shape reports the row as
   * absent rather than writing into the wrong place.
   */
  function components(
    trees: AnyData,
    inLocales: string[],
    descriptors: ComponentDescriptor[],
    parent: Omit<Draft, 'values'>,
  ): void {
    const base = trees[source] ?? trees[inLocales.find((locale) => trees[locale]) ?? '']
    for (const unit of componentUnits(base, descriptors)) {
      const draft: Omit<Draft, 'values'> = {
        path: parent.path + unit.suffix,
        template: `${parent.template}#${unit.template}`,
        kind: unit.kind,
        role: 'content',
        label: unit.fieldLabel,
        componentSlug: unit.slug,
        parentPath: parent.path,
        rowTitle: unit.label,
        localeScoped: parent.localeScoped,
      }
      for (const locale of inLocales) {
        const value = getComponentValue(trees[locale], unit.addr, unit.field)
        record(draft, locale, evaluate(unit.kind, value === MISSING ? null : value, value !== MISSING))
      }
    }
  }

  visit(tree, doc, '', '', undefined, null, false, undefined)

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
        if (node.localized && node.name !== '_status' && node.name !== 'id') {
          out[path + node.name] = object[node.name] ?? null
        }
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
