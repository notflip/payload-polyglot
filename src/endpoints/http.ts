import { timingSafeEqual } from 'node:crypto'

type AnyReq = Record<string, any>

export type PolyglotOptions = {
  /**
   * Shared secret. Every request must send it as `x-polyglot-secret`.
   * Leave it empty only on a local machine that is not reachable from outside.
   */
  secret?: string
  /** Language of the field labels in the manifest. Default `nl`. */
  labelLanguage?: string
  /** Extra check on top of the secret. Default: a write needs a logged-in user. */
  access?: (args: { req: AnyReq; write: boolean }) => boolean | Promise<boolean>
  /** Base path of the endpoints. Default `/polyglot`. */
  path?: string
  /** Turn the plugin off without removing it from the config. */
  disabled?: boolean
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

  const check = options.access ?? (({ req: r, write: w }) => (w ? Boolean(r.user) : true))
  if (!(await check({ req, write }))) {
    return json(403, { ok: false, code: 'forbidden', message: 'access denied' })
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
