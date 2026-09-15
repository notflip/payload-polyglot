import { cachedContext } from '../context.js'
import type { EntityKind, RefreshRequest } from '../types.js'
import { documentId, guard, json, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>

/**
 * `POST /api/polyglot/refresh`
 *
 * Let the project drop the caches of one document, once.
 *
 * A translation run writes one language after another, and every one of those
 * writes asks the project to keep its caches. Without this call the site would
 * keep serving the old pages. It saves the document again with nothing in it,
 * so the hooks the project already has decide what to drop. The plugin never
 * has to know the cache tags of a project.
 *
 * Nothing in the document changes. Payload writes a new `updatedAt`, which is
 * what it does for any save in the admin panel.
 */
export const refreshHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, true)
    if (refused) return refused

    let request: RefreshRequest
    try {
      request = (await req.json()) as RefreshRequest
    } catch {
      return json(400, { ok: false, code: 'validation', message: 'the body is not json' })
    }

    const kind = (request.entity?.kind ?? 'collection') as EntityKind
    const slug = String(request.entity?.slug ?? '')
    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    const entity = context.entities.get(`${kind}:${slug}`)
    if (!entity) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }
    if (kind === 'collection' && (request.id === undefined || request.id === null)) {
      return json(400, { ok: false, code: 'validation', message: 'a collection needs an id' })
    }

    const draft = request.state === 'draft'

    /*
     * The same rule as a write: Payload builds an update from the newest
     * version, so saving the published document while a draft waits would put
     * that draft on the site. A refresh must never publish anything.
     */
    if (!draft && entity.manifest.drafts) {
      const read = { depth: 0, draft: true, overrideAccess: false, user: req.user, req }
      const latest = (kind === 'global'
        ? await req.payload.findGlobal({ slug, ...read })
        : await req.payload.findByID({ collection: slug, id: documentId(request.id), ...read })) as Record<string, any>
      const status = latest?._status
      const pending =
        typeof status === 'string'
          ? status === 'draft'
          : Boolean(status && typeof status === 'object' && Object.values(status).includes('draft'))
      if (pending) {
        return json(409, {
          ok: false,
          code: 'draft_pending',
          message: 'This document holds changes that nobody published yet, so it was left alone.',
        })
      }
    }

    const write = {
      data: {},
      draft,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      context: { polyglot: true },
      req,
    }

    try {
      const updated = (kind === 'global'
        ? await req.payload.updateGlobal({ slug, ...write })
        : await req.payload.update({ collection: slug, id: documentId(request.id), ...write })) as Record<string, any>
      return json(200, { ok: true, updatedAt: String(updated.updatedAt ?? '') })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the project refused the refresh'
      return json(400, { ok: false, code: 'error', message })
    }
  }
