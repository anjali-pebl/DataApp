import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Timeout helper for middleware
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Middleware operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export async function updateSession(request: NextRequest) {
  try {
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

    // refreshing the auth token with timeout
    await withTimeout(supabase.auth.getUser(), 5000);

    return supabaseResponse

  } catch (error) {
    console.error('[MIDDLEWARE] Error:', error);
    // On timeout or error, just pass through the request without auth
    // This prevents the entire app from hanging
    return NextResponse.next({ request });
  }
}
