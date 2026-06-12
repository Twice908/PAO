export default function AgentsLoading() {
  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-32 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        <div className="h-4 w-64 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      </div>

      {/* Filter bar skeleton */}
      <div className="h-8 w-80 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />

      {/* Table skeleton */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="flex gap-4 px-6 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
          <div className="h-3 w-28 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        </div>
        {/* Table rows */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 dark:border-slate-700 last:border-b-0"
          >
            <div className="h-4 w-52 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="ml-auto flex gap-6">
              <div className="h-4 w-14 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-10 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
