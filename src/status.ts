import { createHash } from 'node:crypto'
import { extractPlainText, extractSegments, hasMediaNodes, isLexical } from './lexical.js'
import type { LeafKind, UnitStatus, UnitValue } from './types.js'

/**
 * Normalize text before hashing, so that a change of spacing or of Unicode
 * form does not mark a translation as out of date.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A stable JSON string: object keys sorted, so a key reorder is not a change. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'direction' && key !== 'version')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Hash of the structure of a rich text document, ignoring the text itself.
 * A change here means the layout moved, not that the wording moved.
 */
export function structureHash(value: unknown): string | undefined {
  if (!isLexical(value)) return undefined
  const stripped = structuredClone(value) as Record<string, any>
  const strip = (node: Record<string, any> | undefined): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') node.text = ''
    for (const child of node.children ?? []) strip(child)
    for (const field of Object.values(node.fields ?? {})) {
      if (isLexical(field)) strip((field as { root: Record<string, any> }).root)
    }
  }
  strip(stripped.root)
  return sha256(stableStringify(stripped))
}

/** The readable text of a value, whatever its kind. */
export function readText(kind: LeafKind, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (kind === 'richtext') return extractPlainText(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Decide whether a value counts as a translation.
 *
 * Rich text with no words but with an upload, a table or a rule is reported as
 * `empty_media_only`. That is a deliberate choice by an editor, not a gap.
 */
export function evaluate(kind: LeafKind, value: unknown, rowPresent: boolean): UnitValue {
  if (!rowPresent) return { status: 'missing_row', len: 0 }
  if (value === null || value === undefined) return { status: 'missing_null', len: 0 }

  if (kind === 'richtext') {
    const segments = extractSegments(value)
    const text = normalize(segments.map((s) => s.text).join(' '))
    if (text === '') {
      return { status: hasMediaNodes(value) ? 'empty_media_only' : 'missing_empty', len: 0 }
    }
    return {
      status: 'ok',
      hash: sha256(text),
      len: text.length,
      preview: text.slice(0, 160),
    }
  }

  const text = normalize(readText(kind, value))
  if (text === '') return { status: 'missing_empty', len: 0 }
  return {
    status: 'ok',
    hash: sha256(text),
    len: text.length,
    preview: text.slice(0, 160),
  }
}

/** True when the status means a translator still has work to do. */
export function isGap(status: UnitStatus): boolean {
  return status === 'missing_row' || status === 'missing_null' || status === 'missing_empty'
}
