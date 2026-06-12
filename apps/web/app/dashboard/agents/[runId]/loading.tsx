export default function RunDetailLoading() {
  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      {/* Back link skeleton */}
      <div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />

      {/* Header card skeleton */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="h-3 w-12 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-6 w-80 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          </div>
          <div className="h-6 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
        </div>
        <div className="mt-6 grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      </div>

      {/* Spans table skeleton */}
      <div className="space-y-3">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          <div className="flex gap-4 px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
            <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 dark:border-slate-700 last:border-b-0"
            >
              <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="ml-auto flex gap-4">
                <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
                <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
