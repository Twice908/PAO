'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'

type Mode = 'light' | 'dark' | 'system'

const CYCLE: Record<Mode, Mode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

const LABELS: Record<Mode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const ICONS: Record<Mode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="w-9 h-9" />

  const current = (theme as Mode) ?? 'system'
  const Icon = ICONS[current]

  return (
    <button
      type="button"
      onClick={() => setTheme(CYCLE[current])}
      aria-label={`Theme: ${LABELS[current]}. Click to switch.`}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:bg-slate-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
    >
      <Icon className="h-4 w-4" />
      <span>{LABELS[current]}</span>
    </button>
  )
}
