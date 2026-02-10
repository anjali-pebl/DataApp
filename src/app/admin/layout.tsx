import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('account_role')
    .eq('id', user.id)
    .single()

  if (profile?.account_role !== 'pebl') {
    redirect('/map-drawing')
  }

  return <>{children}</>
}
