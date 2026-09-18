/**
 * A row id that follows from the key.
 *
 * The id joins the languages of one row: Payload hangs the translated value
 * from it. A deterministic id gives a key the same row in every environment
 * and on every read, so a row is updated and never recreated. A recreated row
 * loses the translations of every other language.
 *
 * FNV-1a, three times with a different seed, gives 96 bits. That is written as
 * 24 hexadecimal characters, the shape Payload gives a row of its own. It is
 * plain arithmetic, so this file needs no import and runs anywhere.
 */
export function rowId(key: string): string {
  let out = ''

  for (let seed = 0; seed < 3; seed++) {
    let hash = (0x811c9dc5 ^ seed) >>> 0
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    out += hash.toString(16).padStart(8, '0')
  }

  return out
}
