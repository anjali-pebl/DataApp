import { createClient } from '@/lib/supabase/client'
import type { AccountRole, UserProfile } from './role-service'

export interface PartnerWithShares extends UserProfile {
  shared_project_count: number
}

export interface ProjectShare {
  id: string
  project_id: string
  shared_with_user_id: string
  permission: string
  shared_by: string
  created_at: string
  project_name?: string
}

export interface ProjectSummary {
  id: string
  name: string
  user_id: string
  created_at: string
}

const HARDCODED_PROJECTS: ProjectSummary[] = [
  { id: 'milfordhaven', name: 'Milford Haven', user_id: 'system', created_at: '' },
  { id: 'ramseysound', name: 'Ramsey Sound', user_id: 'system', created_at: '' },
  { id: 'bidefordbay', name: 'Bideford Bay', user_id: 'system', created_at: '' },
  { id: 'blakeneyoverfalls', name: 'Blakeney Overfalls', user_id: 'system', created_at: '' },
  { id: 'pabayinnersound', name: 'Pabay Inner Sound', user_id: 'system', created_at: '' },
  { id: 'lochbay', name: 'Loch Bay', user_id: 'system', created_at: '' },
  { id: 'lochsunart', name: 'Loch Sunart', user_id: 'system', created_at: '' },
]

class AdminService {
  private get supabase() {
    return createClient()
  }

  async getPendingUsers(): Promise<UserProfile[]> {
    const { data, error } = await this.supabase
      .from('user_profiles')
      .select('id, email, display_name, account_role, is_admin, created_at')
      .eq('account_role', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as UserProfile[]
  }

  async approveUser(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_profiles')
      .update({ account_role: 'partner' as AccountRole })
      .eq('id', userId)

    if (error) throw error
  }

  async rejectUser(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_profiles')
      .delete()
      .eq('id', userId)

    if (error) throw error
  }

  async getPartners(): Promise<UserProfile[]> {
    const { data, error } = await this.supabase
      .from('user_profiles')
      .select('id, email, display_name, account_role, is_admin, created_at')
      .eq('account_role', 'partner')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as UserProfile[]
  }

  async getAllUsers(): Promise<UserProfile[]> {
    const { data, error } = await this.supabase
      .from('user_profiles')
      .select('id, email, display_name, account_role, is_admin, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as UserProfile[]
  }

  async getProjectShares(userId: string): Promise<ProjectShare[]> {
    const { data, error } = await this.supabase
      .from('project_shares')
      .select(`
        id,
        project_id,
        shared_with_user_id,
        permission,
        shared_by,
        created_at
      `)
      .eq('shared_with_user_id', userId)

    if (error) throw error
    return (data ?? []) as ProjectShare[]
  }

  async shareProject(projectId: string, userId: string, permission: string = 'view'): Promise<void> {
    const supabase = this.supabase
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('project_shares')
      .upsert({
        project_id: projectId,
        shared_with_user_id: userId,
        permission,
        shared_by: user.id,
      }, {
        onConflict: 'project_id,shared_with_user_id',
      })

    if (error) throw error
  }

  async revokeProjectShare(projectId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('project_shares')
      .delete()
      .eq('project_id', projectId)
      .eq('shared_with_user_id', userId)

    if (error) throw error
  }

  async getAllProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('id, name, user_id, created_at')
      .order('name', { ascending: true })

    const dbProjects = error ? [] : (data ?? []) as ProjectSummary[]
    return [...HARDCODED_PROJECTS, ...dbProjects]
  }

  async getSharedProjectsForUser(userId: string): Promise<ProjectSummary[]> {
    const { data, error } = await this.supabase
      .from('project_shares')
      .select(`
        project_id,
        projects:project_id (id, name, user_id, created_at)
      `)
      .eq('shared_with_user_id', userId)

    if (error) throw error
    return (data ?? []).map((row: any) => row.projects).filter(Boolean) as ProjectSummary[]
  }
}

export const adminService = new AdminService()
