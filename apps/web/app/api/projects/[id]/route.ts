import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const body = await request.json().catch(() => ({}))
  const name = (body?.name ?? '').trim()
  if (!name) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION', message: 'Project name is required' } },
      { status: 400 },
    )
  }
  if (name.length > 64) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION', message: 'Name must be 64 characters or fewer' } },
      { status: 400 },
    )
  }

  await prisma.project.update({ where: { id: params.id }, data: { name } })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  // Cascades to agent runs/spans/definitions, alerts, and alert events via the schema.
  await prisma.project.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
