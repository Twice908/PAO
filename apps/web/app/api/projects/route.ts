import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { createHash, randomBytes } from 'node:crypto'

function generateApiKey() {
  return `pk_live_${randomBytes(32).toString('hex')}`
}

function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

function getApiKeyPrefix(key: string) {
  return key.slice(0, 8)
}

export async function GET() {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: {
      projects: {
        select: { id: true, name: true, apiKeyPrefix: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  const projects = (user?.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    apiKeyPrefix: p.apiKeyPrefix,
    createdAt: p.createdAt.toISOString(),
  }))

  return NextResponse.json({ projects })
}

export async function POST(req: Request) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not signed in' } },
      { status: 401 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const name = (body?.name ?? '').trim()
  if (!name) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION', message: 'Project name is required' } },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
      { status: 404 },
    )
  }

  const rawKey = generateApiKey()
  const project = await prisma.project.create({
    data: {
      name,
      userId: user.id,
      apiKeyHash: hashApiKey(rawKey),
      apiKeyPrefix: getApiKeyPrefix(rawKey),
    },
    select: { id: true, name: true, apiKeyPrefix: true, createdAt: true },
  })

  return NextResponse.json(
    {
      success: true,
      data: {
        project: { ...project, createdAt: project.createdAt.toISOString() },
        // Returned once — user must copy it now, it is never stored in plain text.
        apiKey: rawKey,
      },
    },
    { status: 201 },
  )
}
