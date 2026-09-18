import type { GlobalConfig } from 'payload'
import { flattenMessages, mergeMessages, type MessageTree } from './messages.js'
import { rowId } from './rowId.js'

type AnyDoc = Record<string, any>

/**
 * The global that holds the interface strings.
 *
 * One row per key. The key is not localized, because it comes from the code
 * and is the same in every language. The value is, so Polyglot translates it
 * like any other localized field.
 */
export type StringsOptions = {
  /**
   * The message trees of the language the project is written in, in rising
   * order of precedence. Give it the JSON files the code reads.
   *
   * With this, the global fills itself: every key of the files appears as a
   * row on read, carrying its text in the default language, so there is
   * nothing to run and nothing to keep in step. Leave it out and the rows have
   * to be written by `syncStrings`.
   */
  defaults?: MessageTree | MessageTree[]
  /** Slug of the global. Default `translations`. */
  slug?: string
  /**
   * Who may read and write. The default lets the site read and asks for a
   * logged-in user to write, which an API key provides.
   */
  access?: GlobalConfig['access']
  /**
   * Hooks of the global. Give it the revalidation hook of the project here,
   * so an edited text is live on save.
   */
  hooks?: GlobalConfig['hooks']
  /** The admin text. The defaults are Dutch, like `labelLanguage`. */
  labels?: {
    global?: string
    group?: string
    description?: string
    items?: string
    key?: string
    keyDescription?: string
    value?: string
  }
  /** The last word on the shape, for anything the options above do not cover. */
  overrides?: (global: GlobalConfig) => GlobalConfig
}

/**
 * Put every key of the code in the document that is read.
 *
 * The files own the list of keys, so the global never has to be told about a
 * new one. A row that is already stored keeps its id and its translations; a
 * key that is not stored yet is added here, and it is written for real the
 * first time anyone saves the global or applies a translation to it.
 *
 * The text of the default language comes from the files. Every other language
 * stays empty, so a translation that was never made is not reported as done.
 *
 * A key that left the code is left out. Its row stays in the database and
 * comes back, with its translations, if the key returns.
 */
function fillFromCode(defaults: Record<string, string>) {
  return ({ doc, req }: { doc: AnyDoc; req: AnyDoc }): AnyDoc => {
    const localization = req?.payload?.config?.localization
    const defaultLocale: string | null = localization ? localization.defaultLocale : null
    const stored = new Map<string, AnyDoc>()
    for (const item of (doc?.items ?? []) as AnyDoc[]) {
      if (item?.key) stored.set(item.key, item)
    }

    const items = Object.entries(defaults).map(([key, text]) => {
      const row = stored.get(key) ?? { id: rowId(key), key }

      // `locale: 'all'` gives an object of every language. Any other read
      // gives the one language that was asked for.
      if (req?.locale === 'all') {
        const value = { ...(row.value as Record<string, unknown> | undefined) }
        if (defaultLocale && !value[defaultLocale]) value[defaultLocale] = text
        return { ...row, key, value }
      }

      const isDefault = !defaultLocale || req?.locale === defaultLocale
      return { ...row, key, value: row.value || (isDefault ? text : null) }
    })

    return { ...doc, items }
  }
}

export function stringsGlobal(options: StringsOptions = {}): GlobalConfig {
  const labels = options.labels ?? {}
  const trees = Array.isArray(options.defaults)
    ? options.defaults
    : options.defaults
      ? [options.defaults]
      : []

  const global: GlobalConfig = {
    slug: options.slug ?? 'translations',
    label: labels.global ?? 'Interface',
    admin: {
      group: labels.group ?? 'Instellingen',
      description:
        labels.description ??
        'De vaste teksten van de site, zoals knoppen en meldingen. De sleutels komen uit de code.',
    },
    access: options.access ?? {
      read: () => true,
      update: ({ req }) => Boolean(req.user),
    },
    fields: [
      {
        name: 'items',
        type: 'array',
        label: labels.items ?? 'Teksten',
        admin: { initCollapsed: true },
        fields: [
          {
            name: 'key',
            type: 'text',
            label: labels.key ?? 'Sleutel',
            required: true,
            admin: {
              readOnly: true,
              description:
                labels.keyDescription ?? 'Komt uit de code. Verander deze niet met de hand.',
            },
          },
          {
            name: 'value',
            type: 'textarea',
            label: labels.value ?? 'Tekst',
            localized: true,
          },
        ],
      },
    ],
  }

  if (options.hooks) global.hooks = options.hooks

  if (trees.length > 0) {
    const defaults = flattenMessages(mergeMessages(...trees))
    global.hooks = {
      ...global.hooks,
      afterRead: [...(global.hooks?.afterRead ?? []), fillFromCode(defaults) as never],
    }
  }

  return options.overrides ? options.overrides(global) : global
}
