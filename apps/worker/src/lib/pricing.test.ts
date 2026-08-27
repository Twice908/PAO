import { describe, it, expect } from 'vitest'
import { deriveCostUsd, resolveModelPrice } from './pricing'

describe('resolveModelPrice', () => {
  it('resolves a known model', () => {
    expect(resolveModelPrice('gpt-4o')).toEqual({ input: 2.5, output: 10 })
  })

  it('strips a vendor prefix', () => {
    expect(resolveModelPrice('anthropic/claude-sonnet-4')).toEqual({ input: 3, output: 15 })
  })

  it('matches a dated model suffix', () => {
    expect(resolveModelPrice('claude-sonnet-4-20250514')).toEqual({ input: 3, output: 15 })
  })

  it('is case-insensitive', () => {
    expect(resolveModelPrice('GPT-4O')).toEqual({ input: 2.5, output: 10 })
  })

  it('prefers the most specific key over a shorter prefix', () => {
    // 'gpt-4o-mini' must not resolve to the cheaper-to-match 'gpt-4o'
    expect(resolveModelPrice('gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 })
    // 'claude-haiku-4-5' must not fall through to 'claude-3-haiku'
    expect(resolveModelPrice('claude-haiku-4-5')).toEqual({ input: 1, output: 5 })
  })

  it('resolves table keys that contain a dot', () => {
    // Regression: normalising '.'→'-' on the input but not on the table keys
    // made every dotted entry unreachable.
    expect(resolveModelPrice('gemini-1.5-flash')).toEqual({ input: 0.075, output: 0.3 })
    expect(resolveModelPrice('gpt-3.5-turbo')).toEqual({ input: 0.5, output: 1.5 })
  })

  it('treats dot, underscore and dash separators as equivalent', () => {
    expect(resolveModelPrice('gemini-1_5-pro')).toEqual(resolveModelPrice('gemini-1.5-pro'))
  })

  it('returns undefined for an unknown model', () => {
    expect(resolveModelPrice('llama-3-70b')).toBeUndefined()
  })

  it('returns undefined for undefined or empty input', () => {
    expect(resolveModelPrice(undefined)).toBeUndefined()
    expect(resolveModelPrice('')).toBeUndefined()
  })
})

describe('deriveCostUsd', () => {
  it('computes cost from input and output tokens', () => {
    // 1000 * 2.5/1M + 500 * 10/1M = 0.0025 + 0.005 = 0.0075
    expect(deriveCostUsd('gpt-4o', 1000, 500)).toBeCloseTo(0.0075, 9)
  })

  it('treats a missing token count as zero', () => {
    expect(deriveCostUsd('gpt-4o', 1000, undefined)).toBeCloseTo(0.0025, 9)
    expect(deriveCostUsd('gpt-4o', undefined, 500)).toBeCloseTo(0.005, 9)
  })

  it('returns undefined when the model is unknown', () => {
    expect(deriveCostUsd('some-local-model', 1000, 500)).toBeUndefined()
  })

  it('returns undefined when no tokens were reported', () => {
    // Never record a false $0 for a span that simply had no usage data.
    expect(deriveCostUsd('gpt-4o', undefined, undefined)).toBeUndefined()
  })

  it('returns 0 for explicit zero token counts', () => {
    expect(deriveCostUsd('gpt-4o', 0, 0)).toBe(0)
  })

  it('rounds to the 6dp precision of Decimal(10, 6)', () => {
    const cost = deriveCostUsd('gemini-1.5-flash', 1, 1)
    expect(cost).toBe(Math.round((cost as number) * 1e6) / 1e6)
  })
})
