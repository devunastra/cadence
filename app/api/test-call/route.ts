import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getValidatedSelectedStudioId } from '@/lib/data-cache'
import { getStudioTestAgents } from '@/lib/test-agents'

// Normalize the form's "reason" value to what the agent's prompts expect.
function normalizeReason(input?: string): string | undefined {
  if (!input) return undefined
  const map: Record<string, string> = {
    'just for fun': 'For Fun',
    'for fun': 'For Fun',
    'fun': 'For Fun',
    'wedding': 'Wedding',
    'special occasion': 'Special Occasion',
    'other': 'Other',
  }
  return map[input.trim().toLowerCase()] ?? input
}

function splitName(fullName?: string): { firstName?: string; lastName?: string } {
  if (!fullName) return {}
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    phoneNumber: string
    name?: string
    email?: string
    reason?: string
    message?: string
    agentId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 })
  }

  // Get studio for Retell credentials (fallback path)
  const serviceClient = createServiceClient()
  const selectedStudioId = await getValidatedSelectedStudioId(session.user.id)

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

  // The agents this studio is allowed to call, from the studio_test_agents table.
  // Each agent carries its own provisioned Retell from_number.
  const studioAgents = await getStudioTestAgents(studio.id)

  let agentId: string | undefined
  let fromNumber: string | undefined

  if (body.agentId) {
    // An explicit selection must be one of THIS studio's configured agents — a user
    // cannot trigger another studio's agent by passing an arbitrary agent_id.
    const match = studioAgents.find((a) => a.id === body.agentId)
    if (!match) {
      return NextResponse.json({ error: 'Selected agent is not available for this studio' }, { status: 403 })
    }
    agentId = match.id
    fromNumber = match.fromNumber
  } else {
    // No explicit selection: default to the studio's first configured agent,
    // then the studio's configured Retell agent, then env defaults.
    const first = studioAgents[0]
    agentId = first?.id || process.env.TEST_RETELL_AGENT_ID || studio.retell_agent_id || undefined
    fromNumber = first?.fromNumber || process.env.RETELL_FROM_NUMBER
  }

  if (!agentId) {
    return NextResponse.json({ error: 'No Retell agent selected' }, { status: 400 })
  }
  if (!fromNumber) {
    return NextResponse.json({ error: `No from_number for agent ${agentId} — add the agent to studio_test_agents or set RETELL_FROM_NUMBER in .env.local` }, { status: 500 })
  }

  const retellApiKey =
    process.env.TEST_RETELL_API_KEY ||
    studio.retell_api_key ||
    process.env.RETELL_API_KEY
  if (!retellApiKey) {
    return NextResponse.json({ error: 'No Retell API key configured — set TEST_RETELL_API_KEY or RETELL_API_KEY in .env.local' }, { status: 500 })
  }

  try {
    // Map form fields to the variables the agent's prompts actually use.
    const dynamicVars: Record<string, string> = {}
    const { firstName, lastName } = splitName(body.name)
    if (firstName) dynamicVars.first_name = firstName
    if (lastName) dynamicVars.last_name = lastName
    if (body.email) dynamicVars.email = body.email
    if (body.phoneNumber) dynamicVars.phone_number = body.phoneNumber
    const normalizedReason = normalizeReason(body.reason)
    if (normalizedReason) dynamicVars.reason = normalizedReason
    if (body.message) dynamicVars.dance_interest = body.message

    const retellPayload: Record<string, unknown> = {
      override_agent_id: agentId,
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
    return NextResponse.json({ ok: true, callId: data.call_id, agentUsed: agentId, dynamicVars })
  } catch (err: unknown) {
    console.error('Test call exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
  }
}
