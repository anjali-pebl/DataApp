import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refreshing the auth token
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public routes that don't need role checking
  const publicRoutes = ['/login', '/auth', '/auth/callback', '/pending-approval']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))

  if (isPublicRoute) {
    return supabaseResponse
  }

  // If no user, don't do role checks (let the page handle auth redirect)
  if (!user) {
    return supabaseResponse
  }

  // Fetch user role for protected route checks
  // Try account_role first (exists after RBAC migration), fall back to is_admin
  let role: string = 'pending'

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('account_role, is_admin')
    .eq('id', user.id)
    .single()

  if (profileError) {
    // If query fails (e.g. account_role column doesn't exist yet), try is_admin only
    const { data: fallbackProfile } = await supabase
      .from('user_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    role = fallbackProfile?.is_admin ? 'pebl' : 'partner'
  } else {
    role = profile?.account_role ?? (profile?.is_admin ? 'pebl' : 'partner')
  }

  // Admin routes require 'pebl' role
  if (pathname.startsWith('/admin') || pathname.startsWith('/usage-dashboard')) {
    if (role !== 'pebl') {
      const url = request.nextUrl.clone()
      url.pathname = '/map-drawing'
      return NextResponse.redirect(url)
    }
  }

  // Protected app routes require approved status (pebl or partner)
  const protectedRoutes = ['/map-drawing', '/data-explorer', '/project-data']
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && role === 'pending') {
    const url = request.nextUrl.clone()
    url.pathname = '/pending-approval'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
