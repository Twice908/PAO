'use client'

export default function AgentsError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-10 text-center">
        <p className="text-base font-semibold text-red-700 dark:text-red-300">
          Failed to load agent runs
        </p>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error.message}</p>
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
