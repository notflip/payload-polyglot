# @studiomonty/payload-polyglot

Exposes the translation state of a Payload project over HTTP, and applies
translations with the Local API. The Polyglot hub reads these endpoints.

Works on Payload 3.39 and later. Every fact comes from the running Payload
instance, so the plugin needs no version check.

## Install

While the hub is in development, install from the local path:

```bash
pnpm add file:/Users/miguelstevens/payload-translation-check/packages/payload-polyglot
```

Add the plugin to the config:

```ts
// src/payload.config.ts
import { polyglotPlugin } from '@studiomonty/payload-polyglot'

export default buildConfig({
  // ...
  plugins: [
    polyglotPlugin({ secret: process.env.POLYGLOT_SECRET }),
  ],
})
```

Add the secret to `.env`:

```
POLYGLOT_SECRET=<a long random string>
```

Generate one with `openssl rand -hex 32`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `secret` | none | Shared secret. Every request must send it as `x-polyglot-secret`. Leave empty only on a machine that is not reachable from outside. |
| `labelLanguage` | `nl` | Language of the field labels in the manifest. |
| `access` | a write needs a logged-in user | Extra check on top of the secret. |
| `path` | `/polyglot` | Base path of the endpoints. |
| `disabled` | `false` | Turn the plugin off without removing it. |

## Endpoints

All endpoints sit under `/api/polyglot`.

### `GET /manifest`

Every localized field of the project, with its label, its type and whether it is
translatable. This list is the denominator of every completion figure.

### `GET /report`

Query: `entity`, `kind` (`collection` or `global`), `state` (`published` or
`draft`), `since`, `page`, `limit`.

Reads documents with `locale: 'all'` and `fallbackLocale: null`, so an empty
target locale stays empty instead of showing the source text. Returns one unit
per localized leaf, with a status, a hash, a length and a 160-character preview
per locale. The full value never leaves the project here.

### `GET /read`

Query: `entity`, `kind`, `id`, `source`, `target`, `state`.

The full values of one document in two locales, for the side by side editor.

### `POST /apply`

```jsonc
{
  "entity": { "kind": "collection", "slug": "pages" },
  "id": 12,
  "locale": "fr",
  "state": "draft",
  "ops": [{ "path": "blocks[2].items[0].title", "value": "Pour qui?" }],
  "guard": { "updatedAt": "2026-09-14T09:12:00.000Z" },
  "publish": "none"
}
```

Answers `200` with the new hashes, `409` when the document changed since the
read, `423` when another editor holds the Payload lock.

## Why these rules are in the handler

Each rule below prevents real data loss.

- `fallbackLocale: null` on the read. Without it every untouched localized field
  comes back holding the source text, and the write stores that text as genuine
  content in the target locale.
- Array and block items keep their `id`. Payload otherwise deletes and recreates
  the rows. A recreated row loses the translations of every other locale.
- `depth: 0`. A populated relationship would be written back as an object.
- Only the touched top-level fields go into `data`. A whole-document write drags
  `path` and `breadcrumbs` through validation.
- One transaction. A failure halfway leaves nothing behind.
- Fields named `path` and `breadcrumbs` are refused. The nested-docs plugin owns
  them.

## Publishing

`publish: "locale"` sets `_status` on the request locale only. `publish: "all"`
uses `publishAllLocales`. When Payload does not localize `_status`, both publish
the whole document. The manifest reports `statusScope`, so the hub can label the
button correctly.

## Development

```bash
pnpm build       # compile to dist
pnpm test        # 23 unit tests, no database needed
pnpm typecheck
```
