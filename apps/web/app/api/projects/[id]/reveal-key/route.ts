import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { createHash, randomBytes } from 'node:crypto'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

function generateApiKey() {
  return `pk_live_${randomBytes(32).toString('hex')}`
}

function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

function getApiKeyPrefix(key: string) {
  return key.slice(0, 8)
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not signed in' } },
      { status: 401 },
    )
  }

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Project not found' } },
      { status: 403 },
    )
  }

  const rawKey = generateApiKey()
  await prisma.project.update({
    where: { id: params.id },
    data: { apiKeyHash: hashApiKey(rawKey), apiKeyPrefix: getApiKeyPrefix(rawKey) },
  })

  return NextResponse.json({
    success: true,
    data: {
      projectId: params.id,
      // Returned once — never stored in plain text.
      apiKey: rawKey,
      apiKeyPrefix: getApiKeyPrefix(rawKey),
    },
  })
}
