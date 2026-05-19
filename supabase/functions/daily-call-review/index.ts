/**
 * Edge Function: daily-call-review
 * Cron trigger — runs daily via pg_cron at 7 AM UTC (1 AM CST / 2 AM CDT).
 * Reviews yesterday's calls for all studios.
 * Auth: x-cron-secret header.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CRON_SECRET = Deno.env.get("CRON_SECRET")

const DAILY_BATCH_LIMIT = 100
const CONCURRENCY = 2
const MIN_DURATION_SECONDS = 15

const SYSTEM_PROMPT = `You are a call quality analyst for a dance studio. Analyze this call transcript between an AI voice agent (powered by Retell AI) and a potential or existing dance student.

Context: The AI agent handles inbound and outbound calls for Arthur Murray dance studio — booking intro lessons, following up with leads, answering questions about pricing, lesson types (private, group, practice parties), and scheduling.

Evaluate:
1. Agent mistakes: Did the AI agent provide incorrect information, misunderstand the caller, or behave inappropriately? List each specific mistake.
2. Customer repetitions: How many times did the caller have to repeat themselves because the agent didn't understand or respond correctly? Estimate conservatively — only count clear repetitions where the caller restated the same information due to agent failure.
3. Booking attempt: Did the agent attempt to book a lesson or appointment? Was it successful? Note: not all calls require a booking attempt — informational calls, wrong numbers, and existing student check-ins should not be penalized for lack of booking.
4. Objections raised: Did the caller raise objections (pricing, schedule, partner, "need to think about it")? How did the agent handle them?
5. Callback/follow-up intent: Did the caller indicate they want to be called back, or that they'll call back later? Did the agent promise a follow-up?
6. Overall grade: "Pass" if the call was handled adequately (minor issues acceptable), "Fail" if there were significant errors, repeated misunderstandings, or the agent failed to attempt booking when the caller expressed clear interest. Do NOT fail a call simply because no booking occurred — only fail if the agent missed an obvious opportunity or performed poorly.

Respond with ONLY valid JSON, no markdown formatting:
{
  "grade": "Pass" or "Fail",
  "summary": "2-3 sentence summary of call quality",
  "agent_mistakes": ["list of specific mistakes, empty array if none"],
  "user_repeats": number,
  "booking_attempted": true/false,
  "booking_successful": true/false,
  "objections": ["list of objections raised, empty array if none"],
  "callback_requested": true/false,
  "follow_up_needed": true/false,
  "follow_up_reason": "reason for follow-up, null if not needed",
  "topics_discussed": ["pricing", "scheduling", "lesson types", etc.]
}`

interface CallRow {
  id: string
  studio_id: string
  transcript: string | null
  transcript_summary: string | null
  voicemail: boolean | null
  direction: string | null
  duration_seconds: number | null
}

interface AnalyzeResult {
  success: boolean
  callId: string
  error?: string
}

/**
 * Timing-safe string comparison to prevent timing attacks on the cron secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Get yesterday's date boundaries in UTC, based on America/Chicago timezone.
 */
function getYesterdayBoundaries(): { dateFrom: string; dateTo: string; dateLabel: string } {
  // Get current time in Chicago
  const now = new Date()
  const chicagoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }))

  // Yesterday in Chicago
  const yesterday = new Date(chicagoNow)
  yesterday.setDate(yesterday.getDate() - 1)

  const year = yesterday.getFullYear()
  const month = String(yesterday.getMonth() + 1).padStart(2, "0")
  const day = String(yesterday.getDate()).padStart(2, "0")
  const dateLabel = `${year}-${month}-${day}`

  // Convert midnight and 23:59:59 Chicago time to UTC
  const startChicago = new Date(`${dateLabel}T00:00:00`)
  const endChicago = new Date(`${dateLabel}T23:59:59.999`)

  // Get the UTC offset for these times by comparing
  const startInChicago = new Date(
    new Date(`${dateLabel}T00:00:00`).toLocaleString("en-US", { timeZone: "America/Chicago" })
  )
  const utcOffset = startChicago.getTime() - startInChicago.getTime()

  // Create proper UTC boundaries
  // Use Intl to get the actual offset
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
  })
  const parts = formatter.formatToParts(new Date(`${dateLabel}T12:00:00Z`))
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6"
  const offsetMatch = offsetPart.match(/GMT([+-]\d+)/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : -6

  // Midnight Chicago in UTC = midnight - offset (e.g., midnight CST = 6 AM UTC)
  const dateFrom = new Date(`${dateLabel}T00:00:00.000Z`)
  dateFrom.setHours(dateFrom.getHours() - offsetHours)

  const dateTo = new Date(`${dateLabel}T23:59:59.999Z`)
  dateTo.setHours(dateTo.getHours() - offsetHours)

  return {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    dateLabel,
  }
}

Deno.serve(async (req) => {
  try {
    // Verify OpenAI key
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Auth: verify cron secret
    if (!CRON_SECRET) {
      return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    const providedSecret = req.headers.get("x-cron-secret") ?? ""
    if (!timingSafeEqual(providedSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { dateFrom, dateTo, dateLabel } = getYesterdayBoundaries()

    // Fetch yesterday's calls across all studios
    const { data: calls, error: fetchError } = await serviceClient
      .from("calls")
      .select("id, transcript, transcript_summary, voicemail, direction, duration_seconds, studio_id")
      .neq("voicemail", true)
      .not("transcript", "is", null)
      .gt("duration_seconds", MIN_DURATION_SECONDS)
      .gte("created_at", dateFrom)
      .lte("created_at", dateTo)
      .order("created_at", { ascending: true })
      .limit(DAILY_BATCH_LIMIT)

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Filter eligible (non-empty transcript after fetch)
    const eligible = (calls as CallRow[]).filter(
      (c) => c.transcript && c.transcript.trim().length > 0
    )

    if (eligible.length === 0) {
      return new Response(
        JSON.stringify({ analyzed: 0, skipped: 0, total_eligible: 0, date: dateLabel, errors: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    // Skip already-reviewed
    const { data: existingReviews } = await serviceClient
      .from("call_reviews")
      .select("call_id")
      .in("call_id", eligible.map((c) => c.id))

    const reviewedIds = new Set((existingReviews ?? []).map((r) => r.call_id))
    const callsToAnalyze = eligible.filter((c) => !reviewedIds.has(c.id))
    const skipped = eligible.length - callsToAnalyze.length

    // Process with concurrency
    const results = await processWithConcurrency(callsToAnalyze, serviceClient, "cron")

    const analyzed = results.filter((r) => r.success).length
    const errors = results.filter((r) => !r.success).map((r) => ({ callId: r.callId, error: r.error }))

    return new Response(
      JSON.stringify({
        analyzed,
        skipped,
        total_eligible: eligible.length,
        date: dateLabel,
        errors,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})

async function analyzeCall(
  call: CallRow,
  serviceClient: ReturnType<typeof createClient>,
  triggerType: "manual" | "cron"
): Promise<AnalyzeResult> {
  try {
    let userMessage = `Call transcript:\n\n${call.transcript}`
    if (call.transcript_summary) {
      userMessage += `\n\nCall summary: ${call.transcript_summary}`
    }
    userMessage += `\nCall direction: ${call.direction ?? "unknown"}`
    userMessage += `\nDuration: ${call.duration_seconds ?? "unknown"} seconds`

    // Call OpenAI with retry on 429/503
    let response: Response | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.5",
          temperature: 0.3,
          max_completion_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      })

      if (response.status === 429 || response.status === 503) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          continue
        }
      }
      break
    }

    if (!response || !response.ok) {
      const errText = response ? await response.text() : "No response"
      return { success: false, callId: call.id, error: `OpenAI API error: ${response?.status} — ${errText}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ""

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    const parsed = JSON.parse(cleaned)

    const grade = parsed.grade === "Fail" ? "Fail" : "Pass"

    const { error: upsertError } = await serviceClient.from("call_reviews").upsert(
      {
        call_id: call.id,
        studio_id: call.studio_id,
        grade,
        summary: parsed.summary ?? "No summary provided",
        agent_mistakes: parsed.agent_mistakes ?? [],
        user_repeats: parsed.user_repeats ?? 0,
        booking_attempted: parsed.booking_attempted ?? null,
        booking_successful: parsed.booking_successful ?? null,
        objections: parsed.objections ?? [],
        callback_requested: parsed.callback_requested ?? false,
        follow_up_needed: parsed.follow_up_needed ?? false,
        follow_up_reason: parsed.follow_up_reason ?? null,
        topics_discussed: parsed.topics_discussed ?? [],
        raw_ai_response: parsed,
        model_used: "gpt-5.5",
        trigger_type: triggerType,
      },
      { onConflict: "call_id" }
    )

    if (upsertError) {
      return { success: false, callId: call.id, error: `DB upsert error: ${upsertError.message}` }
    }

    return { success: true, callId: call.id }
  } catch (err) {
    return { success: false, callId: call.id, error: (err as Error).message }
  }
}

async function processWithConcurrency(
  calls: CallRow[],
  serviceClient: ReturnType<typeof createClient>,
  triggerType: "manual" | "cron"
): Promise<AnalyzeResult[]> {
  const results: AnalyzeResult[] = []
  let index = 0

  const worker = async () => {
    while (index < calls.length) {
      const current = index++
      const result = await analyzeCall(calls[current], serviceClient, triggerType)
      results.push(result)
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, calls.length) }, () => worker())
  await Promise.all(workers)

  return results
}
