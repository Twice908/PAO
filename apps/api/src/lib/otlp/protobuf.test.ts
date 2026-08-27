import { describe, it, expect } from 'vitest'
import { decodeMessage, getString, getVarint, getBytes, getRepeatedBytes, toHex } from './protobuf'

// ─── Minimal encoder, used only to generate fixtures ─────────────────────────

function varint(n: bigint | number): number[] {
  let v = BigInt(n)
  const out: number[] = []
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) byte |= 0x80
    out.push(byte)
  } while (v > 0n)
  return out
}

const tag = (field: number, wire: number): number[] => varint((field << 3) | wire)

function lenDelim(field: number, payload: number[] | Uint8Array): number[] {
  const bytes = Array.from(payload)
  return [...tag(field, 2), ...varint(bytes.length), ...bytes]
}

const str = (field: number, s: string): number[] =>
  lenDelim(field, Array.from(new TextEncoder().encode(s)))

const vint = (field: number, n: number | bigint): number[] => [...tag(field, 0), ...varint(n)]

function fixed64(field: number, n: bigint): number[] {
  const out = [...tag(field, 1)]
  for (let i = 0; i < 8; i += 1) out.push(Number((n >> BigInt(8 * i)) & 0xffn))
  return out
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('decodeMessage', () => {
  it('decodes a length-delimited string field', () => {
    const fields = decodeMessage(new Uint8Array(str(1, 'hello')))
    expect(getString(fields, 1)).toBe('hello')
  })

  it('decodes a varint field', () => {
    const fields = decodeMessage(new Uint8Array(vint(6, 3)))
    expect(getVarint(fields, 6)).toBe(3n)
  })

  it('decodes multi-byte varints', () => {
    const fields = decodeMessage(new Uint8Array(vint(1, 300)))
    expect(getVarint(fields, 1)).toBe(300n)
  })

  it('decodes a fixed64 field preserving nanosecond precision', () => {
    const nanos = 1756108800123456789n
    const fields = decodeMessage(new Uint8Array(fixed64(7, nanos)))
    expect(getVarint(fields, 7)).toBe(nanos)
  })

  it('keeps every occurrence of a repeated field in order', () => {
    const msg = new Uint8Array([...str(2, 'a'), ...str(2, 'b'), ...str(2, 'c')])
    const fields = decodeMessage(msg)
    expect(getRepeatedBytes(fields, 2).map((b) => new TextDecoder().decode(b))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('decodes nested messages', () => {
    const inner = str(1, 'nested')
    const fields = decodeMessage(new Uint8Array(lenDelim(9, inner)))
    const innerFields = decodeMessage(getBytes(fields, 9)!)
    expect(getString(innerFields, 1)).toBe('nested')
  })

  it('skips unknown fields without failing', () => {
    // Field 99 is not one PAO reads; it must not break decoding of field 1.
    const msg = new Uint8Array([...str(99, 'ignored'), ...str(1, 'kept')])
    const fields = decodeMessage(msg)
    expect(getString(fields, 1)).toBe('kept')
  })

  it('returns undefined for absent fields', () => {
    const fields = decodeMessage(new Uint8Array(str(1, 'x')))
    expect(getString(fields, 5)).toBeUndefined()
    expect(getVarint(fields, 5)).toBeUndefined()
  })

  it('throws on a truncated length-delimited payload', () => {
    // Declares 10 bytes but supplies 2.
    const msg = new Uint8Array([...tag(1, 2), ...varint(10), 0x61, 0x62])
    expect(() => decodeMessage(msg)).toThrow(/truncated/)
  })

  it('throws on an unsupported wire type', () => {
    expect(() => decodeMessage(new Uint8Array([...tag(1, 3)]))).toThrow(/wire type/)
  })

  it('handles an empty message', () => {
    expect(decodeMessage(new Uint8Array()).size).toBe(0)
  })
})

describe('toHex', () => {
  it('hex-encodes a trace id with zero padding', () => {
    const bytes = new Uint8Array([0x00, 0x0a, 0xff, 0x10])
    expect(toHex(bytes)).toBe('000aff10')
  })

  it('returns undefined for empty or absent bytes', () => {
    expect(toHex(new Uint8Array())).toBeUndefined()
    expect(toHex(undefined)).toBeUndefined()
  })
})
