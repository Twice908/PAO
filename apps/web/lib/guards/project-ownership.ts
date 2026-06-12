import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'

export async function requireProjectOwnership(
  clerkUserId: string,
  projectId: string,
): Promise<NextResponse | null> {
  const user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return null
}
