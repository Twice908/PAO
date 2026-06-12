const SPAN_COLORS: Record<string, string> = {
  llm_call: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  tool_call: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  memory_read: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  agent_message: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const SPAN_LABELS: Record<string, string> = {
  llm_call: 'LLM Call',
  tool_call: 'Tool Call',
  memory_read: 'Memory',
  agent_message: 'Agent Msg',
  error: 'Error',
}

interface SpanTypeChipProps {
  spanType: string
}

export default function SpanTypeChip({ spanType }: SpanTypeChipProps) {
  const colorClass =
    SPAN_COLORS[spanType] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
  const label = SPAN_LABELS[spanType] ?? spanType

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {label}
    </span>
  )
}
