/**
 * Edge Function: analyze-call-quality
 * Manual trigger — operator clicks "Analyze Unreviewed Calls" in Call History.
 * Auth: Bearer JWT + role check (super_admin or studio_owner).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const MAX_BATCH = 10
const CONCURRENCY = 5
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Verify OpenAI key exists
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Auth: verify JWT
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Parse request body
    const { studio_id, call_ids, force = false } = await req.json()
    if (!studio_id || !Array.isArray(call_ids)) {
      return new Response(JSON.stringify({ error: "studio_id and call_ids are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Role check: super_admin (global, any studio) OR studio_owner on THIS studio.
    // super_admin role is stored per-studio in studio_users but the app treats it as global,
    // so we scan all the user's memberships rather than scoping the query to this studio.
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: memberships } = await serviceClient
      .from("studio_users")
      .select("role, studio_id")
      .eq("user_id", user.id)

    const isSuper = memberships?.some((m) => m.role === "super_admin") ?? false
    const isOwnerHere =
      memberships?.some((m) => m.studio_id === studio_id && m.role === "studio_owner") ?? false
    if (!isSuper && !isOwnerHere) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Cap batch size
    const cappedIds = call_ids.slice(0, MAX_BATCH)

    if (cappedIds.length === 0) {
      return new Response(JSON.stringify({ analyzed: 0, skipped: 0, errors: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Fetch calls
    const { data: calls, error: fetchError } = await serviceClient
      .from("calls")
      .select("id, transcript, transcript_summary, voicemail, direction, duration_seconds, studio_id")
      .in("id", cappedIds)
      .eq("studio_id", studio_id)

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Filter eligible calls
    const eligible = (calls as CallRow[]).filter(
      (c) =>
        c.transcript &&
        c.transcript.trim().length > 0 &&
        c.voicemail !== true &&
        (c.duration_seconds === null || c.duration_seconds >= MIN_DURATION_SECONDS)
    )

    // Skip already-reviewed (unless force)
    let callsToAnalyze = eligible
    if (!force && eligible.length > 0) {
      const { data: existingReviews } = await serviceClient
        .from("call_reviews")
        .select("call_id")
        .in("call_id", eligible.map((c) => c.id))

      const reviewedIds = new Set((existingReviews ?? []).map((r) => r.call_id))
      callsToAnalyze = eligible.filter((c) => !reviewedIds.has(c.id))
    }

    const skipped = cappedIds.length - callsToAnalyze.length

    // Process with concurrency
    const results = await processWithConcurrency(callsToAnalyze, serviceClient, "manual")

    const analyzed = results.filter((r) => r.success).length
    const errors = results.filter((r) => !r.success).map((r) => ({ callId: r.callId, error: r.error }))

    return new Response(JSON.stringify({ analyzed, skipped, errors }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          temperature: 1,
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

    // Parse JSON (strip markdown fences as fallback)
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    const parsed = JSON.parse(cleaned)

    const grade = parsed.grade === "Fail" ? "Fail" : "Pass"

    // Upsert to call_reviews
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
