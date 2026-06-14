'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useProjects, PROJECTS_KEY } from '@/hooks/useProjects'
import RegenerateKeyModal from '@/components/RegenerateKeyModal'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: projects, isLoading: loading } = useProjects()
  const projectId = searchParams.get('project') ?? projects[0]?.id ?? ''

  // API key section
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)

  // Rename section
  const [nameValue, setNameValue] = useState('')
  const [nameError, setNameError] = useState('')
  const [nameSaved, setNameSaved] = useState(false)

  // Delete section
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [showDeleteForm, setShowDeleteForm] = useState(false)

  const project = projects.find((p) => p.id === projectId) ?? projects[0]

  // Seed the rename field once the active project resolves from cache.
  useEffect(() => {
    if (project) setNameValue(project.name)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
  }

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/projects/${project?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } | string }
        const msg = typeof json.error === 'object' ? json.error?.message : json.error
        throw new Error(msg ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 3000)
      router.refresh()
    },
    onError: (error) => setNameError(errorMessage(error, 'Failed to rename project')),
  })
  const nameSaving = renameMutation.isPending

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${project?.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } | string }
        const msg = typeof json.error === 'object' ? json.error?.message : json.error
        throw new Error(msg ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      router.push('/dashboard')
      router.refresh()
    },
    onError: (error) => setDeleteError(errorMessage(error, 'Failed to delete project')),
  })
  const deleting = deleteMutation.isPending

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nameValue.trim()
    if (!trimmed) { setNameError('Name cannot be empty'); return }
    if (trimmed.length > 64) { setNameError('Name must be 64 characters or fewer'); return }
    setNameError('')
    renameMutation.mutate(trimmed)
  }

  function handleDelete() {
    if (!project || deleteConfirmText !== project.name) return
    setDeleteError('')
    deleteMutation.mutate()
  }

  const AppearanceSection = (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
        Appearance
      </h2>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        Choose your preferred color theme. Persists across sessions.
      </p>
      <ThemeToggle />
    </section>
  )

  if (!loading && projects.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        {AppearanceSection}
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-gray-400">Create a project to manage its settings.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-6">
        {AppearanceSection}
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    )
  }

  if (!project) {
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        {AppearanceSection}
      </div>
    )
  }

  const maskedKey = `${project.apiKeyPrefix}••••••••••••`

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8">
      {AppearanceSection}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{project.name}</p>
      </div>

      {/* ── Project Name ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Project Name</h2>
        <form onSubmit={handleRename} className="flex items-end gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => { setNameValue(e.target.value); setNameError('') }}
              maxLength={64}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
          </div>
          <button
            type="submit"
            disabled={nameSaving || nameValue.trim() === project.name}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {nameSaving ? 'Saving…' : nameSaved ? 'Saved' : 'Save'}
          </button>
        </form>
      </section>

      {/* ── API Key ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">API Key</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          Use this key as the <code className="text-gray-600 dark:text-slate-300">apiKey</code> in the{' '}
          <code className="text-gray-600 dark:text-slate-300">PulseAgent</code> SDK to send agent runs.
        </p>
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 px-3 py-2 font-mono text-sm text-gray-700 dark:text-slate-100 select-none">
            {maskedKey}
          </code>
          <button
            onClick={() => setShowRegenerateModal(true)}
            className="flex-shrink-0 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            Regenerate
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500">
          The full key is never shown again after creation. Regenerating will invalidate the current key immediately.
        </p>
      </section>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-red-200 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>

        {!showDeleteForm ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-slate-200">Delete project</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                Permanently deletes all agent runs, spans, and alerts. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteForm(true)}
              className="flex-shrink-0 rounded-lg border border-red-300 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Delete project
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-slate-300">
              This action <strong>cannot be undone</strong>. This will permanently delete the{' '}
              <strong>{project.name}</strong> project and all associated data.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">
                Type <strong>{project.name}</strong> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError('') }}
                placeholder={project.name}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteForm(false); setDeleteConfirmText(''); setDeleteError('') }}
                className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== project.name || deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete this project'}
              </button>
            </div>
          </div>
        )}
      </section>

      {showRegenerateModal && (
        <RegenerateKeyModal
          projectId={project.id}
          onClose={() => setShowRegenerateModal(false)}
        />
      )}
    </div>
  )
}
