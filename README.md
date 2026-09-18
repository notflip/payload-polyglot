# @studiomonty/payload-polyglot

Exposes the translation state of a Payload project over HTTP, and applies
translations with the Local API. The Polyglot hub reads these endpoints.

Works on Payload 3.39 and later. Every fact comes from the running Payload
instance, so the plugin needs no version check.

## Add Polyglot to a project

Nine steps. About ten minutes per project. Do them in this order.

### 1. Install the package

```bash
pnpm add git+https://github.com/notflip/payload-polyglot.git
```

Use the full https url, not the `github:` shorthand. pnpm turns the shorthand
into an SSH url, and a build server such as Vercel has no SSH key, so the
install fails with "Host key verification failed".

The package builds itself on install, so a git dependency needs nothing extra.

### 2. Add the plugin to the config

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

### 3. Put a secret in the environment

```bash
openssl rand -hex 32
```

```
POLYGLOT_SECRET=<the value you just made>
```

Add the same line to the environment of the hosting provider. The secret is
optional, but read "Which credential does what" below before you leave it out.

### 4. Turn on API keys for the user collection

```ts
// src/collections/Users.ts
auth: { useAPIKey: true },
```

### 5. Make an API key

Open your own user in the Payload admin, tick **Enable API Key**, save, and
copy the key. Polyglot reads and writes as that user, so that user needs access
to every collection you want to translate.

The Studio Monty kit has a script for this:

```bash
pnpm tsx src/scripts/polyglot-key.ts
```

### 6. Make the revalidation hooks read `disableRevalidate`

This is the step that keeps the site fast. Every hook that throws away pages
must start with a guard:

```ts
export const revalidatePage: CollectionAfterChangeHook = ({ doc, req: { context } }) => {
  if (context?.disableRevalidate) return doc
  revalidateTag(`page_${doc.slug}`)
  return doc
}
```

The Payload website template and the Studio Monty kit already do this. Without
it the site is rebuilt on every translation write instead of once per document.
Nothing breaks; the site is just slower. See "Saving and publishing" below.

### 7. Deploy the project

The endpoints live on the running project, so the hub can only read a project
that is deployed and reachable.

### 8. Check the endpoints by hand

```bash
curl -s https://<the project>/api/polyglot/manifest \
  -H "x-polyglot-secret: $POLYGLOT_SECRET" \
  -H "authorization: users API-Key $POLYGLOT_API_KEY" | head -40
```

Expect JSON with `localization`, `entities` and a `leaves` list per entity. A
`403` means the secret or the key is wrong. A `404` means the plugin is not in
the running build.

### 9. Connect it in the hub

Open the hub, go to **Connections**, and give it:

| Field | Value |
| --- | --- |
| Name | the name you want to read in the rail |
| Address of the project | `https://<the project>` |
| API key of a Payload user | the key from step 5 |
| Plugin secret | the `POLYGLOT_SECRET` of that project. It hides behind "The project sets a plugin secret". |

Saving reads the project once and says what came back. The address of the admin
panel is taken as `<address>/admin`.

The form sends the key as a key of the `users` collection. A project that names
its auth collection differently has to be connected from the command line:

```bash
pnpm --filter hub cli project:add <slug> <name> <address> <secret> <key> <collection>
```

### Updating the plugin later

```bash
pnpm update @studiomonty/payload-polyglot
```

The hub names the version it needs on the Connections page. A project on an
older plugin is marked there.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `secret` | none | An extra shared secret, sent as `x-polyglot-secret`. Optional. See below. |
| `labelLanguage` | `nl` | Language of the field labels in the manifest. |
| `access` | a write needs a logged-in user | Extra check on top of the secret. |
| `path` | `/polyglot` | Base path of the endpoints. |
| `strings` | `false` | Add the interface strings global. See below. |
| `disabled` | `false` | Turn the plugin off without removing it. |

## Interface strings

The fixed words of a site — a button, a label, a message — live in no document.
They live in JSON files next to the code, because the code that reads a key
ships in the same commit.

Turn on `strings` and the plugin adds a global that holds those keys, so
Polyglot translates them like any other localized field.

```ts
polyglotPlugin({
  secret: process.env.POLYGLOT_SECRET,
  strings: {
    access: { read: () => true, update: isAuthenticated },
    hooks: { afterChange: [revalidateGlobal] },
  },
})
```

Give it the revalidation hook of the project. Without it an edited text waits
for the next deploy.

### Read them on the request

```ts
// src/i18n/request.ts
import { polyglotMessages } from '@studiomonty/payload-polyglot/strings'

messages: await polyglotMessages({
  files: [() => import(`../../messages/${locale}.json`)],
  overrides: () => getCachedGlobal('translations', 0, locale),
}),
```

The sources are laid over each other key by key: the files first, in the order
given, then the global. A plain spread would replace a whole namespace, so one
translated key inside `Navigation` would drop the rest of it.

Nothing here takes the site down. A language without a file is skipped, and a
database that is not reachable returns nothing. The files carry every key.

### Carry the keys into Payload

An array field cannot invent a row, so a key that exists only in a file has
nothing to translate. Copy the keys over after adding one:

```ts
// src/scripts/syncStrings.ts
import config from '@payload-config'
import { getPayload } from 'payload'
import { syncStrings } from '@studiomonty/payload-polyglot/strings/sync'

const result = await syncStrings({
  payload: await getPayload({ config }),
  locale: 'nl',
  dirs: ['messages'],
})

console.log(`${result.total} keys, ${result.added.length} new`)
process.exit(0)
```

```json
"strings:sync": "payload run ./src/scripts/syncStrings.ts"
```

It never overwrites a text that is there, and it writes no language but the one
given. A key that left the code leaves the global with it.

A new row gets an id derived from its key, so one key is one row in every
environment. That id joins the languages of a row: Payload hangs the translated
value from it. This is why a row is updated and never recreated.

### Options of the global

| Option | Default | Meaning |
| --- | --- | --- |
| `slug` | `translations` | Slug of the global. |
| `access` | read by anyone, write by a user | Access of the global. |
| `hooks` | none | Hooks of the global. Put the revalidation hook here. |
| `labels` | Dutch | The text of the admin interface. |
| `overrides` | none | The last word on the shape, for anything the rest does not cover. |

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

### `POST /refresh`

```ts
{ entity: { kind, slug }, id?, state } -> { ok: true, updatedAt }
```

Saves the document again with nothing in it, so the hooks of the project run
and drop what they drop. Nothing in the document changes.

This exists because of `revalidate` on `/apply`. A translation run writes one
language after another, and every one of those writes would otherwise throw
away the pages of the site: the first visitor after each write waits for a
rebuild. The hub therefore sends `revalidate: false` on every write and calls
this once, after the last language of a document.

The plugin sets `context.disableRevalidate`, which is the flag the Payload
website template and the Studio Monty kit already read at the top of every
revalidation hook. A project that does not read it keeps its own behaviour: it
rebuilds per write, as before, and this call costs it one more save of nothing.

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

## Saving and publishing

A translator presses Save, and later Publish. These are what each one costs the
project.

**Save** sends one `POST /apply` per language that changed, whatever the number
of fields. Ten fields of one document in French is one request and one
`payload.update`. The request carries `revalidate: false`, so the plugin sets
`context.disableRevalidate` and the revalidation hooks of the project return
before they throw any page away. The site keeps serving what it has.

**Publish** sends one `POST /refresh` per document, whatever the number of
saves and languages that went into it. That call saves the document again with
nothing in it, so the hooks run once and the project decides what to rebuild.

So a document translated into three languages over twenty saves costs the site
**one** rebuild, not twenty, and not sixty.

Nothing is written while a translator types. The boxes hold the text until Save
is pressed.

Two things to know:

- A project whose hooks ignore `context.disableRevalidate` rebuilds on every
  write, as it always did. Step 6 of the install is what prevents that.
- `/refresh` writes a new `updatedAt` and one new version row, because that is
  what any save in the admin panel does. The content does not change.

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
- The text inside a custom component is translated as well. Payload holds the
  definition of every component, so the fields it calls text are the fields
  Polyglot offers, whatever the project names them. An `inlineFaq` with twelve
  questions gives twenty-four strings, each one its own row under the text that
  holds it. The path says where it stands: `content@1#items[3].title`.
- A custom lexical component keeps its place. A project can add its own
  nodes to the editor: `inlineButton`, `inlineFaq`, `inlineImage`. Such a node
  holds no text, so the reader used to walk past it and the write-back rebuilt
  the sentence without it. The node is now one mark in the translation,
  `<x k="0"/>`, and the write puts the original node back. A translation that
  drops the mark is refused. This also covers a node type a later version of
  Payload adds.
- A document that holds unpublished changes is refused. Payload builds an
  update from the newest version, so writing the published document while a
  draft waits would carry that draft onto the site: the same thing the Publish
  button of the admin panel does. A translation never publishes anyone's work.
  The answer is `409 draft_pending`, and the same rule guards `/refresh`.
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
pnpm test        # 90 unit tests, no database needed
pnpm typecheck
```

The hub and this package share one repository, because `src/types.ts` is the
contract between them: this package writes the JSON and the hub reads it. One
repository means a change to that shape breaks the typecheck of both sides in
the same commit.

A Payload project cannot install a subfolder of a repository, so the package is
copied out to a repository of its own. From the root of the monorepo:

```bash
pnpm publish:plugin "What changed"
```

That builds, runs the tests, copies the folder into a clone of
`notflip/payload-polyglot` and pushes one commit on top. It refuses to run
while the package has uncommitted changes, and it never rewrites the history:
a project lockfile points at a commit by its hash, and a rewrite would break
the install of every project that has not updated yet.

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
