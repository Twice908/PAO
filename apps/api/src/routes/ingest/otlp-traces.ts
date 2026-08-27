import { gunzipSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@pulse/db'
import { hashApiKey } from '../../lib/api-key'
import { agentSpansQueue } from '../../lib/queue'
import { decodeTracesJson, decodeTracesProtobuf, toPaoPayloads } from '../../lib/otlp/decode-traces'

/**
 * OTLP/HTTP trace ingest.
 *
 * Lets any OpenTelemetry-instrumented agent report to PAO with no PAO-specific
 * code: n8n (N8N_OTEL_ENABLED + N8N_AGENTS_TRACING_ENABLED), OpenLLMetry,
 * OpenInference, or a plain OTel collector, simply by pointing the OTLP
 * exporter here.
 *
 * Deviations from a strict OTLP server, all deliberate:
 *   - Auth is PAO's own Bearer API key rather than anything OTLP specifies;
 *     exporters pass it via OTEL_EXPORTER_OTLP_HEADERS.
 *   - The response body is JSON, not a protobuf ExportTraceServiceResponse.
 *     Exporters treat any 2xx as success, and emitting protobuf would mean
 *     hand-encoding a message for no gain.
 */

const OTLP_TRACES_PATH = '/ingest/otlp/v1/traces'
const MAX_BODY_BYTES = 4 * 1024 * 1024

export async function otlpTraceRoutes(app: FastifyInstance): Promise<void> {
  // Capture the raw body: protobuf is binary, and gzip may wrap either
  // encoding. Fastify's default parsers would mangle both.
  app.addContentTypeParser(
    ['application/x-protobuf', 'application/protobuf', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  app.post(OTLP_TRACES_PATH, { bodyLimit: MAX_BODY_BYTES }, async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' },
      })
    }

    const project = await prisma.project.findUnique({
      where: { apiKeyHash: hashApiKey(authHeader.slice('Bearer '.length)) },
    })

    if (!project) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      })
    }

    const contentType = (request.headers['content-type'] ?? '').toLowerCase()
    const isProtobuf = contentType.includes('protobuf') || contentType.includes('octet-stream')

    let decoded
    try {
      if (isProtobuf) {
        let raw = request.body as Buffer
        if (!Buffer.isBuffer(raw)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'Expected a binary protobuf body' },
          })
        }
        if ((request.headers['content-encoding'] ?? '').includes('gzip')) {
          raw = gunzipSync(raw)
        }
        decoded = decodeTracesProtobuf(new Uint8Array(raw))
      } else {
        decoded = decodeTracesJson(request.body)
      }
    } catch (err: unknown) {
      request.log.warn({ err }, 'Failed to decode OTLP trace payload')
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Malformed OTLP trace payload' },
      })
    }

    const payloads = toPaoPayloads(decoded.spans)

    // Fire and forget, matching /ingest/agent-span: an exporter must never
    // block on PAO's queue.
    for (const payload of payloads) {
      agentSpansQueue.add('process', { ...payload, projectId: project.id }).catch((err: unknown) => {
        request.log.warn({ err }, 'Failed to enqueue OTLP-derived span')
      })
    }

    // OTLP models dropped data as partial success on a 2xx, not as an error.
    return reply.status(200).send({
      partialSuccess:
        decoded.rejected > 0
          ? {
              rejectedSpans: decoded.rejected,
              errorMessage: 'Spans missing a trace id, span id, or start timestamp were dropped',
            }
          : {},
    })
  })
}
