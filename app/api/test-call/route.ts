import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getSelectedStudioId } from '@/lib/data-cache'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phoneNumber: string; name?: string; email?: string; reason?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 })
  }

  // Get studio to find Retell agent ID + API key
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let studioQuery = serviceClient
    .from('studios')
    .select('id, retell_agent_id, retell_api_key')

  if (selectedStudioId) {
    studioQuery = studioQuery.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await serviceClient
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', session.user.id)
      .limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return NextResponse.json({ error: 'No studio found' }, { status: 404 })
    studioQuery = studioQuery.eq('id', firstStudioId)
  }

  const { data: studio, error: studioErr } = await studioQuery.single()
  if (studioErr || !studio) {
    return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
  }

  if (!studio.retell_agent_id) {
    return NextResponse.json({ error: 'No Retell agent configured for this studio' }, { status: 400 })
  }

  const retellApiKey = studio.retell_api_key || process.env.RETELL_API_KEY
  if (!retellApiKey) {
    return NextResponse.json({ error: 'No Retell API key configured' }, { status: 500 })
  }

  const fromNumber = process.env.RETELL_FROM_NUMBER
  if (!fromNumber) {
    return NextResponse.json({ error: 'RETELL_FROM_NUMBER not configured — add the Retell phone number to .env.local' }, { status: 500 })
  }

  try {
    // Build dynamic variables to pass lead info to the Retell agent
    const dynamicVars: Record<string, string> = {}
    if (body.name) dynamicVars.name = body.name
    if (body.email) dynamicVars.email = body.email
    if (body.reason) dynamicVars.reason_for_dancing = body.reason
    if (body.message) dynamicVars.message = body.message

    const retellPayload: Record<string, unknown> = {
      agent_id: studio.retell_agent_id,
      from_number: fromNumber,
      to_number: body.phoneNumber,
    }

    if (Object.keys(dynamicVars).length > 0) {
      retellPayload.retell_llm_dynamic_variables = dynamicVars
    }

    const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${retellApiKey}`,
      },
      body: JSON.stringify(retellPayload),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('Retell create-phone-call error:', res.status, text)
      return NextResponse.json({
        error: 'Retell API error',
        status: res.status,
        details: text,
      }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ ok: true, callId: data.call_id })
  } catch (err: unknown) {
    console.error('Test call exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
  }
}
