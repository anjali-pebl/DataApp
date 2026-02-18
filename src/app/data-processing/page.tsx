'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ExperimentsDashboard from '@/components/ocean-ml/ExperimentsDashboard'
import { getUserRole } from '@/lib/supabase/role-service'
import { Loader2, ShieldAlert } from 'lucide-react'

export default function DataProcessingPage() {
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)

  // Check if user is PEBL admin
  useEffect(() => {
    async function checkAccess() {
      const role = await getUserRole()
      if (role !== 'pebl') {
        setIsAuthorized(false)
      } else {
        setIsAuthorized(true)
      }
    }
    checkAccess()
  }, [])

  // Create a query client for this page
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
          },
        },
      })
  )

  // Show loading while checking authorization
  if (isAuthorized === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Show access denied for non-admins
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Access Restricted</h1>
          <p className="text-muted-foreground">This page is only available to PEBL administrators.</p>
          <button
            onClick={() => router.push('/map-drawing')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Return to Map
          </button>
        </div>
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background">
        {/* Main content */}
        <main className="flex-grow">
          <ExperimentsDashboard />
        </main>

        {/* Footer */}
        <footer className="py-3 sm:px-3 sm:py-2 border-t bg-secondary/50">
          <div className="container flex flex-col items-center justify-center gap-2 sm:h-14 sm:flex-row sm:justify-between">
            <div className="flex flex-col items-center sm:items-start gap-1">
              <div className="flex items-center gap-2">
                <div className="text-xs font-futura font-bold text-primary">PEBL</div>
                <div className="text-xs text-muted-foreground pebl-body-main">Ocean Data Platform</div>
              </div>
              <div className="text-[0.6rem] text-primary font-futura font-medium">
                Protecting Ecology Beyond Land
              </div>
            </div>
            <div className="text-xs text-muted-foreground pebl-body-main">© 2024 PEBL</div>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  )
}
