import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@pulse/db'
import Sidebar from '@/components/Sidebar'
import type { ProjectSummary } from '@pulse/types'

const PROJECT_SELECT = {
  select: { id: true, name: true, apiKeyPrefix: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
} as const

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth()
  if (!userId) redirect('/')

  let user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: { projects: PROJECT_SELECT },
  })

  // Local dev: the Clerk webhook can't reach localhost so user.created never fires.
  // Auto-upsert from the current Clerk session so the dashboard is always usable.
  if (!user) {
    const clerkUser = await currentUser()
    const email =
      clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      ''

    user = await prisma.user.upsert({
      where: { clerkId: userId },
      update: {},
      create: { clerkId: userId, email },
      include: { projects: PROJECT_SELECT },
    })
  }

  const projects: ProjectSummary[] = (user?.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    apiKeyPrefix: p.apiKeyPrefix,
    createdAt: p.createdAt.toISOString(),
  }))

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <Sidebar projects={projects} />
      <main className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
        {children}
      </main>
    </div>
  )
}
