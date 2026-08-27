/**
 * Server-side cost derivation.
 *
 * Callers that hand-assemble spans (n8n, Make, Zapier, raw webhooks) and
 * OpenTelemetry exporters almost never supply `costUsd` — they have tokens and
 * a model name but no pricing table and no way to multiply in an expression
 * editor. Without this module every non-SDK source silently reports $0, which
 * makes cost dashboards and cost-based alerts wrong rather than merely empty.
 *
 * Prices are USD per 1,000,000 tokens.
 */

export type ModelPrice = {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
}

const TOKENS_PER_PRICE_UNIT = 1_000_000

/**
 * Keys are matched case-insensitively against a normalised model name. Order
 * matters: `resolveModelPrice` prefers the longest matching key so that
 * `claude-haiku-4-5` never resolves against a shorter `claude-haiku` entry.
 */
const PRICE_TABLE: Record<string, ModelPrice> = {
  // ── Anthropic ──
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },

  // ── OpenAI ──
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o1': { input: 15, output: 60 },

  // ── Google ──
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
}

/**
 * Normalise vendor-prefixed and versioned model names to a comparable form:
 * `anthropic/Claude-Sonnet-4-20250514` → `claude-sonnet-4-20250514`.
 *
 * `.` and `_` collapse to `-` so that `gemini-1.5-flash` and `gemini-1_5-flash`
 * both reach the same entry.
 */
function normaliseModelName(model: string): string {
  const withoutVendor = model.toLowerCase().trim().split('/').pop() ?? ''
  return withoutVendor.replace(/[._]/g, '-')
}

/**
 * Lookup keys are normalised with the same function as incoming model names —
 * otherwise a table key written with a dot (`gemini-1.5-flash`) could never be
 * matched, since the incoming name has already had its dots collapsed.
 * Longest keys first so specific entries win over generic prefixes.
 */
const NORMALISED_PRICE_ENTRIES: ReadonlyArray<readonly [string, ModelPrice]> = Object.entries(
  PRICE_TABLE,
)
  .map(([key, price]) => [normaliseModelName(key), price] as const)
  .sort(([a], [b]) => b.length - a.length)

export function resolveModelPrice(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined

  const normalised = normaliseModelName(model)
  if (!normalised) return undefined

  return NORMALISED_PRICE_ENTRIES.find(([key]) => normalised.includes(key))?.[1]
}

/**
 * Derive a span's USD cost from its token counts.
 *
 * Returns `undefined` when the model is unknown or no tokens were reported,
 * so the caller can leave `costUsd` null rather than recording a false zero.
 */
export function deriveCostUsd(
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const price = resolveModelPrice(model)
  if (!price) return undefined
  if (inputTokens == null && outputTokens == null) return undefined

  const cost =
    ((inputTokens ?? 0) * price.input + (outputTokens ?? 0) * price.output) / TOKENS_PER_PRICE_UNIT

  // AgentSpan.costUsd is Decimal(10, 6); round to the storable precision.
  return Math.round(cost * 1e6) / 1e6
}
