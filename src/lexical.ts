/**
 * Lexical rich text: read the editable text out of a document, and write a
 * translation back without changing the structure.
 *
 * A lexical document is a tree of nodes under `root`. Only `text` nodes hold
 * editable strings. Everything else - headings, lists, tables, uploads, links,
 * embedded blocks - is structure that a translation must keep.
 */

type AnyNode = Record<string, any>

export type LexicalRoot = { root: AnyNode }

/** Nodes that start a new translatable unit. One unit is one string to translate. */
const BLOCK_LEVEL = new Set([
  'paragraph',
  'heading',
  'quote',
  'listitem',
  'tablecell',
])

/** Nodes that carry meaning but no text. Their presence stops a "no text" gap. */
const MEDIA_NODES = new Set(['upload', 'block', 'horizontalrule', 'table', 'relationship'])

/** Bit values of the lexical `format` mask, in the order tags nest. */
export const FORMAT_TAGS: [number, string][] = [
  [1, 'b'],
  [2, 'i'],
  [4, 's'],
  [8, 'u'],
  [16, 'code'],
  [32, 'sub'],
  [64, 'sup'],
  [128, 'mark'],
]

const TAG_BY_NAME = new Map(FORMAT_TAGS.map(([bit, tag]) => [tag, bit]))

export function isLexical(value: unknown): value is LexicalRoot {
  return Boolean(value) && typeof value === 'object' && 'root' in (value as object)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type TextSegment = {
  /** Child-index address, e.g. `0/2/1`. `fields.<key>` marks a hop into a node field. */
  addr: string
  /** Address of the enclosing block-level node. One unit per address. */
  unit: string
  text: string
  format: number
  /** Index of the enclosing link node inside the unit, when there is one. */
  linkIndex?: number
}

/**
 * Collect every text segment of a lexical document, in reading order.
 * Also descends into the rich text fields of upload captions and inline blocks.
 */
export function extractSegments(doc: unknown): TextSegment[] {
  if (!isLexical(doc)) return []
  const out: TextSegment[] = []
  const linkCounters = new Map<string, number>()

  const walk = (node: AnyNode | undefined, addr: string, unit: string, linkIndex?: number): void => {
    if (!node || typeof node !== 'object') return
    const type = String(node.type ?? '')

    if (type === 'text') {
      const segment: TextSegment = {
        addr,
        unit,
        text: typeof node.text === 'string' ? node.text : '',
        format: typeof node.format === 'number' ? node.format : 0,
      }
      if (linkIndex !== undefined) segment.linkIndex = linkIndex
      out.push(segment)
      return
    }

    if (type === 'link' || type === 'autolink') {
      const seen = linkCounters.get(unit) ?? 0
      linkCounters.set(unit, seen + 1)
      for (const [i, child] of (node.children ?? []).entries()) {
        walk(child, `${addr}/${i}`, unit, seen)
      }
      return
    }

    // Upload captions and embedded blocks hold their own rich text documents.
    if (type === 'upload' || type === 'block' || type === 'relationship') {
      for (const [key, value] of Object.entries(node.fields ?? {})) {
        if (isLexical(value)) {
          walk((value as LexicalRoot).root, `${addr}/fields.${key}`, `${addr}/fields.${key}`)
        }
      }
      return
    }

    const nextUnit = BLOCK_LEVEL.has(type) ? addr : unit
    for (const [i, child] of (node.children ?? []).entries()) {
      walk(child, `${addr}/${i}`, nextUnit, linkIndex)
    }
  }

  for (const [i, child] of (doc.root.children ?? []).entries()) {
    walk(child, String(i), String(i))
  }
  return out
}

/** All editable text of a lexical document, joined. Used for hashing and gap detection. */
export function extractPlainText(doc: unknown): string {
  return extractSegments(doc)
    .map((s) => s.text)
    .join(' ')
}

/** True when the document holds an upload, a table, a rule or an embedded block. */
export function hasMediaNodes(doc: unknown): boolean {
  if (!isLexical(doc)) return false
  let found = false
  const walk = (node: AnyNode | undefined): void => {
    if (found || !node || typeof node !== 'object') return
    if (MEDIA_NODES.has(String(node.type ?? ''))) {
      found = true
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(doc.root)
  return found
}

// ---------------------------------------------------------------------------
// Units and the tagged form
// ---------------------------------------------------------------------------

export type TranslationUnit = {
  /** Address of the block-level node. */
  unit: string
  /** The unit as one string with inline tags. */
  tagged: string
  segments: TextSegment[]
}

/**
 * Group segments into units and render each unit as one tagged string.
 *
 * `Boek je <b>vandaag</b> via <a k="0">deze pagina</a>.`
 *
 * A translator may reorder the tags freely. The link fields stay behind, keyed
 * by index, so an internal link keeps its relation.
 */
export function toUnits(doc: unknown): TranslationUnit[] {
  const segments = extractSegments(doc)
  const byUnit = new Map<string, TextSegment[]>()
  for (const segment of segments) {
    const list = byUnit.get(segment.unit)
    if (list) list.push(segment)
    else byUnit.set(segment.unit, [segment])
  }
  return [...byUnit.entries()].map(([unit, list]) => ({
    unit,
    tagged: renderTagged(list),
    segments: list,
  }))
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeText(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Render one unit as a tagged string. */
export function renderTagged(segments: TextSegment[]): string {
  let out = ''
  let openFormat = 0
  let openLink: number | undefined

  const closeFormats = (target: number) => {
    // Close in reverse order so the tags nest correctly.
    for (let i = FORMAT_TAGS.length - 1; i >= 0; i--) {
      const entry = FORMAT_TAGS[i]!
      if (openFormat & entry[0] && !(target & entry[0])) {
        out += `</${entry[1]}>`
        openFormat &= ~entry[0]
      }
    }
  }

  for (const segment of segments) {
    if (segment.linkIndex !== openLink) {
      closeFormats(0)
      if (openLink !== undefined) out += '</a>'
      openLink = segment.linkIndex
      if (openLink !== undefined) out += `<a k="${openLink}">`
    }
    closeFormats(segment.format)
    for (const [bit, tag] of FORMAT_TAGS) {
      if (segment.format & bit && !(openFormat & bit)) {
        out += `<${tag}>`
        openFormat |= bit
      }
    }
    out += escapeText(segment.text)
  }

  closeFormats(0)
  if (openLink !== undefined) out += '</a>'
  return out
}

export type TaggedRun = { text: string; format: number; linkIndex?: number }

/** Parse a tagged string back into runs of text with a format mask and a link index. */
export function parseTagged(tagged: string): TaggedRun[] {
  const runs: TaggedRun[] = []
  const formatStack: number[] = []
  let linkIndex: number | undefined
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer === '') return
    const format = formatStack.reduce((acc, bit) => acc | bit, 0)
    const run: TaggedRun = { text: unescapeText(buffer), format }
    if (linkIndex !== undefined) run.linkIndex = linkIndex
    runs.push(run)
    buffer = ''
  }

  while (i < tagged.length) {
    if (tagged[i] !== '<') {
      buffer += tagged[i]
      i++
      continue
    }
    const close = tagged.indexOf('>', i)
    if (close === -1) {
      buffer += tagged.slice(i)
      break
    }
    const raw = tagged.slice(i + 1, close)
    i = close + 1

    if (raw.startsWith('/')) {
      flush()
      const name = raw.slice(1)
      if (name === 'a') linkIndex = undefined
      else {
        const bit = TAG_BY_NAME.get(name)
        if (bit !== undefined) {
          const at = formatStack.lastIndexOf(bit)
          if (at !== -1) formatStack.splice(at, 1)
        }
      }
      continue
    }

    const linkMatch = /^a\s+k="(\d+)"$/.exec(raw)
    if (linkMatch) {
      flush()
      linkIndex = Number(linkMatch[1])
      continue
    }

    const bit = TAG_BY_NAME.get(raw)
    if (bit !== undefined) {
      flush()
      formatStack.push(bit)
      continue
    }

    // An unknown tag is treated as literal text rather than dropped.
    buffer += `<${raw}>`
  }

  flush()
  return runs
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function getByAddr(doc: LexicalRoot, addr: string): AnyNode | undefined {
  let node: AnyNode | undefined = doc.root
  for (const part of addr.split('/')) {
    if (!node) return undefined
    if (part.startsWith('fields.')) {
      const value: unknown = node.fields?.[part.slice(7)]
      node = isLexical(value) ? (value as LexicalRoot).root : undefined
      continue
    }
    node = node.children?.[Number(part)]
  }
  return node
}

export class TagMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagMismatchError'
  }
}

/**
 * Write one translated unit back into a copy of the source document.
 *
 * Only `children` of the block-level node is rebuilt. The node itself keeps its
 * type, its heading tag, its list type, its indent and its version. Link nodes
 * are restored by index with their `url`, `doc` and `newTab` fields intact.
 *
 * Throws `TagMismatchError` when the translation does not use the same link
 * indices as the source. The caller then falls back to per-node translation.
 */
export function applyUnit(doc: LexicalRoot, unit: string, tagged: string, source: TextSegment[]): void {
  const runs = parseTagged(tagged)
  const parent = getByAddr(doc, unit)
  if (!parent) throw new TagMismatchError(`unit ${unit} not found`)

  const sourceLinks = new Set(source.filter((s) => s.linkIndex !== undefined).map((s) => s.linkIndex))
  const runLinks = new Set(runs.filter((r) => r.linkIndex !== undefined).map((r) => r.linkIndex))
  if (sourceLinks.size !== runLinks.size || [...runLinks].some((k) => !sourceLinks.has(k))) {
    throw new TagMismatchError(`unit ${unit}: link indices do not match the source`)
  }

  // Keep the original link nodes so their fields survive.
  const linkNodes = new Map<number, AnyNode>()
  let seen = 0
  const collect = (node: AnyNode | undefined) => {
    if (!node || typeof node !== 'object') return
    const type = String(node.type ?? '')
    if (type === 'link' || type === 'autolink') {
      linkNodes.set(seen++, node)
      return
    }
    for (const child of node.children ?? []) collect(child)
  }
  collect(parent)

  // A donor text node, so style, mode, detail and version survive.
  const donor = findFirstTextNode(parent) ?? { type: 'text', style: '', mode: 'normal', detail: 0, version: 1 }
  const makeText = (run: TaggedRun): AnyNode => ({
    type: 'text',
    text: run.text,
    format: run.format,
    style: donor.style ?? '',
    mode: donor.mode ?? 'normal',
    detail: donor.detail ?? 0,
    version: donor.version ?? 1,
  })

  const children: AnyNode[] = []
  let index = 0
  while (index < runs.length) {
    const run = runs[index]!
    if (run.linkIndex === undefined) {
      children.push(makeText(run))
      index++
      continue
    }
    const key = run.linkIndex
    const inside: AnyNode[] = []
    while (index < runs.length && runs[index]!.linkIndex === key) {
      inside.push(makeText(runs[index]!))
      index++
    }
    const original = linkNodes.get(key)
    children.push(original ? { ...original, children: inside } : { type: 'link', children: inside, version: 1 })
  }

  parent.children = children
  // Let lexical recompute the direction, so a right-to-left target renders.
  parent.direction = null
}

function findFirstTextNode(node: AnyNode | undefined): AnyNode | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (String(node.type ?? '') === 'text') return node
  for (const child of node.children ?? []) {
    const found = findFirstTextNode(child)
    if (found) return found
  }
  return undefined
}

/**
 * Replace the text of each segment one by one, changing nothing else.
 * This is the fallback when the tagged form comes back malformed.
 */
export function applySegments(doc: LexicalRoot, replacements: Map<string, string>): void {
  const walk = (node: AnyNode | undefined, addr: string): void => {
    if (!node || typeof node !== 'object') return
    if (String(node.type ?? '') === 'text') {
      const next = replacements.get(addr)
      if (next !== undefined) node.text = next
      return
    }
    if (node.fields) {
      for (const [key, value] of Object.entries(node.fields)) {
        if (isLexical(value)) walk((value as LexicalRoot).root, `${addr}/fields.${key}`)
      }
    }
    for (const [i, child] of (node.children ?? []).entries()) walk(child, `${addr}/${i}`)
  }
  for (const [i, child] of (doc.root.children ?? []).entries()) walk(child, String(i))
}

/**
 * Check that a rebuilt document still matches the source structure.
 * A write that fails this check must be dropped, not sent.
 */
export function assertRoundTrip(source: unknown, rebuilt: unknown): void {
  const before = toUnits(source)
  const after = toUnits(rebuilt)
  if (before.length !== after.length) {
    throw new TagMismatchError(`unit count changed: ${before.length} -> ${after.length}`)
  }
  for (const [i, unit] of before.entries()) {
    const other = after[i]!
    if (unit.unit !== other.unit) {
      throw new TagMismatchError(`unit address changed: ${unit.unit} -> ${other.unit}`)
    }
    const links = (list: TextSegment[]) =>
      [...new Set(list.filter((s) => s.linkIndex !== undefined).map((s) => s.linkIndex))].sort()
    const a = links(unit.segments).join(',')
    const b = links(other.segments).join(',')
    if (a !== b) throw new TagMismatchError(`unit ${unit.unit}: link set changed`)
  }
}

/** Deep copy a lexical document. Used to build a target from a source. */
export function cloneLexical<T>(doc: T): T {
  return structuredClone(doc)
}
