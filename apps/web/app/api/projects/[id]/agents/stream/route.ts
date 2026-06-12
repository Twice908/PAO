import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { userId, getToken } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'No session token' }, { status: 401 })

  const apiUrl = process.env['INGESTION_API_URL'] ?? 'http://localhost:3001'

  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl}/projects/${params.id}/agents/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return NextResponse.json({ error: 'API server unreachable' }, { status: 503 })
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Stream unavailable' }, { status: upstream.status })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
