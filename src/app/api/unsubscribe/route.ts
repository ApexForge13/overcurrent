import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')

  if (!email) {
    return Response.json({ error: 'Email required' }, { status: 400 })
  }

  await prisma.subscriber.update({
    where: { email: email.toLowerCase() },
    data: { status: 'unsubscribed', unsubscribedAt: new Date() },
  }).catch(() => {})

  return new Response(
    '<html><body style="background:#0A0A0B;color:#E8E6E3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h1>Unsubscribed</h1><p>You\'ve been removed from the Overcurrent newsletter.</p></div></body></html>',
    { headers: { 'Content-Type': 'text/html' } },
  )
}
