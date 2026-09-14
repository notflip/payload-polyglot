import { cachedContext } from '../context.js'
import { collectUnits } from '../flatten.js'
import type { DocState, EntityKind, ReportDoc, ReportResponse } from '../types.js'
import { guard, json, query, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>
type AnyData = Record<string, any>

const MAX_LIMIT = 100

/** A readable name for a document, for the hub tables. */
function titleOf(doc: AnyData, useAsTitle: string | undefined, defaultLocale: string): string {
  const raw = useAsTitle ? doc[useAsTitle] : undefined
  if (typeof raw === 'string' && raw !== '') return raw
  // With `locale: 'all'` a localized title arrives as a map.
  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>
    for (const key of [defaultLocale, ...Object.keys(map)]) {
      const value = map[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return `#${doc.id}`
}

/**
 * `GET /api/polyglot/report`
 *
 * Query: `entity`, `kind`, `state`, `since`, `page`, `limit`.
 *
 * Reads documents with `locale: 'all'` and `fallbackLocale: null`, so an empty
 * target locale stays empty instead of showing the source text.
 */
export const reportHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, false)
    if (refused) return refused

    const params = query(req)
    const kind = (params.get('kind') ?? 'collection') as EntityKind
    const slug = params.get('entity') ?? ''
    const state = (params.get('state') ?? 'published') as DocState
    const since = params.get('since')
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit') ?? 50) || 50))
    // Payload keeps a deleted document in the trash. The hub asks for those
    // only when it wants to show them.
    const trash = params.get('trash') === 'true'

    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    const entity = context.entities.get(`${kind}:${slug}`)
    if (!entity) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }
    if (state === 'draft' && !entity.manifest.drafts) {
      return json(400, { ok: false, code: 'validation', message: `${slug} has no drafts` })
    }

    const locales = context.locales
    const shared = {
      locale: 'all' as const,
      fallbackLocale: null,
      depth: 0,
      draft: state === 'draft',
      overrideAccess: false,
      user: req.user,
      req,
    }

    const docs: ReportDoc[] = []
    let totalDocs = 1
    let totalPages = 1

    if (kind === 'global') {
      const doc = (await req.payload.findGlobal({ slug, ...shared })) as AnyData
      docs.push(buildDoc(doc, entity, locales, context.defaultLocale))
    } else {
      const where = since ? { updatedAt: { greater_than: since } } : undefined
      const result = (await req.payload.find({
        collection: slug,
        ...shared,
        limit,
        page,
        sort: 'id',
        trash,
        ...(where ? { where } : {}),
      })) as AnyData
      totalDocs = Number(result.totalDocs ?? 0)
      totalPages = Number(result.totalPages ?? 1)
      for (const doc of (result.docs ?? []) as AnyData[]) {
        docs.push(buildDoc(doc, entity, locales, context.defaultLocale))
      }
    }

    const response: ReportResponse = {
      entity: { kind, slug },
      state,
      locales,
      page,
      limit,
      totalDocs,
      totalPages,
      docs,
    }
    return json(200, response)
  }

function buildDoc(
  doc: AnyData,
  entity: { manifest: { useAsTitle?: string }; tree: Parameters<typeof collectUnits>[0] },
  locales: string[],
  defaultLocale: string,
): ReportDoc {
  return {
    id: doc.id,
    title: titleOf(doc, entity.manifest.useAsTitle, defaultLocale),
    updatedAt: String(doc.updatedAt ?? ''),
    status: (doc._status ?? null) as ReportDoc['status'],
    units: collectUnits(entity.tree, doc, locales),
  }
}
