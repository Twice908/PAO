import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

const prisma = new PrismaClient()

async function seedAgentRun(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { clerkId: 'dev_seed_user' },
    update: {},
    create: {
      clerkId: 'dev_seed_user',
      email: 'seed@dev.local',
      plan: 'FREE',
    },
  })

  const apiKeyHash = createHash('sha256').update('pk_seed_dev_key').digest('hex')
  const project = await prisma.project.upsert({
    where: { apiKeyHash },
    update: {},
    create: {
      name: 'PAO Seed Project',
      apiKeyHash,
      apiKeyPrefix: 'pk_seed',
      userId: user.id,
    },
  })

  const agentDef = await prisma.agentDefinition.upsert({
    where: { projectId_name: { projectId: project.id, name: 'SeedResearchAgent' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'SeedResearchAgent',
      role: 'Searches and summarizes research topics',
      model: 'gpt-4o',
    },
  })

  const now = new Date()
  const run = await prisma.agentRun.create({
    data: {
      projectId: project.id,
      task: 'Summarize quarterly earnings report',
      status: 'completed',
      startedAt: new Date(now.getTime() - 5_000),
      endedAt: now,
      totalTokens: 1450,
      totalCostUsd: 0.0218,
      metadata: { triggeredBy: 'seed-script' },
    },
  })

  const t = run.startedAt.getTime()

  await prisma.agentSpan.createMany({
    data: [
      {
        runId: run.id,
        projectId: project.id,
        agentDefinitionId: agentDef.id,
        spanType: 'llm_call',
        name: 'gpt-4o completion — plan step',
        startedAt: new Date(t),
        endedAt: new Date(t + 800),
        durationMs: 800,
        inputTokens: 210,
        outputTokens: 145,
        totalTokens: 355,
        costUsd: 0.0053,
        model: 'gpt-4o',
        inputPreview: 'You are a research assistant. Task: summarize quarterly earnings report.',
        outputPreview: 'Plan: 1. Search for Q3 report. 2. Extract key metrics. 3. Summarize.',
        statusCode: 'success',
      },
      {
        runId: run.id,
        projectId: project.id,
        agentDefinitionId: agentDef.id,
        spanType: 'tool_call',
        name: 'search_web',
        startedAt: new Date(t + 900),
        endedAt: new Date(t + 1_400),
        durationMs: 500,
        statusCode: 'success',
        inputPreview: '{"query":"ACME Corp Q3 2025 earnings report"}',
        outputPreview: 'Found 5 results. Top result: acmecorp.com/investors/q3-2025',
      },
      {
        runId: run.id,
        projectId: project.id,
        agentDefinitionId: agentDef.id,
        spanType: 'tool_call',
        name: 'fetch_url',
        startedAt: new Date(t + 1_500),
        endedAt: new Date(t + 2_200),
        durationMs: 700,
        statusCode: 'success',
        inputPreview: '{"url":"https://acmecorp.com/investors/q3-2025"}',
        outputPreview: 'Revenue: $2.4B (+12% YoY). Net income: $340M. EPS: $1.24.',
      },
      {
        runId: run.id,
        projectId: project.id,
        agentDefinitionId: agentDef.id,
        spanType: 'llm_call',
        name: 'gpt-4o completion — extract metrics',
        startedAt: new Date(t + 2_300),
        endedAt: new Date(t + 3_400),
        durationMs: 1_100,
        inputTokens: 480,
        outputTokens: 220,
        totalTokens: 700,
        costUsd: 0.0105,
        model: 'gpt-4o',
        inputPreview: 'Extract key financial metrics from the following text: Revenue: $2.4B...',
        outputPreview: '{"revenue":"$2.4B","net_income":"$340M","eps":"$1.24","yoy_growth":"12%"}',
        statusCode: 'success',
      },
      {
        runId: run.id,
        projectId: project.id,
        agentDefinitionId: agentDef.id,
        spanType: 'llm_call',
        name: 'gpt-4o completion — final summary',
        startedAt: new Date(t + 3_500),
        endedAt: new Date(t + 4_900),
        durationMs: 1_400,
        inputTokens: 260,
        outputTokens: 135,
        totalTokens: 395,
        costUsd: 0.006,
        model: 'gpt-4o',
        inputPreview: 'Write a 2-paragraph executive summary of ACME Q3 results.',
        outputPreview:
          'ACME Corp delivered strong Q3 2025 results with revenue of $2.4B, up 12% year-over-year...',
        statusCode: 'success',
      },
    ],
  })

  console.log(
    `Seeded AgentRun "${run.id}" with 5 spans (3x llm_call, 2x tool_call) for project "${project.name}"`,
  )
}

async function main(): Promise<void> {
  await seedAgentRun()
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
