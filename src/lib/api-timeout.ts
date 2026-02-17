/**
 * API Timeout Utilities
 *
 * Prevents API routes from hanging indefinitely by adding timeout protection
 * to async operations. This is especially important for:
 * - Database queries that might hang
 * - External API calls
 * - File system operations
 * - Supabase client creation with cookies()
 *
 * Usage:
 * ```typescript
 * import { withTimeout } from '@/lib/api-timeout';
 *
 * export async function GET() {
 *   const supabase = await withTimeout(
 *     createClient(),
 *     5000,
 *     'Supabase client creation'
 *   );
 * }
 * ```
 */

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description of the operation (for error messages)
 * @returns Promise that rejects if timeout is exceeded
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Standard timeout values for different operations
 */
export const TIMEOUTS = {
  CLIENT_CREATION: 5000,    // Supabase client creation (cookies, auth)
  USER_AUTH: 5000,          // User authentication check
  DATABASE_READ: 10000,     // Database SELECT queries
  DATABASE_WRITE: 15000,    // Database INSERT/UPDATE/DELETE queries
  FILE_READ: 5000,          // File system reads
  FILE_WRITE: 10000,        // File system writes
  EXTERNAL_API: 15000,      // External API calls
} as const;

/**
 * Add standard exports to API routes to prevent caching/timeout issues
 *
 * Add these to all API route files:
 * ```typescript
 * export const dynamic = 'force-dynamic';
 * export const revalidate = 0;
 * export const maxDuration = 30;
 * ```
 */
export const API_ROUTE_CONFIG = {
  dynamic: 'force-dynamic' as const,
  revalidate: 0,
  maxDuration: 30,
};
