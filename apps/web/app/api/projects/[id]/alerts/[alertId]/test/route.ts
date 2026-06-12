import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

export async function POST(
  _request: Request,
  { params }: { params: { id: string; alertId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const alert = await prisma.alert.findFirst({ where: { id: params.alertId, projectId: params.id } })
  if (!alert) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } },
      { status: 404 },
    )
  }

  const resendApiKey = process.env['RESEND_API_KEY']
  const resendFrom = process.env['RESEND_FROM_EMAIL'] ?? 'alerts@pulse.dev'

  try {
    if (alert.channel === 'email') {
      if (!resendApiKey) {
        return NextResponse.json(
          { success: false, error: { code: 'CHANNEL_ERROR', message: 'RESEND_API_KEY is not configured on this server' } },
          { status: 502 },
        )
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: resendFrom,
          to: alert.destination,
          subject: 'Test alert from PAO',
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Test Notification</h2><p>This is a test notification. Your alert channel is configured correctly.</p><p style="color:#6b7280;font-size:14px">Alert type: ${alert.type} · Project: ${params.id}</p></div>`,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        return NextResponse.json(
          { success: false, error: { code: 'CHANNEL_ERROR', message: body.message ?? `Resend returned ${res.status}` } },
          { status: 502 },
        )
      }
    } else if (alert.channel === 'slack') {
      const res = await fetch(alert.destination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Test alert from PAO' } },
            { type: 'section', text: { type: 'mrkdwn', text: 'This is a test notification. Your alert channel is configured correctly.' } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `Alert type: ${alert.type} · Project: ${params.id}` }] },
          ],
        }),
      })
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: { code: 'CHANNEL_ERROR', message: `Slack webhook returned ${res.status}` } },
          { status: 502 },
        )
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delivery failed'
    return NextResponse.json(
      { success: false, error: { code: 'CHANNEL_ERROR', message } },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true })
}
