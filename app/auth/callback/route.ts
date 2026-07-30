import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function makeSupabaseClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // Invite links (?type=invite with code or token_hash).
  //
  // IMPORTANT: we do NOT verify/consume the one-time token here. Invite tokens
  // are single-use, and corporate mailbox link-scanners (Outlook SafeLinks,
  // Gmail, antivirus) auto-GET every link on delivery — which would consume the
  // token before the human ever clicks, dumping them on /login. Instead we just
  // forward the token to /accept-invite and verify it on the password-form
  // SUBMIT (scanners GET, they don't submit forms). Newer invite emails link to
  // /accept-invite directly; this branch keeps already-sent /auth/callback links
  // working and equally scanner-safe.
  if (type === 'invite' && (code || token_hash)) {
    const params = new URLSearchParams({ type: 'invite' })
    if (token_hash) params.set('token_hash', token_hash)
    if (code) params.set('code', code)
    return NextResponse.redirect(`${origin}/accept-invite?${params.toString()}`)
  }

  // PKCE code flow — password reset
  if (code && type === 'recovery') {
    const response = NextResponse.redirect(`${origin}/reset-password`)
    const supabase = makeSupabaseClient(request, response)
    await supabase.auth.exchangeCodeForSession(code)
    return response
  }

  // PKCE code flow (magic link, etc.)
  if (code) {
    const response = NextResponse.redirect(`${origin}/leads`)
    const supabase = makeSupabaseClient(request, response)
    await supabase.auth.exchangeCodeForSession(code)
    return response
  }

  return NextResponse.redirect(`${origin}/leads`)
}
