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

  // Invite via PKCE code flow (?type=invite&code=xxx)
  if (code && type === 'invite') {
    const response = NextResponse.redirect(`${origin}/accept-invite`)
    const supabase = makeSupabaseClient(request, response)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=invalid_invite`)
    }
    return response
  }

  // Invite via OTP flow (?token_hash=xxx&type=invite)
  if (token_hash && type === 'invite') {
    const response = NextResponse.redirect(`${origin}/accept-invite`)
    const supabase = makeSupabaseClient(request, response)
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'invite' })
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=invalid_invite`)
    }
    return response
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
