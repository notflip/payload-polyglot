import type { GlobalConfig } from 'payload'

/**
 * The global that holds the interface strings.
 *
 * One row per key. The key is not localized, because it comes from the code
 * and is the same in every language. The value is, so Polyglot can translate
 * it like any other localized field.
 *
 * The row id is what joins the languages of one row. Never delete and recreate
 * a row: the translations of every other language hang from that id.
 */
export type StringsOptions = {
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

export function stringsGlobal(options: StringsOptions = {}): GlobalConfig {
  const labels = options.labels ?? {}

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

  return options.overrides ? options.overrides(global) : global
}
