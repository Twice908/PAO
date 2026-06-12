'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import SpanTypeChip from '@/components/agents/SpanTypeChip'

export interface AgentSpanRow {
  id: string
  runId: string
  projectId: string
  agentDefinitionId: string | null
  parentSpanId: string | null
  spanType: string
  name: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  costUsd: number | null
  model: string | null
  inputPreview: string | null
  outputPreview: string | null
  statusCode: string | null
  errorMessage: string | null
  metadata: unknown
}

const SPAN_LABELS: Record<string, string> = {
  llm_call: 'LLM Call',
  tool_call: 'Tool Call',
  memory_read: 'Memory',
  agent_message: 'Agent Msg',
  error: 'Error',
}

function spanTypeLabel(spanType: string): string {
  return SPAN_LABELS[spanType] ?? spanType
}

interface SpanDetailPanelProps {
  span: AgentSpanRow | null
  prevSpan: AgentSpanRow | null
  nextSpan: AgentSpanRow | null
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-gray-100 dark:border-slate-700 last:border-b-0">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1">
        {label}
      </p>
      <div className="text-sm text-gray-900 dark:text-slate-100">{children}</div>
    </div>
  )
}

export default function SpanDetailPanel({
  span,
  prevSpan,
  nextSpan,
  onClose,
  onPrev,
  onNext,
}: SpanDetailPanelProps) {
  const isOpen = span !== null

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? '' : 'pointer-events-none'}`}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={`absolute right-0 top-0 h-full w-[460px] max-w-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col transform transition-transform duration-300 border-l border-gray-200 dark:border-slate-700 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {span && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <SpanTypeChip spanType={span.spanType} />
                <p className="mt-2 font-semibold text-gray-900 dark:text-slate-100 truncate">
                  {span.name}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6">
              <Field label="Span ID">
                <span className="font-mono text-xs break-all text-gray-700 dark:text-slate-300">
                  {span.id}
                </span>
              </Field>
              {span.model && <Field label="Model">{span.model}</Field>}
              {span.statusCode && <Field label="Status">{span.statusCode}</Field>}
              <Field label="Started at">{new Date(span.startedAt).toLocaleString()}</Field>
              {span.endedAt && (
                <Field label="Ended at">{new Date(span.endedAt).toLocaleString()}</Field>
              )}
              {span.durationMs !== null && (
                <Field label="Duration">{span.durationMs.toLocaleString()}ms</Field>
              )}
              {span.inputTokens !== null && (
                <Field label="Input tokens">{span.inputTokens.toLocaleString()}</Field>
              )}
              {span.outputTokens !== null && (
                <Field label="Output tokens">{span.outputTokens.toLocaleString()}</Field>
              )}
              {span.totalTokens !== null && (
                <Field label="Total tokens">{span.totalTokens.toLocaleString()}</Field>
              )}
              <Field label="Cost">{formatCost(span.costUsd)}</Field>
              {span.parentSpanId && (
                <Field label="Parent span">
                  <span className="font-mono text-xs break-all text-gray-700 dark:text-slate-300">
                    {span.parentSpanId}
                  </span>
                </Field>
              )}
              {span.errorMessage && (
                <Field label="Error">
                  <span className="text-red-600 dark:text-red-400">{span.errorMessage}</span>
                </Field>
              )}
              {span.inputPreview && (
                <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1">
                    Input preview
                  </p>
                  <pre className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words font-mono bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                    {span.inputPreview}
                  </pre>
                </div>
              )}
              {span.outputPreview && (
                <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1">
                    Output preview
                  </p>
                  <pre className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words font-mono bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                    {span.outputPreview}
                  </pre>
                </div>
              )}
              {span.metadata !== null && span.metadata !== undefined && (
                <div className="py-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1">
                    Metadata
                  </p>
                  <pre className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words font-mono bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                    {JSON.stringify(span.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer navigation */}
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-2">
              <button
                onClick={onPrev}
                disabled={prevSpan === null}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 px-3 py-2 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-gray-400 dark:text-slate-500 text-[10px] font-normal">Prev</span>
                  <span>{prevSpan ? spanTypeLabel(prevSpan.spanType) : '—'}</span>
                </span>
              </button>

              <button
                onClick={onNext}
                disabled={nextSpan === null}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 px-3 py-2 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="flex flex-col items-end leading-tight">
                  <span className="text-gray-400 dark:text-slate-500 text-[10px] font-normal">Next</span>
                  <span>{nextSpan ? spanTypeLabel(nextSpan.spanType) : '—'}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
