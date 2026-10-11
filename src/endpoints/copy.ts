import { cachedContext } from '../context.js'
import type { CopyRequest, EntityKind } from '../types.js'
import { documentId, guard, json, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>

/**
 * `POST /api/polyglot/copy`
 *
 * Copy one language of a document into another, with Payload's own method: the
 * function behind "Copy to locale" in the document menu of the admin panel. It
 * fills only the fields that are empty in the target, unless `overwrite` is
 * set, keeps the blocks and arrays of the target, and saves the target as a
 * draft. The hub and the admin panel copy the same way.
 *
 * The function lives in `@payloadcms/ui`, so it is loaded only here: a project
 * without the admin panel still runs every other endpoint.
 */
export const copyHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, true)
    if (refused) return refused

    let request: CopyRequest
    try {
      request = (await req.json()) as CopyRequest
    } catch {
      return json(400, { ok: false, code: 'validation', message: 'the body is not json' })
    }

    const kind = (request.entity?.kind ?? 'collection') as EntityKind
    const slug = String(request.entity?.slug ?? '')
    if (!cachedContext(req.payload, options.labelLanguage).entities.has(`${kind}:${slug}`)) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }
    if (kind === 'collection' && (request.id === undefined || request.id === null)) {
      return json(400, { ok: false, code: 'validation', message: 'a collection needs an id' })
    }

    const ui = await import('@payloadcms/ui/rsc').catch(() => undefined)
    if (!ui?.copyDataFromLocaleHandler) {
      return json(501, {
        ok: false,
        code: 'error',
        message: 'this Payload version has no "Copy to locale" to copy with',
      })
    }

    try {
      const updated = (await ui.copyDataFromLocaleHandler({
        req,
        ...(kind === 'global' ? { globalSlug: slug } : { collectionSlug: slug, docID: documentId(request.id) }),
        fromLocale: request.from,
        toLocale: request.to,
        overrideData: Boolean(request.overwrite),
      } as Parameters<typeof ui.copyDataFromLocaleHandler>[0])) as { updatedAt?: string }
      return json(200, { ok: true, updatedAt: String(updated?.updatedAt ?? '') })
    } catch (error) {
      return json(400, {
        ok: false,
        code: 'error',
        message: error instanceof Error ? error.message : 'the project refused the copy',
      })
    }
  }
