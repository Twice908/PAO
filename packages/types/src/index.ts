export type PlanType = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

// PAO uses the agent_* alert types; the rest are kept for parity with the
// shared Alert model that PAO's alert engine writes to.
export type AlertType =
  | 'agent_error_rate'
  | 'agent_token_threshold'
  | 'agent_execution_time'

export type AlertChannel = 'email' | 'slack'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}

export interface ApiSuccessResponse<T = unknown> {
  success: true
  data?: T
}

export interface ProjectSummary {
  id: string
  name: string
  apiKeyPrefix: string
  createdAt: string
}

export interface CreateProjectResponse {
  projectId: string
  name: string
  apiKey: string
  apiKeyPrefix: string
}

export interface RegenerateKeyResponse {
  projectId: string
  apiKey: string
  apiKeyPrefix: string
}

export interface AgentAlertMetrics {
  timeWindowMinutes?: number
}

export interface AlertRule {
  id: string
  type: AlertType
  channel: AlertChannel
  destination: string
  threshold: number
  url?: string
  route?: string
  active: boolean
  lastFired?: string
  agentMetrics?: AgentAlertMetrics | null
}

export interface AlertHistoryEntry {
  id: string
  alertId: string | null
  alertStatus: 'active' | 'disabled' | 'deleted'
  type: string
  triggeredValue: number
  threshold: number
  message: string
  channel: string
  sentAt: string
  agentRunId?: string | null
}
