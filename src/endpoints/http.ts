import { timingSafeEqual } from 'node:crypto'
import type { StringsOptions } from '../strings/global.js'

type AnyReq = Record<string, any>

export type PolyglotOptions = {
  /**
   * An extra shared secret, sent as `x-polyglot-secret`.
   *
   * The API key is what grants access. This secret is a second lock in front
   * of it, so a leaked key is not enough on its own. Set it on any project
   * that uses `admin.autoLogin`, because Payload then signs in every request
   * in development and the user check protects nothing there.
   */
  secret?: string
  /** Language of the field labels in the manifest. Default `nl`. */
  labelLanguage?: string
  /**
   * Who may use these endpoints. The default asks for a logged-in user, which
   * an API key provides. Tighten it to a role if the project needs that.
   */
  access?: (args: { req: AnyReq; write: boolean }) => boolean | Promise<boolean>
  /** Base path of the endpoints. Default `/polyglot`. */
  path?: string
  /**
   * Add the strings global to the config, for the fixed words of the
   * interface. `true` takes the defaults. See `StringsOptions`.
   */
  strings?: boolean | StringsOptions
  /** Turn the plugin off without removing it from the config. */
  disabled?: boolean
}

/**
 * The id of a document, in the shape the project keeps it.
 *
 * An id travels through a URL and through the hub database as text, while
 * Postgres gives a collection whole numbers. Payload reads a document with
 * either, but it compares a relationship with what the database holds, so a
 * text id makes a relationship of that document look wrong and the write is
 * refused over a field nobody touched. A number that arrives as text is
 * therefore read as a number again.
 */
export function documentId(value: string | number | undefined): string | number | undefined {
  if (typeof value !== 'string') return value
  return /^\d+$/.test(value) ? Number(value) : value
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Compare two secrets without leaking their length through timing. */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    // Still run a comparison, so a wrong length costs the same time.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Check the shared secret and the access rule.
 * Returns a `Response` when the request must be refused, otherwise `null`.
 */
export async function guard(
  req: AnyReq,
  options: PolyglotOptions,
  write: boolean,
): Promise<Response | null> {
  const expected = options.secret ?? ''
  if (expected !== '') {
    const given = req.headers?.get?.('x-polyglot-secret') ?? ''
    if (!secretsMatch(String(given), expected)) return json(403, { ok: false, code: 'forbidden', message: 'bad secret' })
  }

  // Reading the translation state lists every field, every path and a preview
  // of every value, so it asks for the same credential as writing.
  const check = options.access ?? (({ req: r }) => Boolean(r.user))
  if (!(await check({ req, write }))) {
    return json(403, {
      ok: false,
      code: 'forbidden',
      message: 'no user on this request: send an API key of a Payload user',
    })
  }
  return null
}

/** Read the query parameters of a request, whatever the Payload version gives us. */
export function query(req: AnyReq): URLSearchParams {
  if (req.searchParams instanceof URLSearchParams) return req.searchParams
  if (req.query && typeof req.query === 'object') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
      if (value !== undefined && value !== null) params.set(key, String(value))
    }
    return params
  }
  try {
    return new URL(String(req.url), 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/** Read a JSON body, whatever the Payload version gives us. */
export async function body<T>(req: AnyReq): Promise<T> {
  if (typeof req.json === 'function') return (await req.json()) as T
  if (req.data) return req.data as T
  return {} as T
}
