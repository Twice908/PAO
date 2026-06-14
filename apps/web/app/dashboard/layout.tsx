import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@pulse/db'
import Sidebar from '@/components/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth()
  if (!userId) redirect('/')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })

  // Local dev: the Clerk webhook can't reach localhost so user.created never fires.
  // Auto-upsert from the current Clerk session so the dashboard is always usable.
  if (!user) {
    const clerkUser = await currentUser()
    const email =
      clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      ''

    await prisma.user.upsert({
      where: { clerkId: userId },
      update: {},
      create: { clerkId: userId, email },
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
        {children}
      </main>
    </div>
  )
}
