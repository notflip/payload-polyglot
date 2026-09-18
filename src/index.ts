import type { Config, Plugin } from 'payload'
import { applyHandler } from './endpoints/apply.js'
import type { PolyglotOptions } from './endpoints/http.js'
import { manifestHandler } from './endpoints/manifest.js'
import { readHandler } from './endpoints/read.js'
import { refreshHandler } from './endpoints/refresh.js'
import { reportHandler } from './endpoints/report.js'
import { stringsGlobal } from './strings/global.js'

export type { PolyglotOptions } from './endpoints/http.js'
export type { StringsOptions } from './strings/global.js'
export { stringsGlobal } from './strings/global.js'
export * from './types.js'

/**
 * Polyglot: expose the translation state of this project, and apply
 * translations through the Local API.
 *
 * ```ts
 * plugins: [polyglotPlugin({ secret: process.env.POLYGLOT_SECRET })]
 * ```
 *
 * Endpoints, all under `/api/polyglot`:
 * - `GET  /manifest`  every localized field, with labels
 * - `GET  /report`    the translation state of one entity
 * - `GET  /read`      the full values of one document in two locales
 * - `POST /apply`     write translations into one locale
 * - `POST /refresh`   let the project drop the caches of one document, once
 *
 * With `strings`, it also adds the global that holds the fixed words of the
 * interface. See `stringsGlobal` and `polyglotMessages`.
 */
export const polyglotPlugin =
  (options: PolyglotOptions = {}): Plugin =>
  (incoming: Config): Config => {
    if (options.disabled) return incoming

    const base = options.path ?? '/polyglot'
    const endpoints = [
      { path: `${base}/manifest`, method: 'get' as const, handler: manifestHandler(options) },
      { path: `${base}/report`, method: 'get' as const, handler: reportHandler(options) },
      { path: `${base}/read`, method: 'get' as const, handler: readHandler(options) },
      { path: `${base}/apply`, method: 'post' as const, handler: applyHandler(options) },
      { path: `${base}/refresh`, method: 'post' as const, handler: refreshHandler(options) },
    ]

    const globals = options.strings
      ? [
          ...(incoming.globals ?? []),
          stringsGlobal(options.strings === true ? {} : options.strings),
        ]
      : incoming.globals

    return {
      ...incoming,
      globals,
      endpoints: [...(incoming.endpoints ?? []), ...endpoints] as Config['endpoints'],
    }
  }

export default polyglotPlugin
