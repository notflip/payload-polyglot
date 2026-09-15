# @studiomonty/payload-polyglot

Exposes the translation state of a Payload project over HTTP, and applies
translations with the Local API. The Polyglot hub reads these endpoints.

Works on Payload 3.39 and later. Every fact comes from the running Payload
instance, so the plugin needs no version check.

## Install

```bash
pnpm add git+https://github.com/notflip/payload-polyglot.git
```

Use the full https url, not the `github:` shorthand. pnpm turns the shorthand
into an SSH url, and a build server such as Vercel has no SSH key, so the
install fails with "Host key verification failed".

The package builds itself on install, so a git dependency needs nothing extra.

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

Generate one with `openssl rand -hex 32`. This is optional; read
"Which credential does what" below before leaving it out.

Then turn on an API key so Polyglot can sign in:

```ts
// src/collections/Users.ts
auth: { useAPIKey: true },
```

Open your user in the Payload admin, tick **Enable API Key**, and copy it.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `secret` | none | An extra shared secret, sent as `x-polyglot-secret`. Optional. See below. |
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

- `fallbackLocale: false` on the read. Without it every untouched localized field
  comes back holding the source text, and the write stores that text as genuine
  content in the target locale. Payload accepts `false`, `'false'`, `'null'` or
  `'none'` here. Plain JavaScript `null` is ignored without an error, so the
  fallback stays on. A project with the default `fallback: true` then has its
  source language written into every other locale.
- Array and block items keep their `id`. Payload otherwise deletes and recreates
  the rows. A recreated row loses the translations of every other locale.
- `depth: 0`. A populated relationship would be written back as an object.
- Only the touched top-level fields go into `data`. A whole-document write drags
  `path` and `breadcrumbs` through validation.
- One transaction. A failure halfway leaves nothing behind.
- Fields named `path` and `breadcrumbs` are refused. The nested-docs plugin owns
  them.
- A custom lexical component keeps its place. A project can add its own
  nodes to the editor: `inlineButton`, `inlineFaq`, `inlineImage`. Such a node
  holds no text, so the reader used to walk past it and the write-back rebuilt
  the sentence without it. The node is now one mark in the translation,
  `<x k="0"/>`, and the write puts the original node back. A translation that
  drops the mark is refused. This also covers a node type a later version of
  Payload adds.
- The shape of the value must match the shape of the field. A plain string sent
  to a rich text field is refused with a `validation` error. Rich text holds a
  tree of headings, lists, links, uploads and embedded blocks. A string would
  replace all of it. A rich text value sent to a plain text field is refused for
  the same reason.

## Which credential does what

**The API key is the credential.** Every endpoint, read as well as write, asks
for a logged-in Payload user. An API key of a user provides that, and Payload
then applies that user's own access rules: a collection the user cannot read
stays invisible.

Reading is guarded as strictly as writing on purpose. `GET /report` lists every
field, every path and a preview of every value in every language. That is the
whole content of the site, so it is not a public thing.

**The secret is a second lock, and it is optional.** It protects two cases:

- A project with `admin.autoLogin` signs in **every** request in development,
  with no credentials at all. The user check then protects nothing, and the
  secret is all that is left. Set it on those projects.
- A leaked API key is not enough on its own while a secret is also set.

If neither case applies, the API key alone is enough and `secret` can be left
out.

## Publishing

`publish: "locale"` sets `_status` on the request locale only. `publish: "all"`
uses `publishAllLocales`. When Payload does not localize `_status`, both publish
the whole document. The manifest reports `statusScope`, so the hub can label the
button correctly.

## Updating the plugin in a project

```bash
pnpm update @studiomonty/payload-polyglot
```

The repository is public, so no credentials are needed to install it. The
package reads its secret and its API key from the project environment, never
from the source.

## Development

```bash
pnpm build       # compile to dist
pnpm test        # 25 unit tests, no database needed
pnpm typecheck
```

Verified against `child-focus-web` (Payload 3.86, `nl` and `fr`, `fallback: false`,
drafts with autosave, nested-docs and SEO plugins) and `anndeman` (Payload 3.88,
`nl` and `en`, the default `fallback: true`, drafts, rich text with links and
line breaks):

- the manifest lists 30 localized fields with their Dutch labels
- the report finds the real gaps, and Payload's trash filter is respected
- a write to one locale leaves every other locale untouched, and leaves the
  untouched fields of the same block empty rather than filling them with the
  source language
- a write creates one new version row and does not touch the published rows
- a stale `updatedAt` returns `409`, a derived field returns `400`, an unknown
  path returns `404`, and a wrong or missing secret returns `403`
