/**
 * Guards the published OpenAPI spec against drift from the implementation.
 *
 * The spec at apps/api/openapi/openapi.yaml is a public contract — Zapier
 * requires current public API docs to publish an integration, and Make imports
 * app definitions from it. A spec that quietly disagrees with the code is worse
 * than no spec, so every documented claim is asserted against the real Zod
 * schema here rather than reviewed by eye.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { AgentSpanBatchSchema } from './agent-span.schema'

type OpenApiSpec = {
  paths: Record<string, Record<string, {
    requestBody?: { content: Record<string, { examples?: Record<string, { value: unknown }> }> }
  }>>
  components: { schemas: Record<string, Record<string, unknown>> }
}

const spec = yaml.load(
  readFileSync(join(__dirname, '../../openapi/openapi.yaml'), 'utf8'),
) as OpenApiSpec

const NOW = new Date().toISOString()
const accepts = (body: unknown): boolean => AgentSpanBatchSchema.safeParse(body).success

const schemas = spec.components.schemas
const spanProps = schemas.Span!.properties as Record<string, Record<string, unknown>>
const runEndProps = schemas.RunEnd!.properties as Record<string, Record<string, unknown>>

describe('OpenAPI spec matches the ingest implementation', () => {
  it('documents every request example in a form the API actually accepts', () => {
    const examples =
      spec.paths['/ingest/agent-span']!.post!.requestBody!.content['application/json']!.examples ??
      {}

    expect(Object.keys(examples).length).toBeGreaterThan(0)
    for (const [name, example] of Object.entries(examples)) {
      expect(accepts(example.value), `example "${name}" must validate`).toBe(true)
    }
  })

  it('documents the same span types the schema enforces', () => {
    expect(schemas.SpanType!.enum).toEqual([
      'llm_call',
      'tool_call',
      'memory_read',
      'agent_message',
      'error',
    ])
  })

  it('accepts every documented span status and no run status', () => {
    for (const status of spanProps.status!.enum as string[]) {
      expect(
        accepts([{ type: 'span', runId: 'r', spanType: 'llm_call', name: 'n', startedAt: NOW, status }]),
        `span status "${status}"`,
      ).toBe(true)
    }
    expect(
      accepts([{ type: 'span', runId: 'r', spanType: 'llm_call', name: 'n', startedAt: NOW, status: 'completed' }]),
    ).toBe(false)
  })

  it('accepts every documented run status and no span status', () => {
    for (const status of runEndProps.status!.enum as string[]) {
      expect(accepts([{ type: 'run_end', runId: 'r', startedAt: NOW, status }]), `run status "${status}"`).toBe(true)
    }
    expect(accepts([{ type: 'run_end', runId: 'r', startedAt: NOW, status: 'success' }])).toBe(false)
  })

  it('enforces the fields the spec marks required on a span', () => {
    expect(schemas.Span!.required).toEqual(['type', 'runId', 'spanType', 'name', 'startedAt'])
    expect(accepts([{ type: 'span', runId: 'r', name: 'n', startedAt: NOW }])).toBe(false)
    expect(accepts([{ type: 'span', runId: 'r', spanType: 'llm_call', startedAt: NOW }])).toBe(false)
  })

  it('leaves spanId optional, as documented', () => {
    expect(schemas.Span!.required).not.toContain('spanId')
    expect(accepts([{ type: 'span', runId: 'r', spanType: 'llm_call', name: 'n', startedAt: NOW }])).toBe(true)
  })

  it('accepts both timestamp forms shown in the Timestamp examples', () => {
    for (const ts of schemas.Timestamp!.examples as string[]) {
      expect(accepts([{ type: 'run_start', runId: 'r', startedAt: ts }]), ts).toBe(true)
    }
  })

  it('enforces the documented preview length limit', () => {
    const max = spanProps.inputPreview!.maxLength as number
    const span = { type: 'span', runId: 'r', spanType: 'llm_call', name: 'n', startedAt: NOW }
    expect(accepts([{ ...span, inputPreview: 'x'.repeat(max) }])).toBe(true)
    expect(accepts([{ ...span, inputPreview: 'x'.repeat(max + 1) }])).toBe(false)
  })

  it('documents the OTLP endpoint that the API exposes', () => {
    expect(spec.paths['/ingest/otlp/v1/traces']).toBeDefined()
    expect(spec.paths['/ingest/agent-span']).toBeDefined()
  })
})
