import { cachedContext } from '../context.js'
import { collectUnits, collectValues } from '../flatten.js'
import type { DocState, EntityKind, ReadResponse } from '../types.js'
import { documentId, guard, json, query, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>
type AnyData = Record<string, any>

/**
 * `GET /api/polyglot/read`
 *
 * Query: `entity`, `kind`, `id`, `source`, `targets`, `state`.
 *
 * `targets` is a list separated by commas. Leave it out to get every locale
 * except the source, so one request fills a whole editor.
 *
 * `fallbackLocale: false` is what keeps an empty target empty. Payload ignores
 * a plain `null` here and keeps falling back to the source.
 */
export const readHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, false)
    if (refused) return refused

    const params = query(req)
    const kind = (params.get('kind') ?? 'collection') as EntityKind
    const slug = params.get('entity') ?? ''
    const id = documentId(params.get('id') ?? undefined)
    const state = (params.get('state') ?? 'published') as DocState

    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    const entity = context.entities.get(`${kind}:${slug}`)
    if (!entity) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }

    const source = params.get('source') ?? context.defaultLocale
    const asked = (params.get('targets') ?? '')
      .split(',')
      .map((code) => code.trim())
      .filter((code) => code !== '')
    const targetLocales = (asked.length > 0 ? asked : context.locales).filter(
      (code) => code !== source && context.locales.includes(code),
    )

    if (!context.locales.includes(source)) {
      return json(400, { ok: false, code: 'validation', message: `unknown locale ${source}` })
    }
    if (targetLocales.length === 0) {
      return json(400, { ok: false, code: 'validation', message: 'no target locale to read' })
    }
    if (kind === 'collection' && !id) {
      return json(400, { ok: false, code: 'validation', message: 'id is required' })
    }

    const base = {
      fallbackLocale: false,
      depth: 0,
      draft: state === 'draft',
      overrideAccess: false,
      user: req.user,
      req,
    }

    const load = async (locale: string | 'all'): Promise<AnyData> =>
      kind === 'global'
        ? await req.payload.findGlobal({ slug, locale, ...base })
        : await req.payload.findByID({ collection: slug, id, locale, ...base })

    // These reads run one after the other on purpose. Payload writes the active
    // locale onto the request object, so reads that share one request race and
    // all return the locale of whichever call ran last.
    let sourceDoc: AnyData
    const targets: Record<string, Record<string, unknown>> = {}
    let allDoc: AnyData
    try {
      sourceDoc = await load(source)
      for (const locale of targetLocales) {
        targets[locale] = collectValues(entity.tree, await load(locale))
      }
      allDoc = await load('all')
    } catch (error) {
      return json(404, {
        ok: false,
        code: 'not_found',
        message: error instanceof Error ? error.message : 'document not found',
      })
    }

    const rawTitle = entity.manifest.useAsTitle ? sourceDoc[entity.manifest.useAsTitle] : undefined

    const response: ReadResponse = {
      id: sourceDoc.id ?? id ?? slug,
      title: typeof rawTitle === 'string' && rawTitle !== '' ? rawTitle : `#${sourceDoc.id ?? slug}`,
      updatedAt: String(sourceDoc.updatedAt ?? ''),
      status: (allDoc._status ?? null) as ReadResponse['status'],
      sourceLocale: source,
      targetLocales,
      source: collectValues(entity.tree, sourceDoc),
      targets,
      units: collectUnits(entity.tree, allDoc, context.locales),
    }
    return json(200, response)
  }
