import { createClient } from './client'
import { v4 as uuidv4 } from 'uuid'
import type { TileName } from '@/lib/file-categorization-config'

// Types
export interface Methodology {
  id: string
  projectId: string
  tileName: TileName
  contentHtml: string | null
  contentJson: Record<string, unknown> | null
  isPublished: boolean
  userId: string
  createdAt: Date
  updatedAt: Date
}

export interface MethodologyAttachment {
  id: string
  methodologyId: string
  fileName: string
  filePath: string
  fileSize: number
  caption: string | null
  displayOrder: number
  uploadedAt: Date
}

export interface SaveMethodologyParams {
  projectId: string
  tileName: TileName
  contentHtml: string | null
  contentJson: Record<string, unknown> | null
}

class MethodologyService {
  private supabase = createClient()

  /**
   * Get methodology for a specific project and tile
   */
  async getMethodology(projectId: string, tileName: TileName): Promise<Methodology | null> {
    try {
      console.log('[MethodologyService] Getting methodology for:', { projectId, tileName })

      const { data, error } = await this.supabase
        .from('tile_methodology')
        .select('*')
        .eq('project_id', projectId)
        .eq('tile_name', tileName)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - methodology doesn't exist yet
          console.log('[MethodologyService] No methodology found (this is normal for new tiles)')
          return null
        }
        console.error('[MethodologyService] Error fetching methodology:', error.message, error.code, error)
        return null
      }

      console.log('[MethodologyService] Found methodology:', data?.id)
      return this.transformMethodology(data)
    } catch (error) {
      console.error('[MethodologyService] Get methodology exception:', error)
      return null
    }
  }

  /**
   * Save (create or update) methodology
   */
  async saveMethodology(params: SaveMethodologyParams): Promise<{ success: boolean; data?: Methodology; error?: string }> {
    try {
      console.log('[MethodologyService] Saving methodology:', params)

      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        console.error('[MethodologyService] Auth error:', authError)
        return { success: false, error: 'Authentication required' }
      }

      // Check if methodology already exists
      console.log('[MethodologyService] Checking for existing methodology...')
      const { data: existing, error: existingError } = await this.supabase
        .from('tile_methodology')
        .select('id, user_id')
        .eq('project_id', params.projectId)
        .eq('tile_name', params.tileName)
        .single()

      // Ignore PGRST116 (no rows) - that just means we need to create new
      if (existingError && existingError.code !== 'PGRST116') {
        console.error('[MethodologyService] Error checking existing:', existingError)
      }

      if (existing) {
        console.log('[MethodologyService] Found existing methodology, updating:', existing.id)
        // Update existing
        if (existing.user_id !== user.id) {
          return { success: false, error: 'Only the owner can edit methodology' }
        }

        const { data, error } = await this.supabase
          .from('tile_methodology')
          .update({
            content_html: params.contentHtml,
            content_json: params.contentJson,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) {
          console.error('[MethodologyService] Update methodology error:', error)
          return { success: false, error: error.message }
        }

        console.log('[MethodologyService] Successfully updated methodology')
        return { success: true, data: this.transformMethodology(data) }
      } else {
        // Create new
        console.log('[MethodologyService] Creating new methodology for user:', user.id)
        const { data, error } = await this.supabase
          .from('tile_methodology')
          .insert({
            project_id: params.projectId,
            tile_name: params.tileName,
            content_html: params.contentHtml,
            content_json: params.contentJson,
            user_id: user.id,
            is_published: false
          })
          .select()
          .single()

        if (error) {
          console.error('[MethodologyService] Create methodology error:', error.message, error.code, error)
          return { success: false, error: error.message }
        }

        console.log('[MethodologyService] Successfully created methodology:', data?.id)
        return { success: true, data: this.transformMethodology(data) }
      }
    } catch (error) {
      console.error('[MethodologyService] Save methodology exception:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Publish methodology (make visible to viewers)
   */
  async publishMethodology(methodologyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return { success: false, error: 'Authentication required' }
      }

      const { error } = await this.supabase
        .from('tile_methodology')
        .update({ is_published: true, updated_at: new Date().toISOString() })
        .eq('id', methodologyId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Publish methodology error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Publish methodology error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Unpublish methodology (hide from viewers)
   */
  async unpublishMethodology(methodologyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return { success: false, error: 'Authentication required' }
      }

      const { error } = await this.supabase
        .from('tile_methodology')
        .update({ is_published: false, updated_at: new Date().toISOString() })
        .eq('id', methodologyId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Unpublish methodology error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Unpublish methodology error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Get attachments for a methodology
   */
  async getAttachments(methodologyId: string): Promise<MethodologyAttachment[]> {
    try {
      const { data, error } = await this.supabase
        .from('methodology_attachments')
        .select('*')
        .eq('methodology_id', methodologyId)
        .order('display_order', { ascending: true })

      if (error) {
        console.error('Get attachments error:', error)
        return []
      }

      return (data || []).map(this.transformAttachment)
    } catch (error) {
      console.error('Get attachments error:', error)
      return []
    }
  }

  /**
   * Upload a PDF attachment
   */
  async uploadAttachment(
    methodologyId: string,
    file: File,
    caption?: string
  ): Promise<{ success: boolean; data?: MethodologyAttachment; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return { success: false, error: 'Authentication required' }
      }

      // Verify user owns the methodology
      const { data: methodology, error: methError } = await this.supabase
        .from('tile_methodology')
        .select('id, project_id, tile_name, user_id')
        .eq('id', methodologyId)
        .single()

      if (methError || !methodology) {
        return { success: false, error: 'Methodology not found' }
      }

      if (methodology.user_id !== user.id) {
        return { success: false, error: 'Only the owner can upload attachments' }
      }

      // Validate file type
      if (file.type !== 'application/pdf') {
        return { success: false, error: 'Only PDF files are allowed' }
      }

      // Generate unique file path
      const fileId = uuidv4()
      const filePath = `${methodology.project_id}/${methodology.tile_name}/${fileId}.pdf`

      // Upload file to storage
      const { error: uploadError } = await this.supabase.storage
        .from('methodology-files')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Upload attachment error:', uploadError)
        return { success: false, error: uploadError.message }
      }

      // Get the highest display order
      const { data: maxOrderData } = await this.supabase
        .from('methodology_attachments')
        .select('display_order')
        .eq('methodology_id', methodologyId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single()

      const displayOrder = (maxOrderData?.display_order ?? -1) + 1

      // Save attachment metadata
      const { data, error: dbError } = await this.supabase
        .from('methodology_attachments')
        .insert({
          methodology_id: methodologyId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          caption: caption || null,
          display_order: displayOrder
        })
        .select()
        .single()

      if (dbError) {
        // Clean up uploaded file
        await this.supabase.storage.from('methodology-files').remove([filePath])
        console.error('Save attachment metadata error:', dbError)
        return { success: false, error: dbError.message }
      }

      return { success: true, data: this.transformAttachment(data) }
    } catch (error) {
      console.error('Upload attachment error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Update attachment caption
   */
  async updateCaption(attachmentId: string, caption: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return { success: false, error: 'Authentication required' }
      }

      // Verify user owns the methodology through attachment
      const { data: attachment } = await this.supabase
        .from('methodology_attachments')
        .select(`
          id,
          methodology:tile_methodology!methodology_id(user_id)
        `)
        .eq('id', attachmentId)
        .single()

      if (!attachment || (attachment.methodology as any)?.user_id !== user.id) {
        return { success: false, error: 'Only the owner can update attachments' }
      }

      const { error } = await this.supabase
        .from('methodology_attachments')
        .update({ caption })
        .eq('id', attachmentId)

      if (error) {
        console.error('Update caption error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Update caption error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(attachmentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return { success: false, error: 'Authentication required' }
      }

      // Get attachment details including methodology ownership
      const { data: attachment } = await this.supabase
        .from('methodology_attachments')
        .select(`
          id,
          file_path,
          methodology:tile_methodology!methodology_id(user_id)
        `)
        .eq('id', attachmentId)
        .single()

      if (!attachment) {
        return { success: false, error: 'Attachment not found' }
      }

      if ((attachment.methodology as any)?.user_id !== user.id) {
        return { success: false, error: 'Only the owner can delete attachments' }
      }

      // Delete from storage
      const { error: storageError } = await this.supabase.storage
        .from('methodology-files')
        .remove([attachment.file_path])

      if (storageError) {
        console.warn('Storage delete warning:', storageError)
        // Continue with database deletion even if storage fails
      }

      // Delete from database
      const { error: dbError } = await this.supabase
        .from('methodology_attachments')
        .delete()
        .eq('id', attachmentId)

      if (dbError) {
        console.error('Delete attachment error:', dbError)
        return { success: false, error: dbError.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Delete attachment error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Download an attachment
   */
  async downloadAttachment(filePath: string): Promise<Blob | null> {
    try {
      const { data, error } = await this.supabase.storage
        .from('methodology-files')
        .download(filePath)

      if (error) {
        console.error('Download attachment error:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Download attachment error:', error)
      return null
    }
  }

  /**
   * Check if user can edit methodology for a project
   * Returns true if user owns the project (owns any pin with that project_id)
   */
  async canUserEdit(projectId: string): Promise<boolean> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        return false
      }

      // Check if user owns any pin in this project
      const { data: pins, error: pinError } = await this.supabase
        .from('pins')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .limit(1)

      if (pinError) {
        console.error('Check ownership error:', pinError)
        return false
      }

      return (pins?.length ?? 0) > 0
    } catch (error) {
      console.error('Check ownership error:', error)
      return false
    }
  }

  /**
   * Get current user ID
   */
  async getCurrentUserId(): Promise<string | null> {
    try {
      const { data: { user } } = await this.supabase.auth.getUser()
      return user?.id ?? null
    } catch {
      return null
    }
  }

  // Transform database row to Methodology type
  private transformMethodology(row: any): Methodology {
    return {
      id: row.id,
      projectId: row.project_id,
      tileName: row.tile_name,
      contentHtml: row.content_html,
      contentJson: row.content_json,
      isPublished: row.is_published,
      userId: row.user_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }
  }

  // Transform database row to MethodologyAttachment type
  private transformAttachment(row: any): MethodologyAttachment {
    return {
      id: row.id,
      methodologyId: row.methodology_id,
      fileName: row.file_name,
      filePath: row.file_path,
      fileSize: row.file_size,
      caption: row.caption,
      displayOrder: row.display_order,
      uploadedAt: new Date(row.uploaded_at)
    }
  }
}

export const methodologyService = new MethodologyService()
