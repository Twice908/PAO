'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { Bell, Cpu, Plus, Settings } from 'lucide-react'
import type { ProjectSummary } from '@pulse/types'
import CreateProjectModal from './CreateProjectModal'

interface SidebarProps {
  projects: ProjectSummary[]
}

// PAO standalone only ships the Agents views. (In the full Pulse dashboard this
// list also includes Logs, Analytics, Errors, Alerts, Uptime, Rate Limiter,
// Drift, and Settings.)
const NAV_ITEMS: Array<
  | { label: string; href: string; pathTemplate?: undefined; icon?: React.ComponentType<{ className?: string }> }
  | { label: string; href?: undefined; pathTemplate: string; icon?: React.ComponentType<{ className?: string }> }
> = [
  { label: 'Agents', href: '/dashboard/agents', icon: Cpu },
  { label: 'Alerts', href: '/dashboard/alerts', icon: Bell },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export default function Sidebar({ projects }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedProjectId = searchParams.get('project') ?? projects[0]?.id ?? ''
  const [showCreateModal, setShowCreateModal] = useState(false)

  function navigate(href: string) {
    const params = new URLSearchParams()
    if (selectedProjectId) params.set('project', selectedProjectId)
    router.push(`${href}?${params.toString()}`)
  }

  function navigateTemplate(pathTemplate: string) {
    if (!selectedProjectId) return
    router.push(pathTemplate.replace(':projectId', selectedProjectId))
  }

  function selectProject(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('project', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <>
    <aside
      className="flex h-screen w-64 flex-shrink-0 flex-col"
      style={{ backgroundColor: '#0f1117' }}
    >
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-white/10">
        <span className="text-lg font-bold text-white tracking-tight">PAO</span>
        <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
          beta
        </span>
      </div>

      {/* Project selector */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Project</p>
          <button
            onClick={() => setShowCreateModal(true)}
            title="New project"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
        {projects.length > 0 ? (
          <select
            value={selectedProjectId}
            onChange={(e) => selectProject(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="bg-gray-900 text-gray-200">
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-gray-600">No projects yet</p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const key = item.href ?? item.pathTemplate
          let isActive: boolean
          if (item.pathTemplate) {
            const driftPrefix = item.pathTemplate.split('/:projectId/')[1]?.split('/')[0]
            isActive = Boolean(driftPrefix && pathname.includes(`/${driftPrefix}`))
          } else if (item.href === '/dashboard') {
            isActive = pathname === item.href
          } else {
            isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          }
          return (
            <button
              key={key}
              onClick={() =>
                item.pathTemplate ? navigateTemplate(item.pathTemplate) : navigate(item.href!)
              }
              className={[
                'flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-[#1e293b] text-white border-l-2 border-indigo-500 pl-[10px]'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
              ].join(' ')}
            >
              {item.icon && <item.icon className="mr-2 h-4 w-4 shrink-0" />}
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-4">
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'w-8 h-8',
              userButtonTrigger: 'focus:ring-indigo-500',
            },
          }}
        />
      </div>
    </aside>

    {showCreateModal && <CreateProjectModal onClose={() => setShowCreateModal(false)} />}
    </>
  )
}
