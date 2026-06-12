import pino from 'pino'
import { prisma } from '@pulse/db'
import { evaluateAgentAlerts } from '../lib/alert-evaluator'

const logger = pino({ name: 'agent-alerts-processor' })

export async function processAgentAlertsCheck(): Promise<void> {
  const rows = await prisma.alert.findMany({
    where: { active: true, type: 'agent_error_rate' },
    select: { projectId: true },
    distinct: ['projectId'],
  })

  if (rows.length === 0) return

  await Promise.all(
    rows.map(({ projectId }) =>
      evaluateAgentAlerts(projectId).catch((err: unknown) => {
        logger.error({ projectId, err }, 'Agent alert evaluation failed')
      }),
    ),
  )
}
