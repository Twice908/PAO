'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAlerts, useAlertHistory } from '@/hooks/useAlerts'
import { useProjects } from '@/hooks/useProjects'
import type { AlertRule, AlertChannel, AlertHistoryEntry } from '@pulse/types'

// PAO ships only the three agent alert types.
type AgentAlertType = 'agent_error_rate' | 'agent_token_threshold' | 'agent_execution_time'

// ── helpers ──────────────────────────────────────────────────────────────────

function maskDestination(channel: string, destination: string): string {
  if (channel === 'slack') return 'Slack webhook'
  if (destination.length <= 3) return '***'
  return `${destination.slice(0, 3)}***`
}

function formatValue(type: string, value: number): string {
  if (type === 'agent_error_rate') return `${value.toFixed(1)}%`
  if (type === 'agent_execution_time') return `${value.toLocaleString()}ms`
  if (type === 'agent_token_threshold') return `${value.toLocaleString()} tokens`
  return String(value)
}

function formatThreshold(alert: AlertRule): string {
  switch (alert.type) {
    case 'agent_error_rate':
      return `${alert.threshold}%`
    case 'agent_token_threshold':
      return `${alert.threshold.toLocaleString()} tokens`
    case 'agent_execution_time':
      return `${alert.threshold.toLocaleString()}ms`
    default:
      return String(alert.threshold)
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── type cards ────────────────────────────────────────────────────────────────

interface TypeCardProps {
  selected: boolean
  onClick: () => void
  icon: string
  title: string
  description: string
}

function TypeCard({ selected, onClick, icon, title, description }: TypeCardProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors',
        selected
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-500'
          : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 hover:border-indigo-300',
      ].join(' ')}
    >
      <span className="text-2xl">{icon}</span>
      <span className="font-semibold text-gray-900 dark:text-slate-100 text-sm">{title}</span>
      <span className="text-xs text-gray-500 dark:text-slate-400">{description}</span>
    </button>
  )
}

// ── alert rule card ───────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: AlertRule
  projectId: string
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
  deleting: string | null
  toggling: string | null
}

function AlertCard({ alert, projectId, onToggle, onDelete, deleting, toggling }: AlertCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'sent' | string | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const url = `/api/projects/${projectId}/alerts/${alert.id}/test`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: alert.type, channel: alert.channel, destination: alert.destination }),
      })
      const json = (await res.json()) as { success?: boolean; error?: { message?: string } }
      if (res.ok && json.success) {
        setTestResult('sent')
      } else {
        setTestResult(json.error?.message ?? `HTTP ${res.status}`)
      }
    } catch {
      setTestResult('Network error')
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 3000)
    }
  }

  const typeBadge: Record<string, string> = {
    agent_error_rate: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    agent_token_threshold: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    agent_execution_time: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  }
  const channelBadge: Record<string, string> = {
    email: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    slack: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  }

  const agentWindow = alert.agentMetrics?.timeWindowMinutes

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${typeBadge[alert.type] ?? 'bg-gray-100 text-gray-600'}`}>
            {alert.type.replace(/_/g, ' ')}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${channelBadge[alert.channel] ?? 'bg-gray-100 text-gray-600'}`}>
            {alert.channel === 'slack' ? 'Slack' : 'Email'}
          </span>
          {!alert.active && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400">
              Inactive
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-slate-100 truncate">{maskDestination(alert.channel, alert.destination)}</p>
        <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
          Threshold: {formatThreshold(alert)}
          {alert.type === 'agent_error_rate' && agentWindow ? ` · ${agentWindow} min window` : ''}
        </p>
        {alert.lastFired && (
          <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">Last fired: {relativeTime(alert.lastFired)}</p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Send test */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleTest}
            disabled={testing}
            className="text-xs text-gray-400 dark:text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
          >
            {testing ? (
              <span className="inline-flex items-center gap-1">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </span>
            ) : 'Send test'}
          </button>
          {testResult === 'sent' && (
            <span className="text-xs text-green-600 font-medium">Test sent</span>
          )}
          {testResult && testResult !== 'sent' && (
            <span className="text-xs text-red-500 max-w-[120px] truncate" title={testResult}>{testResult}</span>
          )}
        </div>

        {/* Active toggle */}
        <button
          onClick={() => onToggle(alert.id, !alert.active)}
          disabled={toggling === alert.id}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50"
          style={{ backgroundColor: alert.active ? '#4f46e5' : '#d1d5db' }}
          title={alert.active ? 'Disable alert' : 'Enable alert'}
        >
          <span
            className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
            style={{ transform: alert.active ? 'translateX(18px)' : 'translateX(2px)' }}
          />
        </button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDelete(alert.id)}
              disabled={deleting === alert.id}
              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {deleting === alert.id ? 'Deleting…' : 'Confirm'}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-gray-400 dark:text-slate-500 hover:text-red-500 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ── creation form ─────────────────────────────────────────────────────────────

interface CreateFormProps {
  projectId: string
  onCreated: () => void
  onCancel: () => void
}

function CreateForm({ projectId, onCreated, onCancel }: CreateFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [alertType, setAlertType] = useState<AgentAlertType>('agent_error_rate')
  const [channel, setChannel] = useState<AlertChannel>('email')
  const [threshold, setThreshold] = useState('')
  const [destination, setDestination] = useState('')
  const [timeWindowMinutes, setTimeWindowMinutes] = useState('60')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        type: alertType,
        channel,
        destination,
        threshold: parseFloat(threshold),
      }
      if (alertType === 'agent_error_rate') {
        body['agentMetrics'] = { timeWindowMinutes: parseInt(timeWindowMinutes, 10) || 60 }
      }

      const res = await fetch(`/api/projects/${projectId}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } }
        throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      }
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create alert')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const labelClass = 'block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1'

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-slate-600 bg-indigo-50/40 dark:bg-slate-800 p-6 mt-4 space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(['1', '2', '3'] as const).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-300">›</span>}
            <span className={`rounded-full w-5 h-5 flex items-center justify-center ${
              step === i + 1 ? 'bg-indigo-600 text-white' : step > i + 1 ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-200 dark:bg-slate-600 text-gray-400 dark:text-slate-500'
            }`}>{s}</span>
            <span className={step === i + 1 ? 'text-indigo-700' : 'text-gray-400 dark:text-slate-500'}>
              {['Alert type', 'Settings', 'Notification'][i]}
            </span>
          </span>
        ))}
      </div>

      {/* Step 1: type */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-100">What do you want to monitor?</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TypeCard selected={alertType === 'agent_error_rate'} onClick={() => setAlertType('agent_error_rate')}
              icon="🤖" title="Agent Error Rate" description="Alert when % of failed agent runs exceeds threshold" />
            <TypeCard selected={alertType === 'agent_token_threshold'} onClick={() => setAlertType('agent_token_threshold')}
              icon="🪙" title="Token Threshold" description="Alert when a single run exceeds a token limit" />
            <TypeCard selected={alertType === 'agent_execution_time'} onClick={() => setAlertType('agent_execution_time')}
              icon="⚡" title="Execution Time" description="Alert when a run duration exceeds a time limit" />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: settings */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-100">
            Configure your {alertType.replace(/_/g, ' ')} alert
          </p>

          {alertType === 'agent_error_rate' && (
            <>
              <div>
                <label className={labelClass}>Error rate threshold (%)</label>
                <input type="number" min={1} max={100} placeholder="20" value={threshold}
                  onChange={(e) => setThreshold(e.target.value)} className={inputClass} />
                <p className="text-xs text-gray-400 mt-1">Alert fires when more than this % of agent runs fail</p>
              </div>
              <div>
                <label className={labelClass}>Time window (minutes)</label>
                <input type="number" min={1} max={1440} placeholder="60" value={timeWindowMinutes}
                  onChange={(e) => setTimeWindowMinutes(e.target.value)} className={inputClass} />
                <p className="text-xs text-gray-400 mt-1">Look back window for calculating the error rate</p>
              </div>
            </>
          )}

          {alertType === 'agent_token_threshold' && (
            <div>
              <label className={labelClass}>Token limit per run</label>
              <input type="number" min={1} placeholder="10000" value={threshold}
                onChange={(e) => setThreshold(e.target.value)} className={inputClass} />
              <p className="text-xs text-gray-400 mt-1">Alert fires immediately when a run exceeds this many tokens</p>
            </div>
          )}

          {alertType === 'agent_execution_time' && (
            <div>
              <label className={labelClass}>Execution time limit (ms)</label>
              <input type="number" min={1} placeholder="300000" value={threshold}
                onChange={(e) => setThreshold(e.target.value)} className={inputClass} />
              <p className="text-xs text-gray-400 mt-1">Alert fires immediately when a run takes longer than this (e.g. 300000 = 5 minutes)</p>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <button
              onClick={() => setStep(3)}
              disabled={!threshold}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: notification channel */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Where should we notify you?</p>
          <div className="flex gap-2">
            {(['email', 'slack'] as AlertChannel[]).map((c) => (
              <button
                key={c}
                onClick={() => { setChannel(c); setDestination('') }}
                className={[
                  'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  channel === c ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-200 hover:border-indigo-300',
                ].join(' ')}
              >
                {c === 'email' ? '✉ Email' : '# Slack'}
              </button>
            ))}
          </div>

          {channel === 'email' && (
            <div>
              <label className={labelClass}>Email address</label>
              <input type="email" placeholder="you@example.com" value={destination}
                onChange={(e) => setDestination(e.target.value)} className={inputClass} />
            </div>
          )}
          {channel === 'slack' && (
            <div>
              <label className={labelClass}>
                Slack webhook URL{' '}
                <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer"
                  className="text-indigo-500 underline">
                  How to get this
                </a>
              </label>
              <input type="url" placeholder="https://hooks.slack.com/services/..." value={destination}
                onChange={(e) => setDestination(e.target.value)} className={inputClass} />
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <button
              onClick={submit}
              disabled={!destination || submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create Alert'}
            </button>
          </div>
        </div>
      )}

      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
    </div>
  )
}

// ── history row ───────────────────────────────────────────────────────────────

interface HistoryRowProps {
  entry: AlertHistoryEntry
  projectId: string
  onDeleteRequest: (id: string) => void
  confirmId: string | null
  deletingId: string | null
  onConfirm: (id: string) => void
  onCancel: () => void
}

function HistoryRow({ entry, projectId, onDeleteRequest, confirmId, deletingId, onConfirm, onCancel }: HistoryRowProps) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-slate-700 group">
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">{relativeTime(entry.sentAt)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs font-medium text-gray-700 dark:text-slate-300">{entry.type.replace(/_/g, ' ')}</span>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-400 min-w-[240px] max-w-sm whitespace-normal leading-relaxed">
        {entry.message}
        {entry.agentRunId && (
          <a
            href={`/dashboard/agents/${entry.agentRunId}?project=${projectId}`}
            className="ml-2 inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono"
          >
            {entry.agentRunId.slice(0, 8)}…
          </a>
        )}
      </td>
      <td className="px-4 py-3 font-medium text-red-600 whitespace-nowrap">{formatValue(entry.type, entry.triggeredValue)}</td>
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">{formatValue(entry.type, entry.threshold)}</td>
      <td className="px-4 py-3 capitalize text-gray-500 dark:text-slate-400 whitespace-nowrap">{entry.channel}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {entry.alertStatus === 'active' && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />Active
          </span>
        )}
        {entry.alertStatus === 'disabled' && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />Disabled
          </span>
        )}
        {entry.alertStatus === 'deleted' && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />Deleted
          </span>
        )}
      </td>
      <td className="w-10 px-3 py-3 text-center">
        <div className="relative inline-flex items-center justify-center">
          {confirmId === entry.id ? (
            <div className="absolute right-0 z-10 flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-800 px-2.5 py-1.5 shadow-lg whitespace-nowrap">
              <span className="text-xs text-gray-500 dark:text-slate-400">Delete this entry?</span>
              <button
                onClick={() => onConfirm(entry.id)}
                disabled={deletingId === entry.id}
                className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
              >
                {deletingId === entry.id ? '…' : 'Yes'}
              </button>
              <span className="text-gray-300 dark:text-slate-600">·</span>
              <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors">
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => onDeleteRequest(entry.id)}
              title="Delete history entry"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-gray-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66H14.5a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zM4.544 3.5l.852 10.615a1 1 0 0 0 .997.885h6.214a1 1 0 0 0 .997-.885L14.456 3.5z" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const projectId = searchParams.get('project') ?? projects[0]?.id ?? ''

  const { data: alerts, isLoading } = useAlerts(projectId)
  const [historyPage, setHistoryPage] = useState(1)
  const { data: history, total: historyTotal, isLoading: historyLoading } = useAlertHistory(projectId, historyPage)

  const [showForm, setShowForm] = useState(false)
  const [confirmDeleteHistory, setConfirmDeleteHistory] = useState<string | null>(null)

  const invalidateAlerts = () =>
    queryClient.invalidateQueries({ queryKey: ['alerts', projectId] })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      fetch(`/api/projects/${projectId}/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }),
    onSuccess: invalidateAlerts,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/projects/${projectId}/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateAlerts,
  })

  const deleteHistoryMutation = useMutation({
    mutationFn: (historyId: string) =>
      fetch(`/api/projects/${projectId}/alerts/history/${historyId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDeleteHistory(null)
      queryClient.invalidateQueries({ queryKey: ['alerts', 'history', projectId] })
    },
  })

  const toggling = toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null
  const deleting = deleteMutation.isPending ? deleteMutation.variables ?? null : null
  const deletingHistory = deleteHistoryMutation.isPending ? deleteHistoryMutation.variables ?? null : null

  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Create a project to manage alerts.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-10">
      {/* Section 1 — Alert rules */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Alert Rules</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Get notified when your agents misbehave</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              + Add Alert Rule
            </button>
          )}
        </div>

        {showForm && (
          <CreateForm
            projectId={projectId}
            onCreated={() => { setShowForm(false); invalidateAlerts() }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-10 text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">No alert rules configured</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Click &quot;Add Alert Rule&quot; to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                projectId={projectId}
                onToggle={(id, active) => toggleMutation.mutate({ id, active })}
                onDelete={(id) => deleteMutation.mutate(id)}
                toggling={toggling}
                deleting={deleting}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2 — Alert history */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Alert History</h2>

        {historyLoading ? (
          <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-10 text-center">
            <p className="text-sm text-gray-500 dark:text-slate-400">No alerts have fired yet</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
              <table className="min-w-max w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-700 border-b border-gray-200 dark:border-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Alert type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">What triggered it</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Threshold</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Channel</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Alert status</th>
                    <th className="w-10 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      projectId={projectId}
                      onDeleteRequest={setConfirmDeleteHistory}
                      confirmId={confirmDeleteHistory}
                      deletingId={deletingHistory}
                      onConfirm={(id) => deleteHistoryMutation.mutate(id)}
                      onCancel={() => setConfirmDeleteHistory(null)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {historyTotal > 20 && (
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-slate-400">
                <span>Showing {(historyPage - 1) * 20 + 1}–{Math.min(historyPage * 20, historyTotal)} of {historyTotal}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage === 1}
                    className="rounded border border-gray-200 dark:border-slate-600 px-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={historyPage * 20 >= historyTotal}
                    className="rounded border border-gray-200 dark:border-slate-600 px-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
