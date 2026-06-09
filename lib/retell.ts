const RETELL_BASE_URL = 'https://api.retellai.com'

function retellFetch(path: string, options: RequestInit = {}, apiKey?: string): Promise<Response> {
  const key = apiKey ?? process.env.RETELL_API_KEY
  if (!key) throw new Error('Retell API key is not configured.')

  return fetch(`${RETELL_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

interface RetellPhoneAgent {
  agent_id: string
  agent_version?: number
  weight: number
}

export interface RetellPhoneNumber {
  phone_number: string
  inbound_agents: RetellPhoneAgent[]
  outbound_agents: RetellPhoneAgent[]
}

export async function getRetellPhoneNumber(phoneNumber: string, apiKey?: string): Promise<RetellPhoneNumber | null> {
  const res = await retellFetch(`/get-phone-number/${encodeURIComponent(phoneNumber)}`, { method: 'GET' }, apiKey)
  if (!res.ok) return null
  return res.json() as Promise<RetellPhoneNumber>
}

export async function updateRetellPhoneNumberInboundAgent(
  phoneNumber: string,
  inboundAgentId: string | null,
  apiKey?: string,
): Promise<void> {
  const body = inboundAgentId
    ? { inbound_agents: [{ agent_id: inboundAgentId, weight: 1 }] }
    : { inbound_agents: [] }
  const res = await retellFetch(
    `/update-phone-number/${encodeURIComponent(phoneNumber)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    apiKey,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Retell updatePhoneNumber failed (${res.status}): ${text}`)
  }
}
