import { cachedContext } from '../context.js'
import { guard, json, type PolyglotOptions } from './http.js'

type AnyReq = Record<string, any>

/**
 * `GET /api/polyglot/manifest`
 *
 * Returns every localized field of the project, with its label and its type.
 * The hub uses this list as the denominator of every completion figure.
 */
export const manifestHandler =
  (options: PolyglotOptions) =>
  async (req: AnyReq): Promise<Response> => {
    const refused = await guard(req, options, false)
    if (refused) return refused
    const context = cachedContext(req.payload, options.labelLanguage ?? 'nl')
    return json(200, context.manifest)
  }
