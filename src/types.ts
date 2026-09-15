/**
 * Wire types shared by the plugin and the Polyglot hub.
 * The hub imports these from `@studiomonty/payload-polyglot/types`.
 */

export type EntityKind = 'collection' | 'global'

/** A state of a document. `draft` reads the latest version row. */
export type DocState = 'published' | 'draft'

/**
 * Where Payload keeps the publication status.
 * `locale` means each locale has its own status.
 */
export type StatusScope = 'none' | 'doc' | 'locale'

/** The kind of a localized leaf field. Only `text` and `richtext` count for completion. */
export type LeafKind = 'text' | 'richtext' | 'relation' | 'select' | 'other'

/** The role of a field. `derived` fields are read-only: a project hook owns them. */
export type LeafRole = 'content' | 'seo' | 'slug' | 'derived'

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type LeafDescriptor = {
  /** Dotted path with array indices removed, e.g. `blocks[].items[].title`. */
  path: string
  name: string
  type: string
  label: string
  required: boolean
  kind: LeafKind
  role: LeafRole
  translatable: boolean
  /** Slug of the block this leaf belongs to, when it sits inside a blocks field. */
  blockSlug?: string
  /** Rich text only: the custom components this editor allows. */
  components?: ComponentDescriptor[]
}

export type ContainerDescriptor = {
  /** Template path of the container, e.g. `blocks[].items[]`. */
  path: string
  type: 'array' | 'blocks'
  label: string
  /**
   * True when the container itself carries `localized: true`.
   * The whole subtree is then stored once per locale, so its structure
   * can differ between locales.
   */
  localeScoped: boolean
  /** For a blocks field: the block types it accepts, with their labels. */
  blocks?: { slug: string; label: string }[]
  /** For an array: the child whose value names a row, such as `key`. */
  titleField?: string
}

export type EntityManifest = {
  kind: EntityKind
  slug: string
  label: string
  useAsTitle?: string
  adminGroup?: string
  drafts: false | { autosave: false | { interval: number } }
  statusScope: StatusScope
  /** Every localized leaf, in document order. This is the completion denominator. */
  leaves: LeafDescriptor[]
  containers: ContainerDescriptor[]
}

export type LocaleDescriptor = {
  code: string
  label: string
  fallbackLocale?: string | string[] | null
  rtl: boolean
}

export type Manifest = {
  polyglotVersion: string
  payloadVersion: string
  localization: {
    locales: LocaleDescriptor[]
    defaultLocale: string
    fallback: boolean
  }
  entities: EntityManifest[]
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type UnitStatus =
  /** A usable translation is present. */
  | 'ok'
  /** The containing row does not exist for this locale. */
  | 'missing_row'
  /** The value is null or undefined. */
  | 'missing_null'
  /** The value trims to nothing. */
  | 'missing_empty'
  /** Rich text with no text, but with an upload, a table or a rule. Not a gap. */
  | 'empty_media_only'

export type UnitValue = {
  status: UnitStatus
  /** SHA-256 of the normalized text. Absent when the value is missing. */
  hash?: string
  /** Character count of the normalized text. */
  len: number
  /** First 160 characters. The hub shows this; it never receives the full value. */
  preview?: string
}

/** One translatable field inside a custom lexical component. */
export type ComponentField = {
  /** Path inside the fields of the component, e.g. `link.label`, `items[].title`. */
  path: string
  label: string
  kind: LeafKind
}

/**
 * A custom component of the rich text editor: `inlineButton`, `inlineFaq`.
 *
 * Payload holds the definition, so the list of fields is what the project
 * itself declares. A component a project adds later needs no configuration.
 */
export type ComponentDescriptor = {
  slug: string
  label: string
  fields: ComponentField[]
}

export type ReportUnit = {
  /** Concrete path with real indices, e.g. `blocks[2].items[0].title`. */
  path: string
  /** Template path, matching `LeafDescriptor.path`. */
  template: string
  kind: LeafKind
  role: LeafRole
  label: string
  blockSlug?: string
  /** Set when this unit sits inside a custom component of a rich text field. */
  componentSlug?: string
  /** The rich text field that holds the component, so the hub can group them. */
  parentPath?: string
  /** What the row this field sits in is called, such as the key of a string. */
  rowTitle?: string
  /**
   * True when this path sits inside a locale-scoped container.
   * The hub must not compare structure across locales for these.
   */
  localeScoped: boolean
  values: Record<string, UnitValue>
}

export type ReportDoc = {
  id: string | number
  title: string
  updatedAt: string
  /** A string when `statusScope` is `doc`, a map when it is `locale`. */
  status: string | Record<string, string> | null
  units: ReportUnit[]
}

export type ReportResponse = {
  entity: { kind: EntityKind; slug: string }
  state: DocState
  locales: string[]
  page: number
  limit: number
  totalDocs: number
  totalPages: number
  docs: ReportDoc[]
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type ReadResponse = {
  id: string | number
  title: string
  updatedAt: string
  status: string | Record<string, string> | null
  sourceLocale: string
  /** The target locales in this answer, in config order. */
  targetLocales: string[]
  /** Full values of the source locale, keyed by concrete path. */
  source: Record<string, unknown>
  /** Full values per target locale. Rich text arrives as a lexical tree. */
  targets: Record<string, Record<string, unknown>>
  units: ReportUnit[]
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ApplyOp = {
  path: string
  value: unknown
  /** Hash of the value the hub believes is there now. */
  expectedHash?: string
}

export type ApplyRequest = {
  entity: { kind: EntityKind; slug: string }
  id?: string | number
  locale: string
  state: DocState
  ops: ApplyOp[]
  guard: { updatedAt: string }
  publish?: 'none' | 'locale' | 'all'
  /**
   * Whether the project should drop its caches after this write.
   *
   * A translation run writes one language after another. Every write would
   * otherwise throw away the pages of the site, and the first visitor after
   * each one waits for a rebuild. The caller sends `false` for every write but
   * the last of a document, so the site is rebuilt one time.
   *
   * The project decides what this means: the plugin only sets
   * `context.disableRevalidate`, which is the flag the Payload website
   * template and the Studio Monty kit already read in their hooks. A project
   * that does not read it keeps its own behaviour.
   *
   * Defaults to `true`, so a caller that says nothing loses no freshness.
   */
  revalidate?: boolean
}

/** Ask the project to drop the caches of one document, once. */
export type RefreshRequest = {
  entity: { kind: EntityKind; slug: string }
  id?: string | number
  state: DocState
}

export type RefreshResponse = { ok: true; updatedAt: string } | { ok: false; code: string; message: string }

export type ApplyResponse =
  | { ok: true; docId: string | number; updatedAt: string; applied: { path: string; newHash: string }[] }
  | {
      ok: false
      code: 'conflict'
      serverUpdatedAt: string
      conflicts: { path: string; serverHash: string }[]
    }
  | { ok: false; code: 'locked'; message: string; lockedBy?: string }
  | {
      ok: false
      code: 'not_found' | 'forbidden' | 'validation' | 'path_not_found' | 'error'
      message: string
      details?: unknown
    }
