/**
 * Edge Function: analyze-single-call
 * Realtime trigger — fires from a Postgres trigger on `public.calls` via pg_net.http_post
 * (see migration 039_realtime_call_review_trigger.sql).
 * Reviews ONE call (by call_id) with the same prompt + upsert semantics as daily-call-review.
 * Auth: x-cron-secret header (reuses the existing CRON_SECRET env var).
 *
 * NOTE: SYSTEM_PROMPT is duplicated in daily-call-review/index.ts. Keep them in sync.
 *
 * Idempotency: call_reviews upsert uses onConflict: 'call_id'. Ineligible calls (voicemail,
 * missing transcript, short duration, already-reviewed) return 200 with `skipped: <reason>`
 * so the trigger doesn't get confused by 4xx.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CRON_SECRET = Deno.env.get("CRON_SECRET")

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

Deno.serve(async (req) => {
  try {
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    if (!CRON_SECRET) {
      return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    const providedSecret = req.headers.get("x-cron-secret") ?? ""
    if (!timingSafeEqual(providedSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })
    }

    let body: { call_id?: string }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }
    const callId = body.call_id
    if (!callId || typeof callId !== "string") {
      return new Response(JSON.stringify({ error: "Missing call_id" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }

    console.log("[analyze-single-call] processing call_id=", callId)

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: call, error: fetchErr } = await serviceClient
      .from("calls")
      .select("id, studio_id, transcript, transcript_summary, voicemail, direction, duration_seconds")
      .eq("id", callId)
      .maybeSingle()

    if (fetchErr) {
      console.log("[analyze-single-call] fetch error:", fetchErr.message)
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    if (!call) {
      console.log("[analyze-single-call] call not found:", callId)
      return new Response(JSON.stringify({ skipped: "not_found", call_id: callId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }

    // Eligibility — must match daily-call-review filters exactly.
    if (call.voicemail === true) {
      console.log("[analyze-single-call] skipped voicemail:", callId)
      return new Response(JSON.stringify({ skipped: "voicemail", call_id: callId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }
    if (!call.transcript || call.transcript.trim().length === 0) {
      console.log("[analyze-single-call] skipped no transcript:", callId)
      return new Response(JSON.stringify({ skipped: "no_transcript", call_id: callId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }
    if (call.duration_seconds == null || call.duration_seconds <= MIN_DURATION_SECONDS) {
      console.log("[analyze-single-call] skipped short duration:", callId, "dur=", call.duration_seconds)
      return new Response(JSON.stringify({ skipped: "short_duration", call_id: callId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }

    const { data: existing } = await serviceClient
      .from("call_reviews")
      .select("id")
      .eq("call_id", callId)
      .maybeSingle()
    if (existing) {
      console.log("[analyze-single-call] already reviewed:", callId)
      return new Response(JSON.stringify({ skipped: "already_reviewed", call_id: callId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }

    let userMessage = `Call transcript:\n\n${call.transcript}`
    if (call.transcript_summary) {
      userMessage += `\n\nCall summary: ${call.transcript_summary}`
    }
    userMessage += `\nCall direction: ${call.direction ?? "unknown"}`
    userMessage += `\nDuration: ${call.duration_seconds ?? "unknown"} seconds`

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
      console.log("[analyze-single-call]", callId, "OpenAI attempt", attempt, "status:", response.status)
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
      console.log("[analyze-single-call]", callId, "OpenAI ERROR body:", errText.slice(0, 800))
      return new Response(
        JSON.stringify({ error: `OpenAI API error: ${response?.status} — ${errText}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      )
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ""
    console.log("[analyze-single-call]", callId, "OpenAI content length:", content.length)
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.log("[analyze-single-call]", callId, "JSON parse error:", (parseErr as Error).message, "raw:", cleaned.slice(0, 400))
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      )
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
        trigger_type: "realtime",
      },
      { onConflict: "call_id" },
    )

    if (upsertError) {
      console.log("[analyze-single-call]", callId, "upsert ERROR:", upsertError.message)
      return new Response(
        JSON.stringify({ error: `DB upsert error: ${upsertError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      )
    }

    console.log("[analyze-single-call]", callId, "SUCCESS grade=", grade)
    return new Response(JSON.stringify({ success: true, call_id: callId, grade }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.log("[analyze-single-call] caught error:", (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    })
  }
})
