'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Copy, Check } from 'lucide-react'

interface Props {
  onClose: () => void
  onCreated?: (projectId: string) => void
}

export default function CreateProjectModal({ onClose, onCreated }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? 'Failed to create project')
        return
      }
      setApiKey(json.data.apiKey)
      router.refresh()
      onCreated?.(json.data.project.id)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function copyKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !apiKey) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1117] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-white">
            {apiKey ? 'Project created' : 'New project'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {apiKey ? (
          /* Step 2: show the API key once */
          <div className="px-6 py-6 space-y-4">
            <p className="text-sm text-gray-300">
              Project <span className="font-semibold text-white">{name}</span> created. Copy your API
              key — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <code className="flex-1 truncate text-xs text-indigo-300 font-mono">{apiKey}</code>
              <button
                onClick={copyKey}
                className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
              >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Use this key as the <code className="text-gray-400">apiKey</code> in the{' '}
              <code className="text-gray-400">PulseAgent</code> SDK.
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Step 1: name input */
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            <div>
              <label htmlFor="project-name" className="mb-1.5 block text-xs font-medium text-gray-400">
                Project name
              </label>
              <input
                ref={inputRef}
                id="project-name"
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My AI Agent"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
