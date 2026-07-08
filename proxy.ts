import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, LOGIN_LIMIT } from '@/lib/rate-limit'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Rate limit login POST attempts by IP
  if (pathname === '/login' && request.method === 'POST') {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    const { allowed } = await checkRateLimit(`login:${ip}`, LOGIN_LIMIT)
    if (!allowed) {
      return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 })
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Use getSession() (no network call — reads JWT from cookie) for fast navigation.
  // The JWT is validated by Supabase client library (signature + expiry).
  // getUser() is only needed for login-related actions, not every page load.
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  // Allow unauthenticated access to public paths
  const PUBLIC_PATHS = ['/login', '/auth/callback', '/accept-invite', '/api/webhooks', '/api/notion-sync', '/api/cron']
  if (!user && !PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Invited users who haven't set a password yet must complete onboarding first
  if (user && user.user_metadata?.onboarding_complete === false && !pathname.startsWith('/accept-invite')) {
    return NextResponse.redirect(new URL('/accept-invite', request.url))
  }

  // Invited studio owners who set a password but haven't created their studio yet
  // are forced into the onboarding wizard until they finish (flag flips to true on submit).
  if (
    user &&
    user.user_metadata?.studio_setup_complete === false &&
    !pathname.startsWith('/onboarding') &&
    !pathname.startsWith('/accept-invite') &&
    pathname !== '/login'
  ) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  // Redirect logged-in users away from login — skip if they have pending onboarding so a
  // different account can sign in from the same browser without being bounced to /onboarding.
  if (user && pathname === '/login' && user.user_metadata?.studio_setup_complete !== false) {
    return NextResponse.redirect(new URL('/leads', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
