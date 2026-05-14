import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { checkRateLimit, GENERAL_LIMIT } from '@/lib/rate-limit'
import { getSelectedStudioId } from '@/lib/data-cache'

async function getStudio(userId: string) {
  const supabase = await createClient()
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let studioQuery = serviceClient.from('studios').select('id, ghl_account_id, ghl_api_key')

  if (selectedStudioId) {
    studioQuery = studioQuery.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await supabase
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', userId)
      .limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return null
    studioQuery = studioQuery.eq('id', firstStudioId)
  }

  const { data: studio, error } = await studioQuery.single()
  return error ? null : studio
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { allowed } = await checkRateLimit(`outbound-call:${user.id}`, GENERAL_LIMIT)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: { contactId: string; phoneNumber: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.contactId || !body.phoneNumber) {
    return NextResponse.json({ error: 'contactId and phoneNumber are required' }, { status: 400 })
  }

  const studioPhone = process.env.GHL_PHONE_NUMBER
  if (!studioPhone) {
    return NextResponse.json({ error: 'Studio phone not configured' }, { status: 500 })
  }

  const studio = await getStudio(user.id)
  if (!studio) {
    return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
  }

  try {
    // 1. Try to find existing conversation to get its ID and provider ID
    let conversationId: string | undefined
    let conversationProviderId: string | undefined

    const searchRes = await ghlFetch(
      `/conversations/search?locationId=${studio.ghl_account_id}&contactId=${encodeURIComponent(body.contactId)}&limit=1`,
      { headers: { 'Version': '2023-02-21' } },
      studio.ghl_api_key ?? undefined
    )
    if (searchRes.ok) {
      const searchData = await searchRes.json()
      const conv = searchData.conversations?.[0]
      if (conv) {
        conversationId = conv.id
        conversationProviderId = conv.conversationProviderId
      }
    }

    // 2. If no provider ID yet, try to fetch providers for this location
    if (!conversationProviderId) {
      const provRes = await ghlFetch(
        `/conversations/providers?locationId=${studio.ghl_account_id}`,
        { headers: { 'Version': '2023-02-21' } },
        studio.ghl_api_key ?? undefined
      )
      if (provRes.ok) {
        const provData = await provRes.json()
        // Look for a provider that supports Calls
        const callProvider = provData.providers?.find((p: any) => 
          p.capabilities?.includes('call') || 
          p.capabilities?.includes('Call') ||
          p.name?.toLowerCase().includes('twilio')
        )
        conversationProviderId = callProvider?.id
      }
    }

    if (!conversationProviderId) {
      return NextResponse.json({ 
        error: 'Could not determine conversationProviderId',
        details: 'GHL requires a provider ID to initiate calls. Ensure this location has a phone number integrated.'
      }, { status: 400 })
    }

    // 3. Trigger the call
    const payload: any = {
      type: 'Call',
      contactId: body.contactId,
      conversationProviderId,
      call: {
        to: body.phoneNumber,
        from: studioPhone,
        status: 'initiated'
      }
    }
    if (conversationId) payload.conversationId = conversationId

    const res = await ghlFetch('/conversations/messages/outbound', {
      method: 'POST',
      headers: { 'Version': '2023-02-21' },
      body: JSON.stringify(payload),
    }, studio.ghl_api_key ?? undefined)

    if (!res.ok) {
      const text = await res.text()
      console.error('GHL outbound call error:', res.status, text)
      return NextResponse.json({ 
        error: 'GHL API error', 
        status: res.status,
        details: text 
      }, { status: res.status })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Outbound call exception:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
