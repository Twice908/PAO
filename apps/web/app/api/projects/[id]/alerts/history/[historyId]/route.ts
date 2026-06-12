import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; historyId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const event = await prisma.alertEvent.findFirst({ where: { id: params.historyId, projectId: params.id } })
  if (!event) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'History entry not found' } },
      { status: 404 },
    )
  }

  await prisma.alertEvent.delete({ where: { id: params.historyId } })

  return NextResponse.json({ success: true })
}
