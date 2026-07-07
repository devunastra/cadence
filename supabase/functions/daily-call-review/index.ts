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
 * Returns the UTC-millisecond offset for `tz` at the given UTC instant.
 * Positive for zones east of UTC (e.g. Berlin +2h => +7200000), negative for west.
 */
function tzOffsetMsAt(tz: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(instant)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const localAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).getTime()
  return localAsUtc - instant.getTime()
}

/**
 * Get yesterday's UTC boundaries (and date label) for a single studio timezone.
 * Uses noon-in-tz to read the offset, so it handles DST cleanly.
 */
function getYesterdayBoundariesForTz(tz: string): { dateFrom: string; dateTo: string; dateLabel: string } {
  const now = new Date()
  const todayInTz = now.toLocaleDateString("en-CA", { timeZone: tz })  // YYYY-MM-DD
  const [y, m, d] = todayInTz.split("-").map(Number)
  const yesterdayDate = new Date(Date.UTC(y, m - 1, d - 1))
  const ys = yesterdayDate.getUTCFullYear()
  const ym = String(yesterdayDate.getUTCMonth() + 1).padStart(2, "0")
  const yd = String(yesterdayDate.getUTCDate()).padStart(2, "0")
  const dateLabel = `${ys}-${ym}-${yd}`

  const noonUtc = new Date(`${dateLabel}T12:00:00Z`)
  const offsetMs = tzOffsetMsAt(tz, noonUtc)
  const startMs = new Date(`${dateLabel}T00:00:00Z`).getTime() - offsetMs
  return {
    dateFrom: new Date(startMs).toISOString(),
    dateTo: new Date(startMs + 86_399_999).toISOString(),
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

    console.log("[daily-call-review] auth ok, computing per-studio yesterday windows")

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Load every studio's timezone + review_enabled flag (skip studios with reviews disabled).
    const { data: studioRows, error: studioErr } = await serviceClient
      .from("studios")
      .select("id, timezone, review_enabled")
      .is("deleted_at", null)
    if (studioErr) {
      return new Response(JSON.stringify({ error: studioErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }
    const studioTz = new Map<string, string>()
    const studioWindow = new Map<string, { fromMs: number; toMs: number; label: string }>()
    let wideFromMs = Number.POSITIVE_INFINITY
    let wideToMs = Number.NEGATIVE_INFINITY
    let disabledStudios = 0
    for (const s of (studioRows ?? []) as Array<{ id: string; timezone: string | null; review_enabled: boolean }>) {
      if (s.review_enabled !== true) {
        disabledStudios++
        continue
      }
      const tz = s.timezone || "America/Chicago"
      studioTz.set(s.id, tz)
      const { dateFrom, dateTo, dateLabel } = getYesterdayBoundariesForTz(tz)
      const fromMs = new Date(dateFrom).getTime()
      const toMs = new Date(dateTo).getTime()
      studioWindow.set(s.id, { fromMs, toMs, label: dateLabel })
      if (fromMs < wideFromMs) wideFromMs = fromMs
      if (toMs > wideToMs) wideToMs = toMs
    }
    if (!Number.isFinite(wideFromMs) || !Number.isFinite(wideToMs)) {
      console.log("[daily-call-review] no studios with review_enabled=true found (disabled=", disabledStudios, "), exiting")
      return new Response(
        JSON.stringify({ analyzed: 0, skipped: 0, total_eligible: 0, disabled_studios: disabledStudios, errors: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }
    const wideFrom = new Date(wideFromMs).toISOString()
    const wideTo = new Date(wideToMs).toISOString()
    console.log("[daily-call-review] wide UTC window:", wideFrom, "→", wideTo, "across", studioTz.size, "enabled studios (disabled=", disabledStudios, ")")

    // Fetch every call within the wide window. We'll filter per-studio next.
    const { data: calls, error: fetchError } = await serviceClient
      .from("calls")
      .select("id, transcript, transcript_summary, voicemail, direction, duration_seconds, studio_id, created_at")
      .neq("voicemail", true)
      .not("transcript", "is", null)
      .gt("duration_seconds", MIN_DURATION_SECONDS)
      .gte("created_at", wideFrom)
      .lte("created_at", wideTo)
      .order("created_at", { ascending: true })
      .limit(DAILY_BATCH_LIMIT)

    if (fetchError) {
      console.log("[daily-call-review] fetchError:", fetchError.message)
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    type CallRowWithTime = CallRow & { created_at: string }
    const rawCalls = (calls ?? []) as CallRowWithTime[]
    console.log("[daily-call-review] fetched calls count=", rawCalls.length)

    // Keep only calls whose created_at falls inside their own studio's yesterday window.
    const eligible: CallRow[] = rawCalls.filter((c) => {
      if (!c.transcript || c.transcript.trim().length === 0) return false
      const win = studioWindow.get(c.studio_id)
      if (!win) return false
      const t = new Date(c.created_at).getTime()
      return t >= win.fromMs && t <= win.toMs
    })
    console.log("[daily-call-review] eligible count=", eligible.length)

    if (eligible.length === 0) {
      console.log("[daily-call-review] no eligible calls, exiting")
      return new Response(
        JSON.stringify({ analyzed: 0, skipped: 0, total_eligible: 0, errors: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    // Skip already-reviewed
    const { data: existingReviews } = await serviceClient
      .from("call_reviews")
      .select("call_id")
      .in("call_id", eligible.map((c) => c.id))

    const reviewedIds = new Set(
      ((existingReviews ?? []) as Array<{ call_id: string }>).map((r) => r.call_id),
    )
    const callsToAnalyze = eligible.filter((c) => !reviewedIds.has(c.id))
    const skipped = eligible.length - callsToAnalyze.length
    const realtimeCoverage = eligible.length > 0 ? skipped / eligible.length : 1
    console.log("[daily-call-review] callsToAnalyze=", callsToAnalyze.length, "skipped(already-reviewed)=", skipped)
    console.log("[daily-call-review] realtime_coverage=", realtimeCoverage.toFixed(3),
      "(of", eligible.length, "eligible yesterday,", skipped, "were already reviewed by the realtime trigger before this cron ran)")

    // Process with concurrency
    const results = await processWithConcurrency(callsToAnalyze, serviceClient, "cron")

    const analyzed = results.filter((r) => r.success).length
    const errors = results.filter((r) => !r.success).map((r) => ({ callId: r.callId, error: r.error }))
    console.log("[daily-call-review] DONE analyzed=", analyzed, "errors=", JSON.stringify(errors))

    const studioLabels: Record<string, string> = {}
    for (const [sid, w] of studioWindow.entries()) studioLabels[sid] = w.label

    return new Response(
      JSON.stringify({
        analyzed,
        skipped,
        total_eligible: eligible.length,
        studio_dates: studioLabels,
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
  console.log("[analyzeCall] starting", call.id)
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
          temperature: 1,
          max_completion_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      })
      console.log("[analyzeCall]", call.id, "OpenAI attempt", attempt, "status:", response.status)

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
      console.log("[analyzeCall]", call.id, "OpenAI ERROR body:", errText.slice(0, 800))
      return { success: false, callId: call.id, error: `OpenAI API error: ${response?.status} — ${errText}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ""
    console.log("[analyzeCall]", call.id, "OpenAI content length:", content.length)

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.log("[analyzeCall]", call.id, "JSON parse error:", (parseErr as Error).message, "raw:", cleaned.slice(0, 400))
      throw parseErr
    }

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
      console.log("[analyzeCall]", call.id, "upsert ERROR:", upsertError.message)
      return { success: false, callId: call.id, error: `DB upsert error: ${upsertError.message}` }
    }

    console.log("[analyzeCall]", call.id, "SUCCESS")
    return { success: true, callId: call.id }
  } catch (err) {
    console.log("[analyzeCall]", call.id, "caught error:", (err as Error).message)
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
