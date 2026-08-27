/**
 * OTLP attribute extraction, shared by the protobuf and JSON decoders.
 *
 * Attribute values are flattened to primitives; anything structured is
 * JSON-stringified so it can still ride along in `metadata` rather than being
 * dropped. The GenAI conventions are at Development status and their attribute
 * names still change between versions, so nothing here may throw on an
 * unrecognised key — unknown attributes are preserved, never rejected.
 */

import { decodeMessage, getBytes, getRepeatedBytes, getString, getVarint } from './protobuf'

export type AttributeValue = string | number | boolean

/** AnyValue field numbers, per opentelemetry/proto/common/v1/common.proto. */
const ANY_STRING = 1
const ANY_BOOL = 2
const ANY_INT = 3
const ANY_DOUBLE = 4
const ANY_ARRAY = 5
const ANY_KVLIST = 6
const ANY_BYTES = 7

const KV_KEY = 1
const KV_VALUE = 2

function decodeAnyValue(buf: Uint8Array): AttributeValue | undefined {
  const v = decodeMessage(buf)

  const s = getString(v, ANY_STRING)
  if (s !== undefined) return s

  const b = getVarint(v, ANY_BOOL)
  if (b !== undefined) return b !== 0n

  const i = getVarint(v, ANY_INT)
  if (i !== undefined) {
    // Token counts and byte sizes fit comfortably in a JS number; clamp only
    // to avoid silently corrupting anything beyond 2^53.
    return i <= BigInt(Number.MAX_SAFE_INTEGER) && i >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(i)
      : i.toString()
  }

  const d = getVarint(v, ANY_DOUBLE)
  if (d !== undefined) {
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setBigUint64(0, d, true)
    return new DataView(buffer).getFloat64(0, true)
  }

  // Structured values are preserved as JSON text rather than discarded.
  const arr = getBytes(v, ANY_ARRAY)
  if (arr !== undefined) {
    const values = getRepeatedBytes(decodeMessage(arr), 1).map(decodeAnyValue)
    return JSON.stringify(values)
  }

  const kv = getBytes(v, ANY_KVLIST)
  if (kv !== undefined) return JSON.stringify(decodeAttributes(getRepeatedBytes(decodeMessage(kv), 1)))

  const bytes = getBytes(v, ANY_BYTES)
  if (bytes !== undefined) return Buffer.from(bytes).toString('base64')

  return undefined
}

/** Decode a list of protobuf-encoded KeyValue messages into a flat record. */
export function decodeAttributes(kvBuffers: Uint8Array[]): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}

  for (const buf of kvBuffers) {
    const kv = decodeMessage(buf)
    const key = getString(kv, KV_KEY)
    if (!key) continue

    const valueBytes = getBytes(kv, KV_VALUE)
    if (!valueBytes) continue

    const value = decodeAnyValue(valueBytes)
    if (value !== undefined) out[key] = value
  }

  return out
}

/**
 * Flatten an OTLP/JSON `AnyValue` object, e.g. `{ "stringValue": "gpt-4o" }`.
 * Accepts both camelCase (protobuf JSON mapping) and snake_case, since
 * exporters in the wild emit both.
 */
export function flattenJsonAnyValue(value: unknown): AttributeValue | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>

  const pick = (camel: string, snake: string): unknown => v[camel] ?? v[snake]

  const s = pick('stringValue', 'string_value')
  if (typeof s === 'string') return s

  const b = pick('boolValue', 'bool_value')
  if (typeof b === 'boolean') return b

  const i = pick('intValue', 'int_value')
  // int64 is encoded as a string in protobuf JSON.
  if (typeof i === 'number') return i
  if (typeof i === 'string' && i !== '' && Number.isFinite(Number(i))) return Number(i)

  const d = pick('doubleValue', 'double_value')
  if (typeof d === 'number') return d

  const arr = pick('arrayValue', 'array_value')
  if (arr && typeof arr === 'object') {
    const values = (arr as { values?: unknown[] }).values ?? []
    return JSON.stringify(values.map(flattenJsonAnyValue))
  }

  const kv = pick('kvlistValue', 'kvlist_value')
  if (kv && typeof kv === 'object') {
    const values = (kv as { values?: unknown[] }).values ?? []
    return JSON.stringify(flattenJsonAttributes(values))
  }

  const bytes = pick('bytesValue', 'bytes_value')
  if (typeof bytes === 'string') return bytes

  return undefined
}

/** Flatten an OTLP/JSON attribute array into a record. */
export function flattenJsonAttributes(attributes: unknown): Record<string, AttributeValue> {
  if (!Array.isArray(attributes)) return {}

  const out: Record<string, AttributeValue> = {}
  for (const entry of attributes) {
    if (!entry || typeof entry !== 'object') continue
    const { key, value } = entry as { key?: unknown; value?: unknown }
    if (typeof key !== 'string') continue
    const flattened = flattenJsonAnyValue(value)
    if (flattened !== undefined) out[key] = flattened
  }
  return out
}
