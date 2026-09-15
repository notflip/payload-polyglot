import type {
  ComponentDescriptor,
  ContainerDescriptor,
  EntityKind,
  EntityManifest,
  LeafDescriptor,
  LeafKind,
  LeafRole,
  StatusScope,
} from './types.js'

/**
 * Payload field shapes, kept loose on purpose.
 * The plugin must run on every Payload version from 3.39 to 3.88, and the
 * exported field types changed several times in that range.
 */
type AnyField = Record<string, any>

/** A node of the walked field tree. The flattener uses the same tree. */
export type SchemaNode = LeafNode | ObjectNode | ArrayNode | BlocksNode

export type LeafNode = {
  nodeKind: 'leaf'
  name: string
  type: string
  label: string
  required: boolean
  kind: LeafKind
  role: LeafRole
  translatable: boolean
  /** The field itself carries `localized: true`. */
  localized: boolean
  /** Rich text only: what the editor allows to be embedded in the text. */
  components?: ComponentDescriptor[]
}

/** A group, a named tab, or a transparent wrapper (row, collapsible, unnamed tab). */
export type ObjectNode = {
  nodeKind: 'object'
  /** Absent for a transparent wrapper, which adds no path segment. */
  name?: string
  label: string
  /** The container carries `localized: true`: the whole subtree is per locale. */
  localeBoundary: boolean
  children: SchemaNode[]
}

export type ArrayNode = {
  nodeKind: 'array'
  name: string
  label: string
  localeBoundary: boolean
  children: SchemaNode[]
  /**
   * The child that names a row. A list of `{ key, value }` pairs reads as
   * "Value, Value, Value" without it.
   */
  titleField?: string
}

/**
 * Names that identify a row rather than describe it, best first. A field that
 * is not translated is preferred: a key stays the same in every language.
 */
const ROW_TITLE_NAMES = ['key', 'name', 'slug', 'label', 'title', 'heading', 'question']

function findTitleField(children: SchemaNode[]): string | undefined {
  const leaves = children.filter((node): node is LeafNode => node.nodeKind === 'leaf' && node.type === 'text')
  for (const preferLiteral of [true, false]) {
    for (const candidate of ROW_TITLE_NAMES) {
      const found = leaves.find((leaf) => leaf.name === candidate && leaf.localized !== preferLiteral)
      if (found) return found.name
    }
  }
  return undefined
}

export type BlocksNode = {
  nodeKind: 'blocks'
  name: string
  label: string
  localeBoundary: boolean
  blocks: { slug: string; label: string; children: SchemaNode[] }[]
}

/**
 * What a rich text editor allows to be embedded in the text.
 *
 * A project adds its own components to the editor: `inlineButton`, `inlineFaq`,
 * `inlineImage`. Payload sanitizes each one into a normal block, so its fields
 * are read with the same walker as every other field. Whatever the project
 * declares as text is therefore translatable, with no configuration here and
 * no list of known component names.
 *
 * The lexical adapter keeps them under the `blocks` feature. `blocks` holds
 * the block-level ones and `inlineBlocks` the ones that sit inside a sentence.
 */
function readComponents(field: AnyField, lang: string): ComponentDescriptor[] {
  const feature = field.editor?.editorConfig?.resolvedFeatureMap?.get?.('blocks')
  const props = feature?.sanitizedServerFeatureProps ?? feature?.sanitizedClientFeatureProps ?? {}
  const defs = [...(props.blocks ?? []), ...(props.inlineBlocks ?? [])] as AnyField[]

  const out: ComponentDescriptor[] = []
  for (const block of defs) {
    if (!block || typeof block !== 'object') continue
    // Everything inside a lexical tree belongs to the locale of that tree, so
    // the walk starts as localized.
    const { leaves } = describeTree(walkFields(block.fields, lang, true))
    const fields = leaves
      .filter((leaf) => leaf.translatable)
      .map((leaf) => ({ path: leaf.path, label: leaf.label, kind: leaf.kind }))
    if (fields.length === 0) continue
    out.push({
      slug: String(block.slug),
      label: readLabel(block.labels?.singular ?? block.label, String(block.slug), lang),
      fields,
    })
  }
  return out
}

const TRANSLATABLE_TYPES = new Set(['text', 'textarea', 'richText'])
const RELATION_TYPES = new Set(['relationship', 'upload', 'join'])
const CHOICE_TYPES = new Set(['select', 'radio'])
const TRANSPARENT_TYPES = new Set(['row', 'collapsible'])

/** Field types that hold no data and never appear in a document. */
const NON_DATA_TYPES = new Set(['ui'])

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Payload labels can be a string, `false`, or a map of language to string.
 * Prefer the given language, then English, then any entry, then the field name.
 */
export function readLabel(label: unknown, fallbackName: string, lang = 'nl'): string {
  if (typeof label === 'string' && label !== '') return label
  if (label && typeof label === 'object') {
    const map = label as Record<string, unknown>
    for (const key of [lang, 'en', ...Object.keys(map)]) {
      const value = map[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return humanize(fallbackName)
}

function classifyLeaf(field: AnyField): { kind: LeafKind; translatable: boolean } {
  const type = String(field.type)
  if (type === 'richText') return { kind: 'richtext', translatable: true }
  if (TRANSLATABLE_TYPES.has(type)) return { kind: 'text', translatable: true }
  if (RELATION_TYPES.has(type)) return { kind: 'relation', translatable: false }
  if (CHOICE_TYPES.has(type)) return { kind: 'select', translatable: false }
  return { kind: 'other', translatable: false }
}

/**
 * `path` and `breadcrumbs` are written by the nested-docs plugin.
 * Polyglot reports them but never writes them: a hook owns the value.
 */
function classifyRole(name: string, path: string): LeafRole {
  if (name === 'path' || name === 'breadcrumbs' || path.startsWith('breadcrumbs')) return 'derived'
  if (name === 'slug') return 'slug'
  if (name.startsWith('seo') || path.startsWith('meta.') || path.startsWith('seo.')) return 'seo'
  return 'content'
}

/**
 * Walk a list of Payload fields into a tree.
 * `inheritedLocalized` is true once an ancestor container is localized: every
 * descendant is then stored per locale, whether or not it says so itself.
 */
export function walkFields(
  fields: AnyField[] | undefined,
  lang: string,
  inheritedLocalized: boolean,
): SchemaNode[] {
  const nodes: SchemaNode[] = []
  for (const field of fields ?? []) {
    const type = String(field?.type ?? '')
    if (!type || NON_DATA_TYPES.has(type)) continue

    if (TRANSPARENT_TYPES.has(type)) {
      nodes.push({
        nodeKind: 'object',
        label: readLabel(field.label, type, lang),
        localeBoundary: false,
        children: walkFields(field.fields, lang, inheritedLocalized),
      })
      continue
    }

    if (type === 'tabs') {
      for (const tab of (field.tabs ?? []) as AnyField[]) {
        const localized = Boolean(tab?.localized) && !inheritedLocalized
        const node: ObjectNode = {
          nodeKind: 'object',
          label: readLabel(tab?.label, String(tab?.name ?? 'tab'), lang),
          localeBoundary: localized,
          children: walkFields(tab?.fields, lang, inheritedLocalized || localized),
        }
        // A tab without a name is transparent: its fields sit on the parent.
        if (typeof tab?.name === 'string' && tab.name !== '') node.name = tab.name
        nodes.push(node)
      }
      continue
    }

    const name = typeof field.name === 'string' ? field.name : ''
    if (name === '') continue

    const localized = Boolean(field.localized) && !inheritedLocalized

    if (type === 'group') {
      nodes.push({
        nodeKind: 'object',
        name,
        label: readLabel(field.label, name, lang),
        localeBoundary: localized,
        children: walkFields(field.fields, lang, inheritedLocalized || localized),
      })
      continue
    }

    if (type === 'array') {
      const children = walkFields(field.fields, lang, inheritedLocalized || localized)
      const node: ArrayNode = {
        nodeKind: 'array',
        name,
        label: readLabel(field.label, name, lang),
        localeBoundary: localized,
        children,
      }
      const titleField = findTitleField(children)
      if (titleField) node.titleField = titleField
      nodes.push(node)
      continue
    }

    if (type === 'blocks') {
      // Payload 3.6+ allows `blockReferences` next to `blocks`.
      const defs = [...(field.blocks ?? []), ...(field.blockReferences ?? [])] as AnyField[]
      nodes.push({
        nodeKind: 'blocks',
        name,
        label: readLabel(field.label, name, lang),
        localeBoundary: localized,
        blocks: defs
          .filter((b) => b && typeof b === 'object')
          .map((b) => ({
            slug: String(b.slug),
            label: readLabel(b.labels?.singular ?? b.label, String(b.slug), lang),
            children: walkFields(b.fields, lang, inheritedLocalized || localized),
          })),
      })
      continue
    }

    const { kind, translatable } = classifyLeaf(field)
    const components = type === 'richText' ? readComponents(field, lang) : []
    nodes.push({
      nodeKind: 'leaf',
      ...(components.length > 0 ? { components } : {}),
      name,
      type,
      label: readLabel(field.label, name, lang),
      required: Boolean(field.required),
      kind,
      translatable,
      role: 'content',
      localized: localized || inheritedLocalized,
    })
  }
  return nodes
}

/** Flatten the tree into the template paths that go into the manifest. */
export function describeTree(nodes: SchemaNode[]): {
  leaves: LeafDescriptor[]
  containers: ContainerDescriptor[]
} {
  const leaves: LeafDescriptor[] = []
  const containers: ContainerDescriptor[] = []

  const visit = (
    list: SchemaNode[],
    prefix: string,
    blockSlug: string | undefined,
    localeScoped: boolean,
  ) => {
    for (const node of list) {
      if (node.nodeKind === 'leaf') {
        // A leaf only reaches the manifest when it is stored per locale.
        if (!node.localized) continue
        // Payload injects `_status` and an `id` on every array row.
        // Neither is content.
        if (node.name === '_status' || node.name === 'id') continue
        const path = prefix + node.name
        const role = classifyRole(node.name, path)
        const descriptor: LeafDescriptor = {
          path,
          name: node.name,
          type: node.type,
          label: node.label,
          required: node.required,
          kind: node.kind,
          role,
          translatable: node.translatable && role !== 'derived',
        }
        if (blockSlug) descriptor.blockSlug = blockSlug
        if (node.components) descriptor.components = node.components
        leaves.push(descriptor)
        continue
      }

      const scoped = localeScoped || node.localeBoundary

      if (node.nodeKind === 'object') {
        const next = node.name ? `${prefix}${node.name}.` : prefix
        visit(node.children, next, blockSlug, scoped)
        continue
      }

      const before = leaves.length
      if (node.nodeKind === 'array') {
        visit(node.children, `${prefix}${node.name}[].`, blockSlug, scoped)
      } else {
        for (const block of node.blocks) {
          visit(block.children, `${prefix}${node.name}[${block.slug}].`, block.slug, scoped)
        }
      }
      if (leaves.length > before) {
        const container: ContainerDescriptor = {
          path: `${prefix}${node.name}[]`,
          type: node.nodeKind === 'array' ? 'array' : 'blocks',
          label: node.label,
          localeScoped: scoped,
        }
        if (node.nodeKind === 'blocks') {
          container.blocks = node.blocks.map((block) => ({ slug: block.slug, label: block.label }))
        }
        if (node.nodeKind === 'array' && node.titleField) container.titleField = node.titleField
        containers.push(container)
      }
    }
  }

  visit(nodes, '', undefined, false)
  return { leaves, containers }
}

/** True when the tree holds at least one localized leaf. */
export function hasLocalizedLeaf(nodes: SchemaNode[]): boolean {
  for (const node of nodes) {
    if (node.nodeKind === 'leaf') {
      if (node.localized) return true
    } else if (node.nodeKind === 'blocks') {
      if (node.localeBoundary) return true
      if (node.blocks.some((b) => hasLocalizedLeaf(b.children))) return true
    } else {
      if (node.localeBoundary) return true
      if (hasLocalizedLeaf(node.children)) return true
    }
  }
  return false
}

/**
 * Where Payload keeps the publication status.
 *
 * Payload injects a `_status` field into the sanitized config when drafts are
 * on, and marks it `localized: true` when the entity holds a localized field.
 * Reading that injected field is runtime truth, so the plugin never has to
 * compare Payload version numbers.
 */
export function resolveStatusScope(fields: AnyField[] | undefined): StatusScope {
  const status = (fields ?? []).find((f) => f?.name === '_status')
  if (!status) return 'none'
  return status.localized ? 'locale' : 'doc'
}

export type EntitySchema = {
  kind: EntityKind
  slug: string
  tree: SchemaNode[]
  manifest: EntityManifest
}
