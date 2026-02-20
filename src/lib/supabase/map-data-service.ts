import { createClient } from './client'
import { Database, Project, Tag, Pin, Line, Area } from './types'
import { SupabaseClient } from '@supabase/supabase-js'
import { analyticsService } from '@/lib/analytics/analytics-service'
import { isPeblAdminEmail } from './role-service'

type SupabaseClientType = SupabaseClient<Database>

export class MapDataService {
  private supabase: SupabaseClientType

  constructor() {
    this.supabase = createClient()
  }

  // Project operations
  // Note: RLS policies handle access control - users see their own projects,
  // PEBL admins see all projects, partners see shared projects
  async getProjects(): Promise<Project[]> {
    // Get current user
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    // Let RLS handle access control - no user_id filter needed
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return data.map(project => ({
      id: project.id,
      name: project.name,
      description: project.description || undefined,
      createdAt: new Date(project.created_at)
    }))
  }

  async createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    const startTime = Date.now();
    // Get current user ID
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) throw new Error('Please log in to create projects. User authentication is required.')
    const userId = user.id

    const { data, error } = await this.supabase
      .from('projects')
      .insert({
        name: project.name,
        description: project.description || null,
        user_id: userId
      })
      .select()
      .single()

    if (error) {
      analyticsService.trackError('createProject', error, { project_name: project.name }).catch(err => console.error('Analytics tracking error:', err));
      throw error;
    }

    // Track successful project creation
    analyticsService.trackAction('project_created', 'project', {
      project_id: data.id,
      project_name: data.name,
      has_description: !!data.description,
    }, startTime).catch(err => console.error('Analytics tracking error:', err));

    return {
      id: data.id,
      name: data.name,
      description: data.description || undefined,
      createdAt: new Date(data.created_at)
    }
  }

  async updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'description'>>): Promise<Project> {
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

    if (error) throw error

    return {
      id: data.id,
      name: data.name,
      description: data.description || undefined,
      createdAt: new Date(data.created_at)
    }
  }

  async deleteProject(id: string): Promise<void> {
    const startTime = Date.now();
    const { error } = await this.supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (error) {
      analyticsService.trackError('deleteProject', error, { project_id: id }).catch(err => console.error('Analytics tracking error:', err));
      throw error;
    }

    // Track successful project deletion
    analyticsService.trackAction('project_deleted', 'project', { project_id: id }, startTime).catch(err => console.error('Analytics tracking error:', err));
  }

  // Tag operations
  // Note: RLS policies handle access control
  async getTags(projectId?: string): Promise<Tag[]> {
    // Get current user
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    // Let RLS handle access control - no user_id filter needed
    let query = this.supabase.from('tags').select('*')

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data, error } = await query.order('name')

    if (error) throw error

    return data.map(tag => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      projectId: tag.project_id
    }))
  }

  async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    // Get current user ID
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) throw new Error('Please log in to create tags. User authentication is required.')
    const userId = user.id

    const { data, error } = await this.supabase
      .from('tags')
      .insert({
        name: tag.name,
        color: tag.color,
        project_id: tag.projectId,
        user_id: userId
      })
      .select()
      .single()

    if (error) throw error

    return {
      id: data.id,
      name: data.name,
      color: data.color,
      projectId: data.project_id
    }
  }

  // Pin operations
  async getPins(projectId?: string): Promise<Pin[]> {
    // Get current session for filtering
    const { data: { session }, error: authError } = await this.supabase.auth.getSession()
    if (authError) {
      // Only log if it's not the expected "Auth session missing" error
      if (authError.message !== 'Auth session missing!') {
        console.error('MapDataService: Auth error in getPins:', authError)
      }
      return []
    }
    if (!session?.user) {
      // This is normal when not logged in, don't log as warning
      return []
    }
    const user = session.user

    // Let RLS handle access control - no user_id filter needed
    // Users see their own pins, PEBL admins see all, partners see shared project pins
    let query = this.supabase
      .from('pins')
      .select(`
        *,
        pin_tags!left(tag_id)
      `)

    if (projectId) {
      query = query.eq('project_id', projectId)
    }
    
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    console.log('MapDataService: Raw pins from database:', data.length, 'pins')
    if (data.length > 0) {
      console.log('MapDataService: Sample pin data:', data[0])
    }
    
    return data.map(pin => ({
      id: pin.id,
      lat: pin.lat,
      lng: pin.lng,
      label: pin.label || 'New Pin',  // Provide default if label is null
      labelVisible: pin.label_visible ?? true,
      objectVisible: pin.object_visible ?? true,
      notes: pin.notes || undefined,
      projectId: pin.project_id || undefined,
      tagIds: (pin as any).pin_tags?.map((pt: any) => pt.tag_id) || [],
      // privacyLevel: pin.privacy_level || 'private', // Temporarily removed
      userId: pin.user_id
    }))
  }

  async createPin(pin: Omit<Pin, 'id'>): Promise<Pin> {
    const startTime = Date.now();
    console.log('MapDataService: Creating pin with data:', pin)
    console.log('MapDataService: Enhanced error handling - timestamp:', Date.now())

    // Validate input data
    if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || !pin.label) {
      throw new Error('Invalid pin data: lat, lng, and label are required')
    }
    
    // Get current user ID, fallback to admin for backward compatibility (DB tables now exist)
    const { data: { user }, error: authError } = await this.supabase.auth.getUser()
    
    if (authError) {
      console.error('MapDataService: Authentication error:', authError)
      throw new Error(`Authentication error: Please log in to create pins. ${authError.message}`)
    }
    
    if (!user) {
      console.error('MapDataService: No authenticated user found')
      throw new Error('Please log in to create pins. User authentication is required.')
    }
    
    const userId = user.id
    
    console.log('MapDataService: Authentication status:', {
      isAuthenticated: !!user,
      userId: userId,
      userEmail: user?.email || 'No email'
    })
    console.log('MapDataService: Database connection is working!')

    // Accept project_id as-is (string identifiers like 'milfordhaven')
    const validatedProjectId = pin.projectId || null

    const insertData = {
      lat: pin.lat,
      lng: pin.lng,
      label: pin.label,
      notes: pin.notes || null,
      label_visible: pin.labelVisible ?? true,
      object_visible: pin.objectVisible ?? true,
      project_id: validatedProjectId,
      user_id: userId
      // privacy_level: 'private' // Temporarily removed until DB is updated
    }
    
    console.log('MapDataService: Insert data:', insertData)

    console.log('MapDataService: User ID being used:', userId)
    console.log('MapDataService: Validated project_id:', validatedProjectId)

    const { data, error } = await this.supabase
      .from('pins')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      // Create a comprehensive error log that works across different browser environments
      const errorInfo = {
        message: error.message || 'Unknown error',
        details: error.details || 'No details available',
        hint: error.hint || 'No hint available',
        code: error.code || 'No error code',
        timestamp: new Date().toISOString(),
        insertData: insertData
      }
      
      console.error('MapDataService: Database error creating pin:')
      console.error('Error message:', errorInfo.message)
      console.error('Error details:', errorInfo.details)
      console.error('Error hint:', errorInfo.hint)
      console.error('Error code:', errorInfo.code)
      console.error('Insert data:', errorInfo.insertData)
      console.error('Full error object:', error)
      console.error('Error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
      
      // Track error
      analyticsService.trackError('createPin', error.message, {
        error_code: errorInfo.code,
        error_details: errorInfo.details,
        project_id: insertData.project_id,
      }).catch(err => console.error('Analytics tracking error:', err));

      // Also throw the error with full details visible
      const fullErrorMessage = `Database error creating pin: ${errorInfo.message}. Details: ${errorInfo.details}. Hint: ${errorInfo.hint}. Code: ${errorInfo.code}. Insert data: ${JSON.stringify(errorInfo.insertData)}`
      console.error('MapDataService: Throwing error:', fullErrorMessage)
      throw new Error(fullErrorMessage)
    }

    // Handle tag associations
    if (pin.tagIds && pin.tagIds.length > 0) {
      const tagInserts = pin.tagIds.map(tagId => ({
        pin_id: data.id,
        tag_id: tagId
      }))

      const { error: tagError } = await this.supabase
        .from('pin_tags')
        .insert(tagInserts)

      if (tagError) throw tagError
    }

    // Track successful pin creation
    analyticsService.trackAction('pin_created', 'data_object', {
      project_id: data.project_id,
      has_tags: (pin.tagIds?.length || 0) > 0,
      tag_count: pin.tagIds?.length || 0,
      has_notes: !!pin.notes,
    }, startTime).catch(err => console.error('Analytics tracking error:', err));

    return {
      id: data.id,
      lat: data.lat,
      lng: data.lng,
      label: data.label,
      labelVisible: data.label_visible ?? true,
      notes: data.notes || undefined,
      projectId: data.project_id || undefined,
      tagIds: pin.tagIds || []
    }
  }

  async updatePin(id: string, updates: Partial<Omit<Pin, 'id'>>): Promise<Pin> {
    const startTime = Date.now();
    console.log('MapDataService: updatePin called with:', { id, updates })

    // Get current user to verify access
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      throw new Error('User not authenticated')
    }
    
    console.log('MapDataService: User attempting pin update:', {
      userId: user.id,
      userEmail: user.email,
      pinId: id,
      hasLabel: !!updates.label,
      labelValue: updates.label
    })
    
    // Accept project_id as-is (string identifiers like 'milfordhaven')
    const validatedProjectId = updates.projectId !== undefined ? updates.projectId : undefined
    if (validatedProjectId !== undefined) {
      console.log('MapDataService: Project_id for update:', validatedProjectId)
    }
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    }
    
    // Only include fields that are actually being updated
    if (updates.lat !== undefined) updateData.lat = updates.lat
    if (updates.lng !== undefined) updateData.lng = updates.lng
    if (updates.label !== undefined) updateData.label = updates.label
    if (updates.notes !== undefined) updateData.notes = updates.notes || null
    if (updates.labelVisible !== undefined) updateData.label_visible = updates.labelVisible
    if (updates.objectVisible !== undefined) updateData.object_visible = updates.objectVisible
    if (updates.projectId !== undefined) updateData.project_id = updates.projectId || null
    
    console.log('MapDataService: About to update pin with data:', updateData)
    console.log('MapDataService: Label being saved:', updateData.label)

    const isAdmin = isPeblAdminEmail(user.email)

    // First, verify the pin exists and the user has access to it
    console.log('MapDataService: Checking pin access for:', { id, userId: user.id, isAdmin })

    let accessQuery = this.supabase
      .from('pins')
      .select('*')
      .eq('id', id)

    // Only filter by user_id for non-admin users
    if (!isAdmin) {
      accessQuery = accessQuery.eq('user_id', user.id)
    }

    const { data: existingPin, error: selectError } = await accessQuery.single()

    console.log('MapDataService: Pin access check result:', {
      existingPin,
      selectError,
      hasData: !!existingPin,
      errorCode: selectError?.code,
      errorMessage: selectError?.message
    })

    if (selectError || !existingPin) {
      console.warn('MapDataService: Pin access check failed, proceeding with direct update attempt')
      console.warn('MapDataService: This might be due to RLS policies or the pin might not exist')
      // Don't throw error here, let's try the update and see what happens
    }

    // Now perform the update without .single() to avoid PGRST116
    let updateQuery = this.supabase
      .from('pins')
      .update(updateData)
      .eq('id', id)

    // Only filter by user_id for non-admin users
    if (!isAdmin) {
      updateQuery = updateQuery.eq('user_id', user.id)
    }

    const { data, error, count } = await updateQuery.select()

    console.log('MapDataService: Pin update operation completed:', {
      hasError: !!error,
      dataCount: data?.length || 0,
      totalCount: count,
      updatedData: data?.[0] || null
    })

    if (error) {
      console.error('MapDataService: Pin update error details:')
      console.error('Error message:', error.message || 'No message')
      console.error('Error details:', error.details || 'No details')
      console.error('Error hint:', error.hint || 'No hint')
      console.error('Error code:', error.code || 'No code')
      console.error('Pin ID:', id)
      console.error('Update data:', updateData)
      console.error('Full error object:', error)
      console.error('Error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
      
      const fullErrorMessage = `Pin update failed: ${error.message || 'Unknown error'}. Details: ${error.details || 'None'}. Hint: ${error.hint || 'None'}. Code: ${error.code || 'None'}`
      throw new Error(fullErrorMessage)
    }

    // Check if any rows were actually updated
    if (!data || data.length === 0) {
      console.warn('MapDataService: No rows updated - pin might not exist in database yet')
      console.log('MapDataService: This could be a locally created pin that hasn\'t been synced')
      
      // Try to create the pin instead if it doesn't exist
      console.log('MapDataService: Attempting to create pin since update failed')
      
      // Merge the updates with default values for a new pin
      const newPinData = {
        lat: updates.lat ?? 0,
        lng: updates.lng ?? 0,
        label: updates.label ?? 'New Pin',
        notes: updates.notes,
        labelVisible: updates.labelVisible ?? true,
        projectId: updates.projectId
      }
      
      try {
        // Try to create the pin with the provided ID
        const { data: createdPin, error: createError } = await this.supabase
          .from('pins')
          .insert({
            id: id, // Use the existing ID
            lat: newPinData.lat,
            lng: newPinData.lng,
            label: newPinData.label,
            notes: newPinData.notes || null,
            label_visible: newPinData.labelVisible,
            project_id: updates.projectId || null,
            user_id: user.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single()
        
        if (!createError && createdPin) {
          console.log('MapDataService: Successfully created pin that was missing from database')
          return {
            id: createdPin.id,
            lat: createdPin.lat,
            lng: createdPin.lng,
            label: createdPin.label || 'New Pin',
            labelVisible: createdPin.label_visible ?? true,
            notes: createdPin.notes || undefined,
            projectId: createdPin.project_id || undefined,
            tagIds: []
          }
        }
      } catch (createErr) {
        console.error('MapDataService: Failed to create pin as fallback:', createErr)
      }
      
      // If we have the existing pin data from our earlier check, return it with the updates applied
      if (existingPin) {
        console.log('MapDataService: Using cached pin data as fallback')
        return {
          id: existingPin.id,
          lat: updates.lat !== undefined ? updates.lat : existingPin.lat,
          lng: updates.lng !== undefined ? updates.lng : existingPin.lng,
          label: updates.label !== undefined ? updates.label : existingPin.label,
          labelVisible: updates.labelVisible !== undefined ? updates.labelVisible : (existingPin.label_visible ?? true),
          notes: updates.notes !== undefined ? updates.notes : (existingPin.notes || undefined),
          projectId: updates.projectId !== undefined ? updates.projectId : (existingPin.project_id || undefined),
          tagIds: updates.tagIds || []
        }
      }
      
      // Return a fallback response instead of throwing an error
      console.warn('MapDataService: Pin update couldn\'t be synced to database, but local update succeeded')
      return {
        id: id,
        lat: updates.lat ?? 0,
        lng: updates.lng ?? 0,
        label: updates.label ?? 'New Pin',
        labelVisible: updates.labelVisible ?? true,
        notes: updates.notes,
        projectId: updates.projectId,
        tagIds: updates.tagIds || []
      }
    }
    
    const updatedPin = data[0]
    console.log('MapDataService: Pin updated successfully:', updatedPin)

    // If project_id was updated, cascade the change to associated files
    if (updates.projectId !== undefined) {
      console.log('MapDataService: Cascading project_id update to pin files')
      const { error: fileUpdateError } = await this.supabase
        .from('pin_files')
        .update({ project_id: updates.projectId || null })
        .eq('pin_id', id)

      if (fileUpdateError) {
        console.error('MapDataService: Failed to cascade project_id to files:', fileUpdateError)
        // Don't throw error - pin update succeeded, file update is supplementary
      } else {
        console.log('MapDataService: Successfully cascaded project_id to files')
      }
    }

    // Handle tag updates if provided
    if (updates.tagIds !== undefined) {
      // Delete existing tag associations
      await this.supabase
        .from('pin_tags')
        .delete()
        .eq('pin_id', id)

      // Insert new tag associations
      if (updates.tagIds.length > 0) {
        const tagInserts = updates.tagIds.map(tagId => ({
          pin_id: id,
          tag_id: tagId
        }))

        await this.supabase
          .from('pin_tags')
          .insert(tagInserts)
      }
    }

    // Track successful pin update
    analyticsService.trackAction('pin_updated', 'data_object', {
      pin_id: id,
      project_id: updatedPin.project_id,
      fields_updated: Object.keys(updates),
      has_tag_updates: updates.tagIds !== undefined,
    }, startTime).catch(err => console.error('Analytics tracking error:', err));

    return {
      id: updatedPin.id,
      lat: updatedPin.lat,
      lng: updatedPin.lng,
      label: updatedPin.label,
      labelVisible: updatedPin.label_visible ?? true,
      notes: updatedPin.notes || undefined,
      projectId: updatedPin.project_id || undefined,
      tagIds: updates.tagIds || []
    }
  }

  async deletePin(id: string): Promise<void> {
    const startTime = Date.now();
    // Don't add .eq('user_id', user.id) - RLS policies handle user ownership
    const { error } = await this.supabase
      .from('pins')
      .delete()
      .eq('id', id)

    if (error) {
      analyticsService.trackError('deletePin', error, { pin_id: id }).catch(err => console.error('Analytics tracking error:', err));
      throw error;
    }

    // Track successful deletion
    analyticsService.trackAction('pin_deleted', 'data_object', { pin_id: id }, startTime).catch(err => console.error('Analytics tracking error:', err));
  }

  // Line operations
  // Note: RLS policies handle access control
  async getLines(projectId?: string): Promise<Line[]> {
    // Get current user
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    // Let RLS handle access control - no user_id filter needed
    let query = this.supabase
      .from('lines')
      .select(`
        *,
        line_tags!left(tag_id)
      `)

    if (projectId) {
      query = query.eq('project_id', projectId)
    }
    
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return data.map(line => ({
      id: line.id,
      path: line.path as { lat: number; lng: number }[],
      label: line.label,
      labelVisible: line.label_visible ?? true,
      objectVisible: line.object_visible ?? true,
      notes: line.notes || undefined,
      projectId: line.project_id || undefined,
      tagIds: (line as any).line_tags?.map((lt: any) => lt.tag_id) || [],
      color: line.color || '#10b981',
      size: line.size || 3
    }))
  }

  async createLine(line: Omit<Line, 'id'>): Promise<Line> {
    console.log('MapDataService: Creating line with data:', line)

    // Get current user ID
    const { data: { user } } = await this.supabase.auth.getUser()
    const userId = user?.id || 'admin-shared-data'

    console.log('MapDataService: Using user ID:', userId)
    const insertData = {
      path: line.path,
      label: line.label,
      notes: line.notes || null,
      label_visible: line.labelVisible ?? true,
      object_visible: line.objectVisible ?? true,
      project_id: line.projectId || null,
      user_id: userId,
      color: line.color || '#10b981',
      size: line.size || 3
    }
    console.log('MapDataService: Insert data:', insertData)

    const { data, error } = await this.supabase
      .from('lines')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('MapDataService: Database error details:', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      throw new Error(`Database error: ${error.message || 'Unknown error'}`)
    }

    if (!data) {
      console.error('MapDataService: No data returned from insert')
      throw new Error('No data returned from database insert')
    }

    // Handle tag associations
    if (line.tagIds && line.tagIds.length > 0) {
      const tagInserts = line.tagIds.map(tagId => ({
        line_id: data.id,
        tag_id: tagId
      }))

      const { error: tagError } = await this.supabase
        .from('line_tags')
        .insert(tagInserts)

      if (tagError) throw tagError
    }

    return {
      id: data.id,
      path: data.path as { lat: number; lng: number }[],
      label: data.label,
      labelVisible: data.label_visible ?? true,
      objectVisible: data.object_visible ?? true,
      notes: data.notes || undefined,
      projectId: data.project_id || undefined,
      tagIds: line.tagIds || [],
      color: data.color || '#10b981',
      size: data.size || 3
    }
  }

  async updateLine(id: string, updates: Partial<Omit<Line, 'id'>>): Promise<Line> {
    console.log('🔄 MapDataService.updateLine - ID:', id);
    console.log('🔄 MapDataService.updateLine - Updates:', updates);

    // Get current user to verify access
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      throw new Error('User not authenticated')
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString()
    };

    // Only include fields that are explicitly provided
    if (updates.path !== undefined) updatePayload.path = updates.path;
    if (updates.label !== undefined) updatePayload.label = updates.label;
    if (updates.notes !== undefined) updatePayload.notes = updates.notes || null;
    if (updates.labelVisible !== undefined) updatePayload.label_visible = updates.labelVisible;
    if (updates.objectVisible !== undefined) updatePayload.object_visible = updates.objectVisible;
    if (updates.projectId !== undefined) updatePayload.project_id = updates.projectId || null;

    // These columns might not exist in older database schemas, so we'll try to update them
    // but won't fail if they don't exist
    if (updates.color !== undefined) updatePayload.color = updates.color;
    if (updates.size !== undefined) updatePayload.size = updates.size;

    console.log('🔄 MapDataService.updateLine - Payload being sent:', updatePayload);

    const isAdmin = isPeblAdminEmail(user.email)

    let lineUpdateQuery = this.supabase
      .from('lines')
      .update(updatePayload)
      .eq('id', id)

    // Only filter by user_id for non-admin users
    if (!isAdmin) {
      lineUpdateQuery = lineUpdateQuery.eq('user_id', user.id)
    }

    const { data, error } = await lineUpdateQuery
      .select()

    // Check if no rows were updated (PGRST116 error or empty result)
    if (error?.code === 'PGRST116' || !data || data.length === 0) {
      console.warn('MapDataService: No rows updated - line might not exist in database yet')
      console.log('MapDataService: Attempting to create line since update failed')

      // Try to create the line instead if it doesn't exist
      const newLineData = {
        path: updates.path ?? [],
        label: updates.label ?? 'New Line',
        notes: updates.notes,
        labelVisible: updates.labelVisible ?? true,
        objectVisible: updates.objectVisible ?? true,
        projectId: updates.projectId,
        color: updates.color ?? '#10b981',
        size: updates.size ?? 3
      }

      try {
        // Try to create the line with the provided ID
        const { data: createdLine, error: createError } = await this.supabase
          .from('lines')
          .insert({
            id: id,
            path: newLineData.path,
            label: newLineData.label,
            notes: newLineData.notes || null,
            label_visible: newLineData.labelVisible,
            object_visible: newLineData.objectVisible,
            project_id: newLineData.projectId || null,
            user_id: user.id,
            color: newLineData.color,
            size: newLineData.size,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single()

        if (!createError && createdLine) {
          console.log('MapDataService: Successfully created line that was missing from database')
          return {
            id: createdLine.id,
            path: createdLine.path as { lat: number; lng: number }[],
            label: createdLine.label,
            labelVisible: createdLine.label_visible ?? true,
            objectVisible: createdLine.object_visible ?? true,
            notes: createdLine.notes || undefined,
            projectId: createdLine.project_id || undefined,
            tagIds: updates.tagIds || [],
            color: createdLine.color || '#10b981',
            size: createdLine.size || 3
          }
        }
      } catch (createErr) {
        console.error('MapDataService: Failed to create line as fallback:', createErr)
      }

      // Return a fallback response instead of throwing an error
      console.warn('MapDataService: Line update couldn\'t be synced to database, but local update succeeded')
      return {
        id: id,
        path: updates.path ?? [],
        label: updates.label ?? 'New Line',
        labelVisible: updates.labelVisible ?? true,
        objectVisible: updates.objectVisible ?? true,
        notes: updates.notes,
        projectId: updates.projectId,
        tagIds: updates.tagIds || [],
        color: updates.color ?? '#10b981',
        size: updates.size ?? 3
      }
    }

    // If we got here, update was successful
    const updatedLine = data[0]
    if (!updatedLine) {
      throw new Error('Line update succeeded but no data returned')
    }

    console.log('🔄 MapDataService.updateLine - Success, returned data:', updatedLine);

    // Handle tag updates if provided
    if (updates.tagIds !== undefined) {
      // Delete existing tag associations
      await this.supabase
        .from('line_tags')
        .delete()
        .eq('line_id', id)

      // Insert new tag associations
      if (updates.tagIds.length > 0) {
        const tagInserts = updates.tagIds.map(tagId => ({
          line_id: id,
          tag_id: tagId
        }))

        await this.supabase
          .from('line_tags')
          .insert(tagInserts)
      }
    }

    return {
      id: updatedLine.id,
      path: updatedLine.path as { lat: number; lng: number }[],
      label: updatedLine.label,
      labelVisible: updatedLine.label_visible ?? true,
      objectVisible: updatedLine.object_visible ?? true,
      notes: updatedLine.notes || undefined,
      projectId: updatedLine.project_id || undefined,
      tagIds: updates.tagIds || [],
      color: updatedLine.color || '#10b981',
      size: updatedLine.size || 3
    }
  }

  async deleteLine(id: string): Promise<void> {
    console.log('🗑️ MapDataService.deleteLine - Starting deletion for ID:', id)

    // Get current user to verify ownership
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) {
      console.error('❌ MapDataService.deleteLine - No authenticated user')
      throw new Error('User not authenticated')
    }
    console.log('👤 MapDataService.deleteLine - User ID:', user.id)

    // First, verify the line exists and belongs to the user
    const { data: existingLine, error: checkError } = await this.supabase
      .from('lines')
      .select('id, label, user_id')
      .eq('id', id)
      .single()

    console.log('🔍 MapDataService.deleteLine - Line exists:', !!existingLine)
    console.log('🔍 MapDataService.deleteLine - Line object:', existingLine)
    console.log('🔍 MapDataService.deleteLine - Line user_id:', existingLine?.user_id)
    console.log('🔍 MapDataService.deleteLine - Current user_id:', user.id)
    console.log('🔍 MapDataService.deleteLine - User IDs match?', existingLine?.user_id === user.id)
    console.log('🔍 MapDataService.deleteLine - Check error:', checkError)

    // Don't add .eq('user_id', user.id) - RLS policies handle user ownership
    // Adding it causes 0 rows to be deleted even when user_ids match
    const { data, error, count } = await this.supabase
      .from('lines')
      .delete()
      .eq('id', id)
      .select()

    console.log('🗑️ MapDataService.deleteLine - Deletion result:', {
      success: !error,
      deletedCount: data?.length || 0,
      data: data,
      error: error
    })

    if (error) {
      console.error('❌ MapDataService.deleteLine - Error:', error)
      throw error
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ MapDataService.deleteLine - No rows deleted (line may not exist or wrong user)')
    } else {
      console.log('✅ MapDataService.deleteLine - Successfully deleted line:', data[0])
    }
  }

  // Area operations
  // Note: RLS policies handle access control
  async getAreas(projectId?: string): Promise<Area[]> {
    // Get current user
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    // Let RLS handle access control - no user_id filter needed
    let query = this.supabase
      .from('areas')
      .select(`
        *,
        area_tags!left(tag_id)
      `)

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return data.map(area => ({
      id: area.id,
      path: area.path as { lat: number; lng: number }[],
      label: area.label,
      labelVisible: area.label_visible ?? true,
      objectVisible: area.object_visible ?? true,
      notes: area.notes || undefined,
      fillVisible: area.fill_visible ?? true,
      projectId: area.project_id || undefined,
      tagIds: (area as any).area_tags?.map((at: any) => at.tag_id) || [],
      color: area.color || '#8b5cf6',
      size: area.size || 2,
      transparency: area.transparency || 20
    }))
  }

  async createArea(area: Omit<Area, 'id'>): Promise<Area> {
    console.log('MapDataService: Creating area with data:', area)

    // Get current user ID
    const { data: { user } } = await this.supabase.auth.getUser()
    const userId = user?.id || 'admin-shared-data'

    console.log('MapDataService: Using user ID:', userId)
    const insertData = {
      path: area.path,
      label: area.label,
      notes: area.notes || null,
      label_visible: area.labelVisible ?? true,
      object_visible: area.objectVisible ?? true,
      fill_visible: area.fillVisible ?? true,
      project_id: area.projectId || null,
      user_id: userId,
      color: area.color || '#8b5cf6',
      size: area.size || 2,
      transparency: area.transparency || 20
    }
    console.log('MapDataService: Insert data:', insertData)

    const { data, error } = await this.supabase
      .from('areas')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('MapDataService: Database error details (area):', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      throw new Error(`Database error: ${error.message || 'Unknown error'}`)
    }

    if (!data) {
      console.error('MapDataService: No data returned from area insert')
      throw new Error('No data returned from database insert')
    }

    // Handle tag associations
    if (area.tagIds && area.tagIds.length > 0) {
      const tagInserts = area.tagIds.map(tagId => ({
        area_id: data.id,
        tag_id: tagId
      }))

      const { error: tagError } = await this.supabase
        .from('area_tags')
        .insert(tagInserts)

      if (tagError) throw tagError
    }

    return {
      id: data.id,
      path: data.path as { lat: number; lng: number }[],
      label: data.label,
      labelVisible: data.label_visible ?? true,
      objectVisible: data.object_visible ?? true,
      notes: data.notes || undefined,
      fillVisible: data.fill_visible ?? true,
      projectId: data.project_id || undefined,
      tagIds: area.tagIds || [],
      color: data.color || '#8b5cf6',
      size: data.size || 2,
      transparency: data.transparency || 20
    }
  }

  async updateArea(id: string, updates: Partial<Omit<Area, 'id'>>): Promise<Area> {
    const updatePayload: any = {
      updated_at: new Date().toISOString()
    };

    // Only include fields that are explicitly provided
    if (updates.path !== undefined) updatePayload.path = updates.path;
    if (updates.label !== undefined) updatePayload.label = updates.label;
    if (updates.notes !== undefined) updatePayload.notes = updates.notes || null;
    if (updates.labelVisible !== undefined) updatePayload.label_visible = updates.labelVisible;
    if (updates.objectVisible !== undefined) updatePayload.object_visible = updates.objectVisible;
    if (updates.fillVisible !== undefined) updatePayload.fill_visible = updates.fillVisible;
    if (updates.projectId !== undefined) updatePayload.project_id = updates.projectId || null;

    // These columns might not exist in older database schemas, so we'll try to update them
    // but won't fail if they don't exist
    if (updates.color !== undefined) updatePayload.color = updates.color;
    if (updates.size !== undefined) updatePayload.size = updates.size;
    if (updates.transparency !== undefined) updatePayload.transparency = updates.transparency;

    console.log('[MapDataService] Updating area with payload:', updatePayload);

    const { data, error } = await this.supabase
      .from('areas')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('MapDataService: Database error details (area):', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        fullError: error
      });
      throw new Error(`Failed to update area: ${error.message || 'Unknown error'}`);
    }

    if (!data) {
      throw new Error('No data returned from update operation');
    }

    // If project_id was updated, cascade the change to associated files
    if (updates.projectId !== undefined) {
      console.log('MapDataService: Cascading project_id update to area files')
      const { error: fileUpdateError } = await this.supabase
        .from('pin_files')
        .update({ project_id: updates.projectId || null })
        .eq('area_id', id)

      if (fileUpdateError) {
        console.error('MapDataService: Failed to cascade project_id to files:', fileUpdateError)
        // Don't throw error - area update succeeded, file update is supplementary
      } else {
        console.log('MapDataService: Successfully cascaded project_id to area files')
      }
    }

    // Handle tag updates if provided
    if (updates.tagIds !== undefined) {
      // Delete existing tag associations
      await this.supabase
        .from('area_tags')
        .delete()
        .eq('area_id', id)

      // Insert new tag associations
      if (updates.tagIds.length > 0) {
        const tagInserts = updates.tagIds.map(tagId => ({
          area_id: id,
          tag_id: tagId
        }))

        await this.supabase
          .from('area_tags')
          .insert(tagInserts)
      }
    }

    return {
      id: data.id,
      path: data.path as { lat: number; lng: number }[],
      label: data.label,
      labelVisible: data.label_visible ?? true,
      objectVisible: data.object_visible ?? true,
      notes: data.notes || undefined,
      fillVisible: data.fill_visible ?? true,
      projectId: data.project_id || undefined,
      tagIds: updates.tagIds || [],
      color: data.color || '#8b5cf6',
      size: data.size || 2,
      transparency: data.transparency || 20
    }
  }

  async deleteArea(id: string): Promise<void> {
    console.log('🗑️ MapDataService.deleteArea - Starting deletion for ID:', id)

    // Don't add .eq('user_id', user.id) - RLS policies handle user ownership
    const { data, error } = await this.supabase
      .from('areas')
      .delete()
      .eq('id', id)
      .select()

    console.log('🗑️ MapDataService.deleteArea - Deletion result:', {
      success: !error,
      deletedCount: data?.length || 0,
      data: data,
      error: error
    })

    if (error) {
      console.error('❌ MapDataService.deleteArea - Error:', error)
      throw error
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ MapDataService.deleteArea - No rows deleted (area may not exist or wrong user)')
    } else {
      console.log('✅ MapDataService.deleteArea - Successfully deleted area:', data[0])
    }
  }

  // Batch update operations for performance
  async batchUpdatePins(pinIds: string[], updates: Partial<Omit<Pin, 'id'>>): Promise<void> {
    if (pinIds.length === 0) return

    const updateData: any = { updated_at: new Date().toISOString() }
    if (updates.labelVisible !== undefined) updateData.label_visible = updates.labelVisible
    if (updates.objectVisible !== undefined) updateData.object_visible = updates.objectVisible

    const { error } = await this.supabase
      .from('pins')
      .update(updateData)
      .in('id', pinIds)

    if (error) throw error
  }

  async batchUpdateLines(lineIds: string[], updates: Partial<Omit<Line, 'id'>>): Promise<void> {
    if (lineIds.length === 0) return

    const updateData: any = { updated_at: new Date().toISOString() }
    if (updates.labelVisible !== undefined) updateData.label_visible = updates.labelVisible
    if (updates.objectVisible !== undefined) updateData.object_visible = updates.objectVisible

    const { error } = await this.supabase
      .from('lines')
      .update(updateData)
      .in('id', lineIds)

    if (error) throw error
  }

  async batchUpdateAreas(areaIds: string[], updates: Partial<Omit<Area, 'id'>>): Promise<void> {
    if (areaIds.length === 0) return

    const updateData: any = { updated_at: new Date().toISOString() }
    if (updates.labelVisible !== undefined) updateData.label_visible = updates.labelVisible
    if (updates.objectVisible !== undefined) updateData.object_visible = updates.objectVisible

    const { error } = await this.supabase
      .from('areas')
      .update(updateData)
      .in('id', areaIds)

    if (error) throw error
  }

  // Privacy and sharing operations
  async updatePinPrivacy(pinId: string, privacyLevel: 'private' | 'public' | 'specific', sharedEmails?: string[]): Promise<void> {
    // Update the pin's privacy level
    const { error: pinError } = await this.supabase
      .from('pins')
      .update({ 
        privacy_level: privacyLevel,
        updated_at: new Date().toISOString()
      })
      .eq('id', pinId)

    if (pinError) throw pinError

    // If sharing with specific users, handle sharing
    if (privacyLevel === 'specific' && sharedEmails && sharedEmails.length > 0) {
      // Get current user
      const { data: { user } } = await this.supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Clear existing shares for this pin
      await this.supabase
        .from('pin_shares')
        .delete()
        .eq('pin_id', pinId)

      // Look up user IDs by email
      for (const email of sharedEmails) {
        const { data: profiles } = await this.supabase
          .from('user_profiles')
          .select('id')
          .eq('email', email.trim())
          .single()

        if (profiles) {
          // Create share record
          await this.supabase
            .from('pin_shares')
            .insert({
              pin_id: pinId,
              shared_with_user_id: profiles.id,
              shared_by_user_id: user.id
            })
        }
      }
    } else if (privacyLevel !== 'specific') {
      // Clear all shares if not specific sharing
      await this.supabase
        .from('pin_shares')
        .delete()
        .eq('pin_id', pinId)
    }
  }

  // Get user notifications
  async getNotifications(): Promise<any[]> {
    const { data: { user } } = await this.supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('read', false)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  }

  // Mark notification as read
  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    if (error) throw error
  }

  // Bulk operations
  async migrateFromLocalStorage(localData: {
    pins: Pin[]
    lines: Line[]
    areas: Area[]
  }): Promise<void> {
    const { data: user } = await this.supabase.auth.getUser()
    if (!user.user) throw new Error('User not authenticated')

    // Create pins
    for (const pin of localData.pins) {
      await this.createPin(pin)
    }

    // Create lines
    for (const line of localData.lines) {
      await this.createLine(line)
    }

    // Create areas
    for (const area of localData.areas) {
      await this.createArea(area)
    }
  }
}

// Export a singleton instance
export const mapDataService = new MapDataService()