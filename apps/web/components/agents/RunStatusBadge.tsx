interface RunStatusBadgeProps {
  status: string
}

export default function RunStatusBadge({ status }: RunStatusBadgeProps) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        Running
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Completed
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Failed
      </span>
    )
  }
  if (status === 'interrupted') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 dark:bg-orange-900/30 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
        Interrupted
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-300">
      {status}
    </span>
  )
}
