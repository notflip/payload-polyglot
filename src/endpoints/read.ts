import { cachedContext } from '../context.js'
import { collectUnits, collectValues } from '../flatten.js'
import type { DocState, EntityKind, ReadResponse } from '../types.js'
import { guard, json, query, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>
type AnyData = Record<string, any>

/**
 * `GET /api/polyglot/read`
 *
 * Query: `entity`, `kind`, `id`, `source`, `target`, `state`.
 *
 * Returns the full values of one document in two locales, for the side by side
 * editor. `fallbackLocale: null` is what keeps an empty target empty.
 */
export const readHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, false)
    if (refused) return refused

    const params = query(req)
    const kind = (params.get('kind') ?? 'collection') as EntityKind
    const slug = params.get('entity') ?? ''
    const id = params.get('id') ?? undefined
    const state = (params.get('state') ?? 'published') as DocState
    const target = params.get('target') ?? ''

    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    const entity = context.entities.get(`${kind}:${slug}`)
    if (!entity) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }
    const source = params.get('source') ?? context.defaultLocale
    if (!context.locales.includes(target)) {
      return json(400, { ok: false, code: 'validation', message: `unknown locale ${target}` })
    }
    if (kind === 'collection' && !id) {
      return json(400, { ok: false, code: 'validation', message: 'id is required' })
    }

    const base = {
      fallbackLocale: null,
      depth: 0,
      draft: state === 'draft',
      overrideAccess: false,
      user: req.user,
      req,
    }

    const load = async (locale: string): Promise<AnyData> =>
      kind === 'global'
        ? await req.payload.findGlobal({ slug, locale, ...base })
        : await req.payload.findByID({ collection: slug, id, locale, ...base })

    // These reads run one after the other on purpose. Payload writes the active
    // locale onto the request object, so two reads that share one request race
    // and both return the locale of whichever call ran last.
    let sourceDoc: AnyData
    let targetDoc: AnyData
    try {
      sourceDoc = await load(source)
      targetDoc = await load(target)
    } catch (error) {
      return json(404, {
        ok: false,
        code: 'not_found',
        message: error instanceof Error ? error.message : 'document not found',
      })
    }

    // Units come from a single read with every locale, so the statuses of the
    // two columns are produced by the same rules as the report.
    const allDoc = (kind === 'global'
      ? await req.payload.findGlobal({ slug, locale: 'all', ...base })
      : await req.payload.findByID({ collection: slug, id, locale: 'all', ...base })) as AnyData

    const useAsTitle = entity.manifest.useAsTitle
    const rawTitle = useAsTitle ? sourceDoc[useAsTitle] : undefined

    const response: ReadResponse = {
      id: targetDoc.id ?? id ?? slug,
      title: typeof rawTitle === 'string' && rawTitle !== '' ? rawTitle : `#${targetDoc.id ?? slug}`,
      updatedAt: String(targetDoc.updatedAt ?? ''),
      status: (allDoc._status ?? null) as ReadResponse['status'],
      sourceLocale: source,
      targetLocale: target,
      source: collectValues(entity.tree, sourceDoc),
      target: collectValues(entity.tree, targetDoc),
      units: collectUnits(entity.tree, allDoc, context.locales),
    }
    return json(200, response)
  }
