import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Job } from 'bullmq'
import { processAgentSpan } from './agent-span.processor'
import type { AgentSpanJobData } from './agent-span.processor'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('pino', () => ({
  default: vi.fn(() => mockLogger),
}))

const mockPrisma = vi.hoisted(() => ({
  agentRun: {
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  agentDefinition: {
    upsert: vi.fn(),
  },
  agentSpan: {
    upsert: vi.fn(),
    aggregate: vi.fn(),
  },
}))

vi.mock('@pulse/db', () => ({
  prisma: mockPrisma,
  Prisma: {},
}))

vi.mock('../lib/redis', () => ({
  redis: { publish: vi.fn() },
}))

vi.mock('../lib/alert-evaluator', () => ({
  evaluateAgentRunAlerts: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../env', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    RESEND_FROM_EMAIL: 'alerts@pulse.dev',
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString()
const RUN_ID = '123e4567-e89b-12d3-a456-426614174000'
const SPAN_ID = '223e4567-e89b-12d3-a456-426614174001'
const PROJECT_ID = 'proj_test'

function makeJob(data: AgentSpanJobData): Job<AgentSpanJobData> {
  return {
    id: 'test-job-id',
    data,
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as unknown as Job<AgentSpanJobData>
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processAgentSpan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.agentRun.upsert.mockResolvedValue({ id: RUN_ID })
    mockPrisma.agentRun.update.mockResolvedValue({ id: RUN_ID })
    mockPrisma.agentRun.findUnique.mockResolvedValue(null)
    mockPrisma.agentDefinition.upsert.mockResolvedValue({ id: 'def-1' })
    mockPrisma.agentSpan.upsert.mockResolvedValue({ id: SPAN_ID })
    mockPrisma.agentSpan.aggregate.mockResolvedValue({
      _sum: { totalTokens: 150, costUsd: 0.003 },
    })
  })

  // ── run_start ───────────────────────────────────────────────────────────────

  describe('run_start handler', () => {
    it('upserts AgentRun with correct fields', async () => {
      const job = makeJob({
        type: 'run_start',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        task: 'Summarize quarterly report',
        startedAt: NOW,
      })

      await processAgentSpan(job)

      expect(mockPrisma.agentRun.upsert).toHaveBeenCalledOnce()
      expect(mockPrisma.agentRun.upsert).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        update: {},
        create: {
          id: RUN_ID,
          projectId: PROJECT_ID,
          task: 'Summarize quarterly report',
          status: 'running',
          startedAt: new Date(NOW),
          totalTokens: 0,
          totalCostUsd: 0,
        },
      })
    })

    it('defaults task to empty string when absent', async () => {
      const job = makeJob({
        type: 'run_start',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        startedAt: NOW,
      })

      await processAgentSpan(job)

      expect(mockPrisma.agentRun.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ task: '' }) }),
      )
    })

    it('is idempotent — upsert update block is empty', async () => {
      const job = makeJob({
        type: 'run_start',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        startedAt: NOW,
      })

      await processAgentSpan(job)

      const call = mockPrisma.agentRun.upsert.mock.calls[0][0]
      expect(call.update).toEqual({})
    })
  })

  // ── span ────────────────────────────────────────────────────────────────────

  describe('span handler', () => {
    const baseSpan: AgentSpanJobData = {
      type: 'span',
      projectId: PROJECT_ID,
      runId: RUN_ID,
      spanId: SPAN_ID,
      spanType: 'llm_call',
      name: 'gpt-4o completion',
      model: 'gpt-4o',
      startedAt: NOW,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.002,
    }

    it('upserts AgentSpan keyed on id + startedAt', async () => {
      const job = makeJob(baseSpan)

      await processAgentSpan(job)

      expect(mockPrisma.agentSpan.upsert).toHaveBeenCalledOnce()
      const call = mockPrisma.agentSpan.upsert.mock.calls[0][0]
      expect(call.where).toEqual({ id_startedAt: { id: SPAN_ID, startedAt: new Date(NOW) } })
      expect(call.create).toMatchObject({
        id: SPAN_ID,
        runId: RUN_ID,
        projectId: PROJECT_ID,
        spanType: 'llm_call',
        name: 'gpt-4o completion',
      })
    })

    it('increments AgentRun totalTokens and totalCostUsd', async () => {
      const job = makeJob(baseSpan)

      await processAgentSpan(job)

      expect(mockPrisma.agentRun.update).toHaveBeenCalledOnce()
      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: {
          totalTokens: { increment: 150 },
          totalCostUsd: { increment: 0.002 },
        },
      })
    })

    it('upserts AgentDefinition when agentName is present', async () => {
      const job = makeJob({ ...baseSpan, agentName: 'ResearchAgent' })

      await processAgentSpan(job)

      expect(mockPrisma.agentDefinition.upsert).toHaveBeenCalledOnce()
      expect(mockPrisma.agentDefinition.upsert).toHaveBeenCalledWith({
        where: { projectId_name: { projectId: PROJECT_ID, name: 'ResearchAgent' } },
        update: {},
        create: { projectId: PROJECT_ID, name: 'ResearchAgent' },
      })
    })

    it('skips AgentDefinition upsert when agentName is absent', async () => {
      const job = makeJob(baseSpan)

      await processAgentSpan(job)

      expect(mockPrisma.agentDefinition.upsert).not.toHaveBeenCalled()
    })

    it('duplicate span ID is silently ignored via upsert update:{}', async () => {
      const job = makeJob(baseSpan)

      await expect(processAgentSpan(job)).resolves.toBeUndefined()
      expect(mockPrisma.agentSpan.upsert).toHaveBeenCalledOnce()
      expect(mockPrisma.agentSpan.upsert.mock.calls[0][0].update).toEqual({})
    })

    it('logs warning and does not throw when runId is missing', async () => {
      const job = makeJob({
        type: 'span',
        projectId: PROJECT_ID,
        runId: '' as string,
        spanId: SPAN_ID,
        spanType: 'llm_call',
        name: 'gpt-4o completion',
        startedAt: NOW,
      })

      await expect(processAgentSpan(job)).resolves.toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.any(Object) }),
        expect.stringContaining('missing runId'),
      )
      expect(mockPrisma.agentSpan.upsert).not.toHaveBeenCalled()
    })

    it('computes durationMs from startedAt and endedAt', async () => {
      const startedAt = '2024-01-01T00:00:00.000Z'
      const endedAt = '2024-01-01T00:00:01.500Z'
      const job = makeJob({ ...baseSpan, startedAt, endedAt })

      await processAgentSpan(job)

      const spanData = mockPrisma.agentSpan.upsert.mock.calls[0][0].create
      expect(spanData.durationMs).toBe(1500)
    })
  })

  // ── run_end ─────────────────────────────────────────────────────────────────

  describe('run_end handler', () => {
    const baseRunEnd: AgentSpanJobData = {
      type: 'run_end',
      projectId: PROJECT_ID,
      runId: RUN_ID,
      startedAt: NOW,
      status: 'success',
    }

    it('aggregates child spans and updates AgentRun', async () => {
      const job = makeJob(baseRunEnd)

      await processAgentSpan(job)

      expect(mockPrisma.agentSpan.aggregate).toHaveBeenCalledWith({
        where: { runId: RUN_ID },
        _sum: { totalTokens: true, costUsd: true },
      })

      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RUN_ID },
          data: expect.objectContaining({
            status: 'success',
            totalTokens: 150,
            totalCostUsd: 0.003,
          }),
        }),
      )
    })

    it('defaults status to "completed" when absent', async () => {
      const job = makeJob({ ...baseRunEnd, status: undefined })

      await processAgentSpan(job)

      const updateCall = mockPrisma.agentRun.update.mock.calls[0][0]
      expect(updateCall.data.status).toBe('completed')
    })

    it('uses provided endedAt when present', async () => {
      const endedAt = '2024-06-01T12:00:00.000Z'
      const job = makeJob({ ...baseRunEnd, endedAt })

      await processAgentSpan(job)

      const updateCall = mockPrisma.agentRun.update.mock.calls[0][0]
      expect(updateCall.data.endedAt).toEqual(new Date(endedAt))
    })

    it('uses zero totals when aggregate returns null sums', async () => {
      mockPrisma.agentSpan.aggregate.mockResolvedValue({
        _sum: { totalTokens: null, costUsd: null },
      })
      const job = makeJob(baseRunEnd)

      await processAgentSpan(job)

      const updateCall = mockPrisma.agentRun.update.mock.calls[0][0]
      expect(updateCall.data.totalTokens).toBe(0)
      expect(updateCall.data.totalCostUsd).toBe(0)
    })
  })
})
