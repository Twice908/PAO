'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { ApiResponse, RegenerateKeyResponse } from '@pulse/types'

interface RegenerateKeyModalProps {
  projectId: string
  onClose: () => void
}

type Step = 'confirm' | 'reveal'

export default function RegenerateKeyModal({ projectId, onClose }: RegenerateKeyModalProps) {
  const [step, setStep] = useState<Step>('confirm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RegenerateKeyResponse | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch<ApiResponse<RegenerateKeyResponse>>(
        `/api/projects/${projectId}/reveal-key`,
        { method: 'POST' },
      )
      if (res.success && res.data) {
        setResult(res.data)
        setStep('reveal')
      } else {
        setError(res.error?.message ?? 'Failed to regenerate key')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function copyKey() {
    if (!result) return
    navigator.clipboard.writeText(result.apiKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
        {step === 'confirm' ? (
          <>
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-xl font-semibold text-gray-900">Regenerate API Key</h2>
              <p className="mt-1 text-sm text-gray-500">
                This will permanently invalidate your current key.
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-800">
                  This will permanently invalidate your current API key. Any integrations using it will stop working immediately. This cannot be undone.
                </p>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150"
                >
                  {loading ? 'Regenerating...' : 'Yes, regenerate key'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-xl font-semibold text-gray-900">New API Key Generated</h2>
              <p className="mt-1 text-sm text-gray-500">Copy this key now — it will not be shown again.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-800">
                  Save this key now — it will not be shown again.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
                  API Key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
                    {result?.apiKey}
                  </code>
                  <button
                    onClick={copyKey}
                    className="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors duration-150"
                >
                  Done
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
