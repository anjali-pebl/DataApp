import { createClient } from '@/lib/supabase/client'

export type AccountRole = 'pebl' | 'partner' | 'pending' | 'public'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  account_role: AccountRole
  is_admin: boolean
  created_at: string
}

export function isPebl(role: AccountRole | null): boolean {
  return role === 'pebl'
}

export function isApproved(role: AccountRole | null): boolean {
  return role === 'pebl' || role === 'partner'
}

export function isPending(role: AccountRole | null): boolean {
  return role === 'pending'
}

export async function getUserRole(): Promise<AccountRole | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Try account_role first (exists after RBAC migration)
  const { data, error } = await supabase
    .from('user_profiles')
    .select('account_role, is_admin')
    .eq('id', user.id)
    .single()

  if (error) {
    // Column may not exist yet - fall back to is_admin only
    const { data: fallback } = await supabase
      .from('user_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    return fallback?.is_admin ? 'pebl' : 'partner'
  }

  if (data?.account_role) return data.account_role as AccountRole
  return data?.is_admin ? 'pebl' : 'partner'
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, display_name, account_role, is_admin, created_at')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as UserProfile
}
