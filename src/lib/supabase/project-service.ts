import { createClient } from './client'
import { Project } from './types'
import { isPeblAdminEmail } from './role-service'

class ProjectService {
  private supabase = createClient()

  // Note: RLS policies handle access control - users see their own projects,
  // PEBL admins see all projects, partners see shared projects
  async getProjects(): Promise<Project[]> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      console.log('[ProjectService] No user authenticated, returning empty projects');
      return [];
    }

    console.log('[ProjectService] Loading projects for user:', user.id, user.email);

    // Let RLS handle access control - no user_id filter needed
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[ProjectService] Error loading projects:', error);
      throw error;
    }

    console.log('[ProjectService] Loaded', data?.length || 0, 'projects from database');

    return (data || []).map(project => ({
      id: project.id,
      name: project.name,
      description: project.description || undefined,
      createdAt: new Date(project.created_at)
    }))
  }

  async createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    console.log('🆕 Creating new project:', project);
    
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      console.error('❌ User not authenticated for project creation');
      throw new Error('Please log in to create projects. User authentication is required.')
    }

    console.log('✅ User authenticated:', user.id);

    const { data, error } = await this.supabase
      .from('projects')
      .insert({
        name: project.name,
        description: project.description || null,
        user_id: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Project creation error:', error);
      throw error;
    }

    console.log('✅ Project created successfully:', data);

    return {
      id: data.id,
      name: data.name,
      description: data.description || undefined,
      createdAt: new Date(data.created_at)
    }
  }

  async updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'description'>>): Promise<Project> {
    console.log('📝 Updating project:', id, updates);

    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      console.error('❌ User not authenticated for project update');
      throw new Error('Please log in to update projects. User authentication is required.')
    }

    const isAdmin = isPeblAdminEmail(user.email)

    // First verify the user owns this project (admins can update any project)
    const { data: projectCheck, error: checkError } = await this.supabase
      .from('projects')
      .select('user_id')
      .eq('id', id)
      .single()

    if (checkError || !projectCheck) {
      console.error('❌ Project not found:', checkError);
      throw new Error('Project not found or access denied.')
    }

    if (!isAdmin && projectCheck.user_id !== user.id) {
      console.error('❌ User does not own this project');
      throw new Error('You do not have permission to update this project.')
    }

    const { data, error } = await this.supabase
      .from('projects')
      .update({
        name: updates.name,
        description: updates.description || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('❌ Project update error:', error);
      throw error;
    }

    console.log('✅ Project updated successfully:', data);

    return {
      id: data.id,
      name: data.name,
      description: data.description || undefined,
      createdAt: new Date(data.created_at)
    }
  }

  async deleteProject(id: string): Promise<void> {
    console.log('🗑️ Deleting project:', id);

    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      console.error('❌ User not authenticated for project deletion');
      throw new Error('Please log in to delete projects. User authentication is required.')
    }

    const isAdmin = isPeblAdminEmail(user.email)

    // First verify the user owns this project (admins can delete any project)
    const { data: projectCheck, error: checkError } = await this.supabase
      .from('projects')
      .select('user_id')
      .eq('id', id)
      .single()

    if (checkError || !projectCheck) {
      console.error('❌ Project not found:', checkError);
      throw new Error('Project not found or access denied.')
    }

    if (!isAdmin && projectCheck.user_id !== user.id) {
      console.error('❌ User does not own this project');
      throw new Error('You do not have permission to delete this project.')
    }

    console.log('🔍 Checking for related data (pins, lines, areas, files)...');

    // Check for related pins, lines, areas that would be affected
    const [
      { data: pins, error: pinsError },
      { data: lines, error: linesError }, 
      { data: areas, error: areasError }
    ] = await Promise.all([
      this.supabase.from('pins').select('id').eq('project_id', id),
      this.supabase.from('lines').select('id').eq('project_id', id),
      this.supabase.from('areas').select('id').eq('project_id', id)
    ]);

    if (pinsError || linesError || areasError) {
      console.error('❌ Error checking related data:', { pinsError, linesError, areasError });
      throw new Error('Error checking related data. Please try again.');
    }

    const totalObjects = (pins?.length || 0) + (lines?.length || 0) + (areas?.length || 0);
    console.log(`📊 Found ${totalObjects} related objects: ${pins?.length || 0} pins, ${lines?.length || 0} lines, ${areas?.length || 0} areas`);

    // Delete all related data first (foreign key constraints)
    if (pins && pins.length > 0) {
      console.log('🧹 Deleting related pins...');
      // Delete pin files first
      for (const pin of pins) {
        const { error: filesError } = await this.supabase
          .from('pin_files')
          .delete()
          .eq('pin_id', pin.id);
        
        if (filesError) {
          console.warn('⚠️ Warning: Could not delete some pin files:', filesError);
        }
      }
      
      // Delete pin tags
      const { error: pinTagsError } = await this.supabase
        .from('pin_tags')
        .delete()
        .in('pin_id', pins.map(p => p.id));
      
      if (pinTagsError) {
        console.warn('⚠️ Warning: Could not delete some pin tags:', pinTagsError);
      }

      // Delete pins
      const { error: pinsDeleteError } = await this.supabase
        .from('pins')
        .delete()
        .eq('project_id', id);
      
      if (pinsDeleteError) {
        console.error('❌ Error deleting pins:', pinsDeleteError);
        throw new Error('Failed to delete project pins. Please try again.');
      }
    }

    if (lines && lines.length > 0) {
      console.log('🧹 Deleting related lines...');
      // Delete line tags
      const { error: lineTagsError } = await this.supabase
        .from('line_tags')
        .delete()
        .in('line_id', lines.map(l => l.id));
      
      if (lineTagsError) {
        console.warn('⚠️ Warning: Could not delete some line tags:', lineTagsError);
      }

      // Delete lines
      const { error: linesDeleteError } = await this.supabase
        .from('lines')
        .delete()
        .eq('project_id', id);
      
      if (linesDeleteError) {
        console.error('❌ Error deleting lines:', linesDeleteError);
        throw new Error('Failed to delete project lines. Please try again.');
      }
    }

    if (areas && areas.length > 0) {
      console.log('🧹 Deleting related areas...');
      // Delete area tags
      const { error: areaTagsError } = await this.supabase
        .from('area_tags')
        .delete()
        .in('area_id', areas.map(a => a.id));
      
      if (areaTagsError) {
        console.warn('⚠️ Warning: Could not delete some area tags:', areaTagsError);
      }

      // Delete areas
      const { error: areasDeleteError } = await this.supabase
        .from('areas')
        .delete()
        .eq('project_id', id);
      
      if (areasDeleteError) {
        console.error('❌ Error deleting areas:', areasDeleteError);
        throw new Error('Failed to delete project areas. Please try again.');
      }
    }

    // Delete project tags
    console.log('🧹 Deleting project tags...');
    const { error: tagsError } = await this.supabase
      .from('tags')
      .delete()
      .eq('project_id', id);
    
    if (tagsError) {
      console.warn('⚠️ Warning: Could not delete some tags:', tagsError);
    }

    // Finally delete the project itself
    console.log('🗑️ Deleting project record...');
    const { error } = await this.supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('❌ Project deletion error:', error);
      throw error;
    }

    console.log('✅ Project deleted successfully');
  }

  /**
   * Get project by ID with user verification
   */
  async getProject(id: string): Promise<Project | null> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return null

    const isAdmin = isPeblAdminEmail(user.email)

    let query = this.supabase
      .from('projects')
      .select('*')
      .eq('id', id)

    // Only filter by user_id for non-admin users; admins can view any project
    if (!isAdmin) {
      query = query.eq('user_id', user.id)
    }

    const { data, error } = await query.single()

    if (error || !data) return null

    return {
      id: data.id,
      name: data.name,
      description: data.description || undefined,
      createdAt: new Date(data.created_at)
    }
  }

  /**
   * Get project by slug/name match (for legacy location-based project IDs)
   * Converts slug like 'milfordhaven' to match 'Milford Haven'
   */
  async getProjectBySlug(slug: string): Promise<Project | null> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return null

    const isAdmin = isPeblAdminEmail(user.email)

    // Get projects and find one whose name matches the slug
    let query = this.supabase
      .from('projects')
      .select('*')

    // Only filter by user_id for non-admin users
    if (!isAdmin) {
      query = query.eq('user_id', user.id)
    }

    const { data, error } = await query

    if (error || !data) return null

    // Convert slug to comparable format and find matching project
    const normalizeForComparison = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/g, '')

    const normalizedSlug = normalizeForComparison(slug)

    const matchingProject = data.find(project =>
      normalizeForComparison(project.name) === normalizedSlug
    )

    if (!matchingProject) return null

    return {
      id: matchingProject.id,
      name: matchingProject.name,
      description: matchingProject.description || undefined,
      createdAt: new Date(matchingProject.created_at)
    }
  }

  /**
   * Discover projects by scanning distinct project_ids from pins, lines, and areas.
   * This finds legacy string-based projects (e.g. 'bidefordbay') that don't have
   * entries in the projects table. RLS policies control which data is visible.
   */
  async discoverLegacyProjects(): Promise<Project[]> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    const LEGACY_NAMES: Record<string, string> = {
      milfordhaven: "Milford Haven",
      ramseysound: "Ramsey Sound",
      bidefordbay: "Bideford Bay",
      blakeneyoverfalls: "Blakeney Overfalls",
      pabayinnersound: "Pabay Inner Sound",
      lochbay: "Loch Bay",
      lochsunart: "Loch Sunart",
    }

    // Query distinct project_ids from pins, lines, and areas (RLS handles access)
    const [pinsResult, linesResult, areasResult] = await Promise.all([
      this.supabase.from('pins').select('project_id').not('project_id', 'is', null),
      this.supabase.from('lines').select('project_id').not('project_id', 'is', null),
      this.supabase.from('areas').select('project_id').not('project_id', 'is', null),
    ])

    const allProjectIds = new Set<string>()

    for (const result of [pinsResult, linesResult, areasResult]) {
      if (result.data) {
        for (const row of result.data) {
          if (row.project_id) allProjectIds.add(row.project_id)
        }
      }
    }

    // Filter to non-UUID project IDs (legacy projects)
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

    const legacyProjects: Project[] = []
    for (const projectId of allProjectIds) {
      if (!isUuid(projectId)) {
        legacyProjects.push({
          id: projectId,
          name: LEGACY_NAMES[projectId] || projectId,
          description: undefined,
          createdAt: new Date(),
        })
      }
    }

    console.log(`[ProjectService] Discovered ${legacyProjects.length} legacy projects from data`)
    return legacyProjects
  }

  async getSharedProjects(): Promise<(Project & { isShared: true })[]> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    // Legacy project locations for non-UUID project IDs
    const LEGACY_PROJECTS: Record<string, string> = {
      milfordhaven: "Milford Haven",
      ramseysound: "Ramsey Sound",
      bidefordbay: "Bideford Bay",
      blakeneyoverfalls: "Blakeney Overfalls",
      pabayinnersound: "Pabay Inner Sound",
      lochbay: "Loch Bay",
      lochsunart: "Loch Sunart",
    }

    // Step 1: Get project IDs shared with this user
    const { data: shares, error: sharesError } = await this.supabase
      .from('project_shares')
      .select('project_id')
      .eq('shared_with_user_id', user.id)

    if (sharesError) {
      console.error('Error loading project shares:', sharesError)
      return []
    }

    if (!shares || shares.length === 0) {
      return []
    }

    const results: (Project & { isShared: true })[] = []
    const uuidProjectIds: string[] = []

    // Separate UUID project IDs from legacy string IDs
    for (const share of shares) {
      const projectId = share.project_id
      // Check if it's a UUID (contains hyphens and is 36 chars)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)

      if (isUuid) {
        uuidProjectIds.push(projectId)
      } else if (LEGACY_PROJECTS[projectId]) {
        // Legacy string ID - use hardcoded name
        results.push({
          id: projectId,
          name: LEGACY_PROJECTS[projectId],
          description: undefined,
          createdAt: new Date(),
          isShared: true as const,
        })
      }
    }

    // Step 2: Get the actual project details for UUID projects
    if (uuidProjectIds.length > 0) {
      const { data: projects, error: projectsError } = await this.supabase
        .from('projects')
        .select('id, name, description, created_at')
        .in('id', uuidProjectIds)

      if (projectsError) {
        console.error('Error loading shared project details:', projectsError)
      } else {
        for (const project of projects ?? []) {
          results.push({
            id: project.id,
            name: project.name,
            description: project.description || undefined,
            createdAt: new Date(project.created_at),
            isShared: true as const,
          })
        }
      }
    }

    return results
  }
}

export const projectService = new ProjectService()