import { cachedContext } from '../context.js'
import { getByPath, MISSING, setByPath, templateOf, topLevelField } from '../flatten.js'
import { isLexical } from '../lexical.js'
import { evaluate } from '../status.js'
import type { ApplyRequest, ApplyResponse, LeafKind } from '../types.js'
import { body, documentId, guard, json, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>
type AnyData = Record<string, any>

const LOCK_COLLECTION = 'payload-locked-documents'

/** True when another user holds the Payload editing lock on this document. */
async function lockedByOther(req: AnyReq, slug: string, id: unknown): Promise<string | null> {
  try {
    const result = (await req.payload.find({
      collection: LOCK_COLLECTION,
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      req,
      where: {
        and: [
          { 'document.relationTo': { equals: slug } },
          { 'document.value': { equals: id } },
        ],
      },
    })) as AnyData
    const lock = (result.docs ?? [])[0] as AnyData | undefined
    if (!lock) return null
    const owner = lock.user?.value ?? lock.user
    const ownerId = typeof owner === 'object' ? owner?.id : owner
    if (ownerId && req.user?.id && String(ownerId) === String(req.user.id)) return null
    return String(ownerId ?? 'another user')
  } catch {
    // Older Payload versions have no lock collection. Nothing to check.
    return null
  }
}

/**
 * Hash a value the same way the report does.
 *
 * The kind is read from the value itself rather than from the manifest: a
 * lexical document is the only shape that needs the rich text path, and it is
 * recognisable at runtime. This keeps the hash correct even for a block whose
 * template path the caller did not resolve.
 */
function hashOf(value: unknown): string {
  const kind: LeafKind = isLexical(value) ? 'richtext' : 'text'
  return evaluate(kind, value, true).hash ?? ''
}

/**
 * `POST /api/polyglot/apply`
 *
 * Writes one or more translations into one locale of one document.
 *
 * Every rule below is load bearing:
 * - `fallbackLocale: false` on the read. Without it every untouched localized
 *   field comes back holding the source text, and the write stores that text as
 *   real content in the target locale.
 * - `depth: 0`. A populated relationship would be written back as an object.
 * - Only the touched top level fields go into `data`. Array and block items keep
 *   their `id`, so Payload updates the rows instead of deleting and recreating
 *   them. A recreated row loses the translations of every other locale.
 * - One transaction, so a failure halfway leaves nothing behind.
 */
export const applyHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, true)
    if (refused) return refused

    const request = await body<ApplyRequest>(req)
    const kind = request?.entity?.kind ?? 'collection'
    const slug = request?.entity?.slug ?? ''
    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    const entity = context.entities.get(`${kind}:${slug}`)

    if (!entity) {
      return json(404, { ok: false, code: 'not_found', message: `unknown entity ${kind}:${slug}` })
    }
    const publishOnly = request.publish === 'locale' || request.publish === 'all'
    if (!Array.isArray(request.ops) || (request.ops.length === 0 && !publishOnly)) {
      return json(400, { ok: false, code: 'validation', message: 'ops is empty' })
    }
    if (!Array.isArray(request.ops)) request.ops = []
    if (!context.locales.includes(request.locale)) {
      return json(400, { ok: false, code: 'validation', message: `unknown locale ${request.locale}` })
    }

    const derived = entity.manifest.leaves.filter((leaf) => leaf.role === 'derived').map((leaf) => leaf.path)
    for (const op of request.ops) {
      if (derived.includes(op.path.replace(/\[\d+\]/g, '[]'))) {
        return json(400, {
          ok: false,
          code: 'validation',
          message: `${op.path} is written by a project hook and cannot be set here`,
        })
      }
    }

    const draft = request.state === 'draft'
    const transaction = await req.payload.db.beginTransaction?.()
    const scoped = transaction ? { ...req, transactionID: transaction } : req

    const rollback = async (status: number, payload: ApplyResponse): Promise<Response> => {
      if (transaction) await req.payload.db.rollbackTransaction(transaction)
      return json(status, payload)
    }

    try {
      const read = {
        locale: request.locale,
        fallbackLocale: false,
        depth: 0,
        draft,
        overrideAccess: false,
        user: req.user,
        req: scoped,
      }
      const doc = (kind === 'global'
        ? await req.payload.findGlobal({ slug, ...read })
        : await req.payload.findByID({ collection: slug, id: documentId(request.id), ...read })) as AnyData

      /*
       * A document with drafts may hold changes that nobody published yet.
       * Payload builds an update from the newest version, so a write to the
       * published document would carry those changes into the site: the same
       * thing the Publish button of the admin panel does. A translation must
       * never do that on its own.
       */
      if (!draft && entity.manifest.drafts) {
        const latest = (kind === 'global'
          ? await req.payload.findGlobal({ slug, ...read, draft: true })
          : await req.payload.findByID({ collection: slug, id: documentId(request.id), ...read, draft: true })) as AnyData
        const status = latest?._status
        const pending =
          typeof status === 'string'
            ? status === 'draft'
            : Boolean(status && typeof status === 'object' && Object.values(status).includes('draft'))
        if (pending) {
          return rollback(409, {
            ok: false,
            code: 'draft_pending',
            message:
              'This document holds changes that nobody published yet. Publishing or dropping them in Payload frees it, or translate its draft instead.',
          })
        }
      }

      const serverUpdatedAt = String(doc.updatedAt ?? '')
      if (
        request.guard?.updatedAt &&
        new Date(serverUpdatedAt).getTime() !== new Date(request.guard.updatedAt).getTime()
      ) {
        return rollback(409, {
          ok: false,
          code: 'conflict',
          serverUpdatedAt,
          conflicts: request.ops
            .filter((op) => {
              if (!op.expectedHash) return false
              const current = getByPath(doc, op.path)
              return current === MISSING || hashOf(current) !== op.expectedHash
            })
            .map((op) => ({
              path: op.path,
              serverHash: hashOf(getByPath(doc, op.path)),
            })),
        })
      }

      if (kind === 'collection') {
        const owner = await lockedByOther(scoped, slug, documentId(request.id))
        if (owner) {
          return rollback(423, {
            ok: false,
            code: 'locked',
            message: 'another editor holds this document',
            lockedBy: owner,
          })
        }
      }

      const touched = new Set<string>()
      for (const op of request.ops) {
        const current = getByPath(doc, op.path)
        if (current === MISSING) {
          return rollback(404, {
            ok: false,
            code: 'path_not_found',
            message: `${op.path} does not exist in ${slug} for locale ${request.locale}`,
          })
        }

        // A rich text field holds a tree of nodes: headings, lists, links,
        // uploads. Writing a plain string over it would throw all of that
        // away, so the shape has to match what is already there.
        const template = templateOf(doc, op.path)
        const target = entity.manifest.leaves.find((leaf) => leaf.path === template)
        const wantsRichText = target?.kind === 'richtext' || isLexical(current)
        if (wantsRichText && typeof op.value === 'string') {
          return rollback(400, {
            ok: false,
            code: 'validation',
            message: `${op.path} is rich text. A plain string would drop its formatting, its links and anything embedded in it.`,
            paths: [op.path],
          })
        }
        if (!wantsRichText && op.value !== null && typeof op.value === 'object') {
          return rollback(400, {
            ok: false,
            code: 'validation',
            message: `${op.path} is plain text, so it cannot take a rich text value.`,
            paths: [op.path],
          })
        }
        if (!setByPath(doc, op.path, op.value)) {
          return rollback(404, { ok: false, code: 'path_not_found', message: `cannot write ${op.path}` })
        }
        touched.add(topLevelField(op.path))
      }

      const data: AnyData = {}
      for (const field of touched) data[field] = doc[field]

      if (publishOnly) data._status = 'published'

      const write = {
        locale: request.locale,
        data,
        draft,
        depth: 0,
        overrideAccess: false,
        user: req.user,
        context: { polyglot: true, disableRevalidate: request.revalidate === false },
        req: scoped,
        ...(request.publish === 'all' ? { publishAllLocales: true } : {}),
      }
      const updated = (kind === 'global'
        ? await req.payload.updateGlobal({ slug, ...write })
        : await req.payload.update({ collection: slug, id: documentId(request.id), ...write })) as AnyData

      if (transaction) await req.payload.db.commitTransaction(transaction)

      return json(200, {
        ok: true,
        docId: updated.id ?? request.id ?? slug,
        updatedAt: String(updated.updatedAt ?? ''),
        applied: request.ops.map((op) => ({
          path: op.path,
          newHash: hashOf(getByPath(updated, op.path)),
        })),
      } satisfies ApplyResponse)
    } catch (error) {
      if (transaction) await req.payload.db.rollbackTransaction(transaction)
      const message = error instanceof Error ? error.message : 'apply failed'
      const validation = message.toLowerCase().includes('validation')
      return json(validation ? 400 : 500, {
        ok: false,
        code: validation ? 'validation' : 'error',
        message,
        details: (error as AnyData)?.data,
      } satisfies ApplyResponse)
    }
  }
