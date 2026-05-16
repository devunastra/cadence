import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { getStudio } from '@/lib/get-studio'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  const res = await ghlFetch(`/conversations/search?locationId=${studio.ghl_account_id}&limit=1&status=unread`, {}, studio.ghl_api_key ?? undefined)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL unread count error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  const total = data.total ?? data.totalCount ?? 0

  return NextResponse.json({ total })
}
