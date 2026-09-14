import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describeTree, hasLocalizedLeaf, readLabel, resolveStatusScope, walkFields } from './schema.js'
import type { EntitySchema, SchemaNode } from './schema.js'
import type { EntityManifest, LocaleDescriptor, Manifest } from './types.js'

type AnyPayload = Record<string, any>

export const POLYGLOT_VERSION = '0.1.0'

/**
 * The version of the Payload package this project runs.
 * The package does not export `package.json`, so the file is found by walking
 * up from the resolved entry point.
 */
function payloadVersion(): string {
  const require = createRequire(import.meta.url)
  const roots: string[] = []
  try {
    roots.push(dirname(require.resolve('payload')))
  } catch {
    // The bundler may hide the module from a runtime resolve.
  }
  roots.push(process.cwd())

  for (const root of roots) {
    let dir = root
    for (let depth = 0; depth < 8; depth++) {
      for (const candidate of [join(dir, 'package.json'), join(dir, 'node_modules', 'payload', 'package.json')]) {
        try {
          if (!existsSync(candidate)) continue
          const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string }
          if (pkg.name === 'payload' && pkg.version) return pkg.version
        } catch {
          // A file that cannot be read is simply not the one we need.
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return 'unknown'
}

/** Locales that read right to left. The hub uses this to flip the editor. */
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps'])

export type PolyglotContext = {
  manifest: Manifest
  /** The walked field tree per entity, keyed by `<kind>:<slug>`. */
  trees: Map<string, SchemaNode[]>
  entities: Map<string, EntitySchema>
  locales: string[]
  defaultLocale: string
}

function describeLocales(localization: AnyPayload | false | undefined): {
  locales: LocaleDescriptor[]
  defaultLocale: string
  fallback: boolean
} {
  if (!localization) return { locales: [], defaultLocale: '', fallback: false }
  const raw = (localization.locales ?? []) as (string | AnyPayload)[]
  const locales = raw.map((entry) => {
    const code = typeof entry === 'string' ? entry : String(entry.code)
    const descriptor: LocaleDescriptor = {
      code,
      label: typeof entry === 'string' ? code : readLabel(entry.label, code),
      rtl: typeof entry === 'string' ? RTL_LOCALES.has(code) : Boolean(entry.rtl ?? RTL_LOCALES.has(code)),
    }
    if (typeof entry !== 'string' && entry.fallbackLocale !== undefined) {
      descriptor.fallbackLocale = entry.fallbackLocale
    }
    return descriptor
  })
  return {
    locales,
    defaultLocale: String(localization.defaultLocale ?? locales[0]?.code ?? ''),
    fallback: localization.fallback !== false,
  }
}

function draftsOf(versions: AnyPayload | undefined): false | { autosave: false | { interval: number } } {
  const drafts = versions?.drafts
  if (!drafts) return false
  const autosave = typeof drafts === 'object' ? drafts.autosave : false
  if (!autosave) return { autosave: false }
  return { autosave: { interval: Number(autosave?.interval ?? 800) } }
}

/**
 * Build the manifest from the sanitized Payload config.
 *
 * Every fact comes from the running Payload instance, so the plugin works the
 * same on Payload 3.39 and on 3.88 without a version check.
 */
export function buildContext(payload: AnyPayload, labelLanguage: string): PolyglotContext {
  const config = payload.config as AnyPayload
  const localization = describeLocales(config.localization)
  const localizationEnabled = localization.locales.length > 0

  const trees = new Map<string, SchemaNode[]>()
  const entities = new Map<string, EntitySchema>()
  const manifestEntities: EntityManifest[] = []

  const add = (kind: 'collection' | 'global', entity: AnyPayload) => {
    const slug = String(entity.slug)
    const tree = walkFields(entity.fields, labelLanguage, false)
    if (!hasLocalizedLeaf(tree)) return

    const { leaves, containers } = describeTree(tree)
    if (leaves.length === 0) return

    const manifest: EntityManifest = {
      kind,
      slug,
      label: readLabel(
        kind === 'collection' ? (entity.labels?.plural ?? entity.label) : entity.label,
        slug,
        labelLanguage,
      ),
      drafts: draftsOf(entity.versions),
      statusScope: resolveStatusScope(entity.fields),
      leaves,
      containers,
    }
    if (kind === 'collection' && typeof entity.admin?.useAsTitle === 'string') {
      manifest.useAsTitle = entity.admin.useAsTitle
    }
    if (typeof entity.admin?.group === 'string') manifest.adminGroup = entity.admin.group

    trees.set(`${kind}:${slug}`, tree)
    entities.set(`${kind}:${slug}`, { kind, slug, tree, manifest })
    manifestEntities.push(manifest)
  }

  for (const collection of (config.collections ?? []) as AnyPayload[]) add('collection', collection)
  for (const global of (config.globals ?? []) as AnyPayload[]) add('global', global)

  return {
    manifest: {
      polyglotVersion: POLYGLOT_VERSION,
      payloadVersion: payloadVersion(),
      localization: {
        locales: localization.locales,
        defaultLocale: localization.defaultLocale,
        fallback: localization.fallback,
      },
      entities: manifestEntities,
    },
    trees,
    entities,
    locales: localization.locales.map((l) => l.code),
    defaultLocale: localization.defaultLocale,
  }
}

/**
 * The context is derived from the config, which never changes while the process
 * runs. Building it once keeps every request cheap.
 */
export function cachedContext(payload: AnyPayload, labelLanguage: string): PolyglotContext {
  const store = payload as AnyPayload
  if (!store.__polyglotContext || store.__polyglotLabelLanguage !== labelLanguage) {
    store.__polyglotContext = buildContext(payload, labelLanguage)
    store.__polyglotLabelLanguage = labelLanguage
  }
  return store.__polyglotContext as PolyglotContext
}
