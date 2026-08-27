/**
 * Minimal protobuf wire-format reader.
 *
 * Only the subset of OTLP's trace schema that PAO consumes is decoded. A
 * hand-rolled reader is used instead of a codegen library to keep the API's
 * dependency surface unchanged — the same constraint that keeps the SDK
 * zero-runtime-dep and lets a verified n8n node embed this logic later.
 *
 * Wire types: 0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit.
 */

export const WireType = {
  Varint: 0,
  Fixed64: 1,
  LengthDelimited: 2,
  Fixed32: 5,
} as const

export type Field = {
  fieldNumber: number
  wireType: number
  /** Present for wire type 0 and 1. */
  value?: bigint
  /** Present for wire type 2. */
  bytes?: Uint8Array
}

/**
 * Decode one protobuf message into a map of field number → occurrences.
 * Repeated fields keep every occurrence, in order.
 */
export function decodeMessage(buf: Uint8Array): Map<number, Field[]> {
  const fields = new Map<number, Field[]>()
  let offset = 0

  while (offset < buf.length) {
    const [tag, tagLen] = readVarint(buf, offset)
    offset += tagLen

    const fieldNumber = Number(tag >> 3n)
    const wireType = Number(tag & 7n)

    // Field number 0 is invalid and signals a corrupt stream; bail out rather
    // than spinning on malformed input.
    if (fieldNumber === 0) break

    let field: Field

    switch (wireType) {
      case WireType.Varint: {
        const [value, len] = readVarint(buf, offset)
        offset += len
        field = { fieldNumber, wireType, value }
        break
      }
      case WireType.Fixed64: {
        field = { fieldNumber, wireType, value: readFixed64(buf, offset) }
        offset += 8
        break
      }
      case WireType.LengthDelimited: {
        const [len, lenLen] = readVarint(buf, offset)
        offset += lenLen
        const end = offset + Number(len)
        if (end > buf.length) throw new Error('OTLP payload truncated')
        field = { fieldNumber, wireType, bytes: buf.subarray(offset, end) }
        offset = end
        break
      }
      case WireType.Fixed32: {
        field = { fieldNumber, wireType, value: BigInt(readFixed32(buf, offset)) }
        offset += 4
        break
      }
      default:
        throw new Error(`Unsupported protobuf wire type: ${wireType}`)
    }

    const existing = fields.get(fieldNumber)
    if (existing) existing.push(field)
    else fields.set(fieldNumber, [field])
  }

  return fields
}

function readVarint(buf: Uint8Array, start: number): [bigint, number] {
  let result = 0n
  let shift = 0n
  let offset = start

  while (offset < buf.length) {
    const byte = buf[offset]!
    result |= BigInt(byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) return [result, offset - start]
    shift += 7n
    // A varint never exceeds 10 bytes; anything longer is malformed.
    if (shift > 63n) throw new Error('Malformed protobuf varint')
  }

  throw new Error('OTLP payload truncated inside varint')
}

function readFixed64(buf: Uint8Array, offset: number): bigint {
  if (offset + 8 > buf.length) throw new Error('OTLP payload truncated')
  let result = 0n
  for (let i = 7; i >= 0; i -= 1) {
    result = (result << 8n) | BigInt(buf[offset + i]!)
  }
  return result
}

function readFixed32(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) throw new Error('OTLP payload truncated')
  return (
    buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)
  )
}

// ── Field accessors ──────────────────────────────────────────────────────────

export function getBytes(fields: Map<number, Field[]>, fieldNumber: number): Uint8Array | undefined {
  return fields.get(fieldNumber)?.[0]?.bytes
}

export function getRepeatedBytes(
  fields: Map<number, Field[]>,
  fieldNumber: number,
): Uint8Array[] {
  return (fields.get(fieldNumber) ?? []).flatMap((f) => (f.bytes ? [f.bytes] : []))
}

export function getString(fields: Map<number, Field[]>, fieldNumber: number): string | undefined {
  const bytes = getBytes(fields, fieldNumber)
  return bytes ? new TextDecoder().decode(bytes) : undefined
}

export function getVarint(fields: Map<number, Field[]>, fieldNumber: number): bigint | undefined {
  return fields.get(fieldNumber)?.[0]?.value
}

export function toHex(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length === 0) return undefined
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
