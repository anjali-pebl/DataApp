import { createClient } from './client'
import { v4 as uuidv4 } from 'uuid'
import { perfLogger } from '../perf-logger'
import { analyticsService } from '@/lib/analytics/analytics-service'
import { isPeblAdminEmail } from './role-service'

// Upload target: either a pin or an area
export type UploadTarget =
  | { type: 'pin'; id: string }
  | { type: 'area'; id: string };

export interface PinFile {
  id: string
  pinId?: string  // Now optional (for area files)
  areaId?: string  // NEW: Area reference
  fileName: string
  filePath: string
  fileSize: number
  fileType: string
  uploadedAt: Date
  projectId: string
  startDate?: Date
  endDate?: Date
  isDiscrete?: boolean
  uniqueDates?: string[]
}

class FileStorageService {
  private supabase = createClient()

  /**
   * Upload a file to Supabase Storage and save metadata to database
   * @param target - Upload target (pin or area)
   * @param file - File to upload
   * @param projectId - Project ID
   */
  async uploadFile(
    target: UploadTarget,
    file: File,
    projectId: string = 'default'
  ): Promise<PinFile | null> {
    const startTime = Date.now();
    try {
      // Get current user and verify authentication
      console.log('🔐 Checking authentication for file upload...');
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        console.error('❌ Authentication required to upload files:', authError)
        return null
      }
      console.log(`✅ Authenticated as user: ${user.id}`);

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify ownership based on target type (admins can upload to any target)
      if (target.type === 'pin') {
        console.log(`🔍 Verifying access to pin ${target.id}...`);
        let pinQuery = this.supabase
          .from('pins')
          .select('id, user_id')
          .eq('id', target.id)

        if (!isAdmin) {
          pinQuery = pinQuery.eq('user_id', user.id)
        }

        const { data: pinData, error: pinError } = await pinQuery.single()

        if (pinError || !pinData) {
          console.log('⚠️ Pin not accessible for upload:', {
            pinId: target.id,
            userId: user.id,
            error: pinError?.message || 'Pin not found or upload access denied'
          })
          return null
        }
        console.log('✅ Pin access verified');
      } else {
        console.log(`🔍 Verifying access to area ${target.id}...`);
        let areaQuery = this.supabase
          .from('areas')
          .select('id, user_id')
          .eq('id', target.id)

        if (!isAdmin) {
          areaQuery = areaQuery.eq('user_id', user.id)
        }

        const { data: areaData, error: areaError } = await areaQuery.single()

        if (areaError || !areaData) {
          console.log('⚠️ Area not accessible for upload:', {
            areaId: target.id,
            userId: user.id,
            error: areaError?.message || 'Area not found or upload access denied'
          })
          return null
        }
        console.log('✅ Area access verified');
      }

      // Generate unique file path based on target type
      const fileId = uuidv4()
      const fileExtension = file.name.split('.').pop()
      const filePath = `${target.type}s/${target.id}/${fileId}.${fileExtension}`

      // Upload file to Supabase Storage
      console.log(`📤 Uploading file to storage: ${filePath}`);
      console.log(`   File size: ${(file.size / 1024).toFixed(2)} KB`);
      console.log(`   File type: ${file.type || 'text/csv'}`);
      
      const { data: uploadData, error: uploadError } = await this.supabase.storage
        .from('pin-files')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('❌ File upload error:', uploadError)
        console.error('Error details:', {
          message: uploadError.message,
          statusCode: uploadError.statusCode,
          error: uploadError.error,
          bucket: 'pin-files',
          path: filePath,
          fileSize: file.size,
          fileName: file.name
        });
        
        // Check for specific error types
        if (uploadError.message?.includes('row-level security')) {
          console.error('🔒 RLS Policy Error: Check Supabase storage policies');
        } else if (uploadError.message?.includes('size')) {
          console.error('📏 File Size Error: File may be too large');
        } else if (uploadError.statusCode === 403) {
          console.error('🚫 Permission Error: Check bucket permissions');
        }
        
        return null
      }
      
      console.log('✅ Upload data:', uploadData);
      console.log('✅ File uploaded to storage successfully');

      // Save file metadata to database (using snake_case column names)
      const fileData = {
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || 'text/csv',
        project_id: projectId,
        ...(target.type === 'pin'
          ? { pin_id: target.id, area_id: null }
          : { pin_id: null, area_id: target.id }
        )
      }

      console.log('💾 Inserting file metadata to database:', fileData);

      const { data, error: dbError } = await this.supabase
        .from('pin_files')
        .insert(fileData)
        .select()
        .single()

      if (dbError) {
        console.error('❌ Database error:', dbError)
        console.error('Table: pin_files, Data:', fileData);
        // Clean up uploaded file if database save fails
        console.log('🧹 Cleaning up uploaded file due to database error...');
        await this.supabase.storage
          .from('pin-files')
          .remove([filePath])
        return null
      }

      console.log('✅ Database insert successful:', data);

      // Track successful file upload
      analyticsService.trackAction('file_uploaded', 'file', {
        file_size: file.size,
        file_type: file.type || 'text/csv',
        file_name: file.name,
        target_type: target.type,
        target_id: target.id,
        project_id: projectId,
      }, startTime).catch(err => console.error('Analytics tracking error:', err));

      // Transform snake_case to camelCase for return
      return {
        id: data.id,
        pinId: data.pin_id,
        areaId: data.area_id,
        fileName: data.file_name,
        filePath: data.file_path,
        fileSize: data.file_size,
        fileType: data.file_type,
        projectId: data.project_id,
        uploadedAt: new Date(data.uploaded_at)
      } as PinFile

    } catch (error) {
      console.error('Upload file error:', error)
      // Track upload error
      analyticsService.trackError('uploadFile', error as Error, {
        file_size: file.size,
        file_name: file.name,
        target_type: target.type,
      }).catch(err => console.error('Analytics tracking error:', err));
      return null
    }
  }

  /**
   * Upload a file to a pin (backwards compatibility wrapper)
   * @deprecated Use uploadFile with target parameter instead
   */
  async uploadPinFile(
    pinId: string,
    file: File,
    projectId: string = 'default'
  ): Promise<PinFile | null> {
    return this.uploadFile({ type: 'pin', id: pinId }, file, projectId);
  }

  /**
   * Upload a file to an area
   */
  async uploadAreaFile(
    areaId: string,
    file: File,
    projectId: string = 'default'
  ): Promise<PinFile | null> {
    return this.uploadFile({ type: 'area', id: areaId }, file, projectId);
  }

  /**
   * Get all files for a specific pin (with user authentication check)
   */
  async getPinFiles(pinId: string): Promise<PinFile[]> {
    perfLogger.start(`getPinFiles-${pinId.slice(0, 8)}`);

    try {
      // Get current user to ensure they have access to this pin
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        perfLogger.warn(`Auth required for pin ${pinId.slice(0, 8)}`);
        return []
      }

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify that the user has access to the pin (admins can access any pin)
      let pinAccessQuery = this.supabase
        .from('pins')
        .select('id, user_id')
        .eq('id', pinId)

      if (!isAdmin) {
        pinAccessQuery = pinAccessQuery.eq('user_id', user.id)
      }

      const { data: pinData, error: pinError } = await pinAccessQuery.single()

      if (pinError || !pinData) {
        perfLogger.warn(`Pin ${pinId.slice(0, 8)} not accessible`);
        return []
      }

      // Now get the files - RLS policies will handle additional filtering
      const { data, error } = await this.supabase
        .from('pin_files')
        .select('*')
        .eq('pin_id', pinId)  // Use snake_case column name
        .order('uploaded_at', { ascending: false })  // Use snake_case column name

      if (error) {
        perfLogger.error(`Get pin files error for ${pinId.slice(0, 8)}`, error);
        return []
      }

      perfLogger.end(`getPinFiles-${pinId.slice(0, 8)}`, `${data?.length || 0} files`);

      // Transform snake_case to camelCase for return
      return (data || []).map(item => ({
        id: item.id,
        pinId: item.pin_id,
        areaId: item.area_id,
        fileName: item.file_name,
        filePath: item.file_path,
        fileSize: item.file_size,
        fileType: item.file_type,
        projectId: item.project_id,
        uploadedAt: new Date(item.uploaded_at),
        startDate: item.start_date ? new Date(item.start_date) : undefined,
        endDate: item.end_date ? new Date(item.end_date) : undefined,
        isDiscrete: item.is_discrete || false,
        uniqueDates: item.unique_dates || undefined
      }))
    } catch (error) {
      perfLogger.error(`Get pin files exception for ${pinId.slice(0, 8)}`, error);
      return []
    }
  }

  /**
   * Get all files for a specific area (with user authentication check)
   */
  async getAreaFiles(areaId: string): Promise<PinFile[]> {
    perfLogger.start(`getAreaFiles-${areaId.slice(0, 8)}`);

    try {
      // Get current user to ensure they have access to this area
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        perfLogger.warn(`Auth required for area ${areaId.slice(0, 8)}`);
        return []
      }

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify that the user has access to the area (admins can access any area)
      let areaAccessQuery = this.supabase
        .from('areas')
        .select('id, user_id')
        .eq('id', areaId)

      if (!isAdmin) {
        areaAccessQuery = areaAccessQuery.eq('user_id', user.id)
      }

      const { data: areaData, error: areaError } = await areaAccessQuery.single()

      if (areaError || !areaData) {
        perfLogger.warn(`Area ${areaId.slice(0, 8)} not accessible`);
        return []
      }

      // Now get the files - RLS policies will handle additional filtering
      const { data, error } = await this.supabase
        .from('pin_files')
        .select('*')
        .eq('area_id', areaId)
        .order('uploaded_at', { ascending: false })

      if (error) {
        perfLogger.error(`Get area files error for ${areaId.slice(0, 8)}`, error);
        return []
      }

      perfLogger.end(`getAreaFiles-${areaId.slice(0, 8)}`, `${data?.length || 0} files`);

      // Transform snake_case to camelCase for return
      return (data || []).map(item => ({
        id: item.id,
        pinId: item.pin_id,
        areaId: item.area_id,
        fileName: item.file_name,
        filePath: item.file_path,
        fileSize: item.file_size,
        fileType: item.file_type,
        projectId: item.project_id,
        uploadedAt: new Date(item.uploaded_at),
        startDate: item.start_date ? new Date(item.start_date) : undefined,
        endDate: item.end_date ? new Date(item.end_date) : undefined,
        isDiscrete: item.is_discrete || false,
        uniqueDates: item.unique_dates || undefined
      }))
    } catch (error) {
      perfLogger.error(`Get area files exception for ${areaId.slice(0, 8)}`, error);
      return []
    }
  }

  /**
   * Download a file from Supabase Storage by file path
   * Uses signed URL with cache-busting to ensure fresh content after edits
   */
  async downloadFile(filePath: string): Promise<Blob | null> {
    try {
      // Create signed URL with cache-busting timestamp
      const { data: urlData, error: urlError } = await this.supabase.storage
        .from('pin-files')
        .createSignedUrl(filePath, 60); // 60 second expiry

      if (urlError || !urlData?.signedUrl) {
        console.error('Failed to create signed URL:', urlError);
        return null;
      }

      // Add cache-buster to bypass CDN/browser cache
      const cacheBustedUrl = urlData.signedUrl + '&_cb=' + Date.now();

      const response = await fetch(cacheBustedUrl, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!response.ok) {
        console.error('Download file error: HTTP', response.status);
        return null;
      }

      return await response.blob();
    } catch (error) {
      console.error('Download file error:', error)
      return null
    }
  }

  /**
   * Download a file from Supabase Storage by file ID
   * First queries the database to get the file path, then downloads
   * Checks both pin_files and merged_files tables
   */
  async downloadFileById(fileId: string): Promise<{ success: boolean; data?: { blob: Blob; fileName: string }; error?: string }> {
    try {
      console.log('📥 Downloading file by ID:', fileId);

      let fileData: { file_path: string; file_name: string; updated_at?: string } | null = null;

      // First, try to get file metadata from pin_files (including updated_at for cache busting)
      const { data: pinFileData, error: pinFileError } = await this.supabase
        .from('pin_files')
        .select('file_path, file_name, updated_at')
        .eq('id', fileId)
        .single();

      if (pinFileData) {
        fileData = pinFileData;
        console.log('📄 File found in pin_files table');
      } else {
        console.log('📄 File not in pin_files, checking merged_files table...');

        // If not found in pin_files, try merged_files
        const { data: mergedFileData, error: mergedFileError } = await this.supabase
          .from('merged_files')
          .select('file_path, file_name')
          .eq('id', fileId)
          .single();

        if (mergedFileData) {
          fileData = mergedFileData;
          console.log('📄 File found in merged_files table');
        } else {
          console.error('❌ File not found in either pin_files or merged_files:', { pinFileError, mergedFileError });
          return { success: false, error: 'File not found in database' };
        }
      }

      console.log('📄 File metadata:', { filePath: fileData.file_path, fileName: fileData.file_name, updatedAt: fileData.updated_at });

      // Create signed URL with cache-busting to ensure fresh content after edits
      const { data: urlData, error: urlError } = await this.supabase.storage
        .from('pin-files')
        .createSignedUrl(fileData.file_path, 60); // 60 second expiry

      if (urlError || !urlData?.signedUrl) {
        console.error('❌ Failed to create signed URL:', urlError);
        return { success: false, error: urlError?.message || 'Failed to create download URL' };
      }

      // Add cache-buster using updated_at timestamp or current time
      const cacheBuster = fileData.updated_at
        ? new Date(fileData.updated_at).getTime()
        : Date.now();
      const cacheBustedUrl = urlData.signedUrl + '&_cb=' + cacheBuster;
      console.log(`📌 Cache-busting with timestamp: ${cacheBuster}`);

      // Fetch with no-cache headers
      const response = await fetch(cacheBustedUrl, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!response.ok) {
        console.error('❌ Download error: HTTP', response.status);
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const blob = await response.blob();
      console.log('✅ File downloaded successfully, size:', blob.size, 'bytes');
      return { success: true, data: { blob, fileName: fileData.file_name } };

    } catch (error) {
      console.error('❌ Download file by ID error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Alias for downloadFile for clarity when downloading pin files
   */
  async downloadPinFile(filePath: string): Promise<Blob | null> {
    return this.downloadFile(filePath)
  }

  /**
   * Delete a file from storage and database (with user authentication check)
   */
  async deleteFile(fileId: string): Promise<boolean> {
    try {
      console.log('Starting file deletion for ID:', fileId)
      
      // Get current user to ensure they have access
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      
      if (authError || !user) {
        console.error('Authentication required to delete pin files:', authError)
        return false
      }
      
      console.log('Authenticated user:', user.id)

      // Get file metadata first
      const { data: fileData, error: getError } = await this.supabase
        .from('pin_files')
        .select('file_path, pin_id')
        .eq('id', fileId)
        .single()

      if (getError || !fileData) {
        console.error('Get file data error:', getError)
        console.error('File ID:', fileId)
        return false
      }
      
      console.log('File data retrieved:', fileData)

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify user has access to the pin (admins can delete any file)
      const { data: pinData, error: pinError } = await this.supabase
        .from('pins')
        .select('user_id')
        .eq('id', fileData.pin_id)
        .single()

      if (pinError || !pinData) {
        console.error('Get pin data error:', pinError)
        return false
      }

      // Check if user owns the pin associated with this file (admins bypass)
      if (!isAdmin && pinData.user_id !== user.id) {
        console.error('User does not have permission to delete this file')
        console.error('File owner:', pinData.user_id, 'Current user:', user.id)
        return false
      }

      // Try to delete from storage first (it's okay if it fails - file might not exist)
      console.log('Deleting from storage:', fileData.file_path)
      const { error: storageError } = await this.supabase.storage
        .from('pin-files')
        .remove([fileData.file_path])

      if (storageError) {
        console.warn('Storage delete warning (continuing anyway):', storageError)
        // Continue with database deletion even if storage fails
      } else {
        console.log('Storage deletion successful')
      }

      // Delete from database - this is the critical part
      console.log('Deleting from database, file ID:', fileId)
      const { data: deleteResult, error: dbError } = await this.supabase
        .from('pin_files')
        .delete()
        .eq('id', fileId)
        .eq('pin_id', fileData.pin_id) // Add extra safety check
        .select() // Return deleted rows to confirm

      if (dbError) {
        console.error('Database delete error:', dbError)
        console.error('Error details:', {
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          hint: dbError.hint
        })
        return false
      }
      
      console.log('Database deletion result:', deleteResult)
      
      if (!deleteResult || deleteResult.length === 0) {
        console.error('No rows were deleted - file may not exist or RLS policy blocking')
        return false
      }
      
      console.log('Database deletion successful')

      return true
    } catch (error) {
      console.error('Delete file error:', error)
      return false
    }
  }

  /**
   * Rename a file - updates only the file_name in database
   */
  async renameFile(fileId: string, newFileName: string): Promise<boolean> {
    try {
      console.log('🔄 Starting file rename:', { fileId, newFileName });

      // Get current user to ensure they have access
      const { data: { user }, error: authError } = await this.supabase.auth.getUser();

      if (authError || !user) {
        console.error('❌ Authentication required to rename files:', authError);
        return false;
      }

      console.log(`✅ Authenticated as user: ${user.id}`);

      // Get file metadata to verify ownership (including both pin_id and area_id)
      const { data: fileData, error: getError } = await this.supabase
        .from('pin_files')
        .select('pin_id, area_id, file_name')
        .eq('id', fileId)
        .single();

      if (getError || !fileData) {
        console.error('❌ Get file data error:', getError);
        return false;
      }

      console.log('📄 Current file name:', fileData.file_name);
      console.log('📍 File associations:', { pin_id: fileData.pin_id, area_id: fileData.area_id });

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify ownership based on whether file belongs to a pin or area (admins bypass)
      if (fileData.pin_id && fileData.pin_id !== 'null') {
        // File belongs to a pin - verify user owns the pin
        const { data: pinData, error: pinError } = await this.supabase
          .from('pins')
          .select('user_id')
          .eq('id', fileData.pin_id)
          .single();

        if (pinError || !pinData) {
          console.error('❌ Get pin data error:', pinError);
          return false;
        }

        if (!isAdmin && pinData.user_id !== user.id) {
          console.error('🚫 User does not have permission to rename this file (pin ownership)');
          return false;
        }
        console.log('✅ Pin access verified');
      } else if (fileData.area_id && fileData.area_id !== 'null') {
        // File belongs to an area - verify user owns the area
        const { data: areaData, error: areaError } = await this.supabase
          .from('areas')
          .select('user_id')
          .eq('id', fileData.area_id)
          .single();

        if (areaError || !areaData) {
          console.error('❌ Get area data error:', areaError);
          return false;
        }

        if (!isAdmin && areaData.user_id !== user.id) {
          console.error('🚫 User does not have permission to rename this file (area ownership)');
          return false;
        }
        console.log('✅ Area access verified');
      } else {
        // File doesn't belong to a pin or area - this is an orphaned file
        // Allow rename but log a warning
        console.warn('⚠️ File does not belong to a pin or area (orphaned file)');
      }

      // Update the file name in the database
      console.log('💾 Updating file name in database...');
      const { error: updateError } = await this.supabase
        .from('pin_files')
        .update({ file_name: newFileName })
        .eq('id', fileId);

      if (updateError) {
        console.error('❌ Database update error:', updateError);
        return false;
      }

      console.log('✅ File renamed successfully:', newFileName);
      return true;
    } catch (error) {
      console.error('❌ Rename file error:', error);
      return false;
    }
  }

  /**
   * Alternative delete method - more direct approach
   */
  async deleteFileSimple(fileId: string): Promise<boolean> {
    try {
      console.log('Simple delete - Starting for file ID:', fileId)
      
      // Get current user first to ensure authentication
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      
      if (authError || !user) {
        console.error('Simple delete - Authentication required:', authError)
        return false
      }
      
      console.log('Simple delete - Authenticated user:', user.id)
      
      // Get the file info first to get the storage path
      const { data: fileInfo, error: fileError } = await this.supabase
        .from('pin_files')
        .select('file_path')
        .eq('id', fileId)
        .single()
      
      if (fileError) {
        console.error('Simple delete - Could not get file info:', fileError)
      }
      
      // Delete from database
      const { data: deleteResult, error: dbError } = await this.supabase
        .from('pin_files')
        .delete()
        .eq('id', fileId)
        .select()
      
      if (dbError) {
        console.error('Simple delete - Database error:', dbError)
        console.error('Simple delete - Error details:', {
          message: dbError.message,
          code: dbError.code,
          details: dbError.details,
          hint: dbError.hint
        })
        return false
      }
      
      console.log('Simple delete - Database delete result:', deleteResult)
      console.log('Simple delete - Number of rows deleted:', deleteResult?.length || 0)
      
      if (deleteResult && deleteResult.length > 0) {
        // Try to clean up storage (don't fail if this doesn't work)
        const filePath = fileInfo?.file_path || deleteResult[0].file_path
        if (filePath) {
          console.log('Simple delete - Cleaning up storage file:', filePath)
          const { error: storageError } = await this.supabase.storage
            .from('pin-files')
            .remove([filePath])
          
          if (storageError) {
            console.warn('Simple delete - Storage cleanup failed:', storageError)
          } else {
            console.log('Simple delete - Storage file cleaned up successfully')
          }
        }
        console.log('Simple delete - Successfully deleted file from database')
        return true
      }
      
      console.log('Simple delete - No rows deleted, file may not exist or permission denied')
      return false
    } catch (error) {
      console.error('Simple delete error:', error)
      return false
    }
  }

  /**
   * Get all files for a project (with user authentication check)
   */
  async getProjectFiles(projectId: string): Promise<PinFile[]> {
    perfLogger.start(`getProjectFiles-${projectId.slice(0, 8)}`);

    try {
      // Get current user to ensure they have access
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()

      if (authError || !user) {
        console.log(`⚠️ [FILE-STORAGE] Auth required for project ${projectId.slice(0, 8)}`);
        perfLogger.warn(`Auth required for project ${projectId.slice(0, 8)}`);
        return []
      }

      // Query all files for the project - RLS policies will handle access control
      const { data, error } = await this.supabase
        .from('pin_files')
        .select('*')
        .eq('project_id', projectId)  // Use snake_case column name
        .order('uploaded_at', { ascending: false })  // Use snake_case column name

      if (error) {
        console.error(`❌ [FILE-STORAGE] Get project files error:`, error);
        perfLogger.error(`Get project files error for ${projectId.slice(0, 8)}`, error);
        return []
      }

      if (data && data.length > 0) {
        const nmaxFiles = data.filter(f => f.file_name.includes('_nmax'));
        const pinFiles = data.filter(f => f.pin_id && !f.area_id);
        const areaFiles = data.filter(f => f.area_id && !f.pin_id);
        const orphanedFiles = data.filter(f => !f.pin_id && !f.area_id);
        console.log(`📊 [FILE-STORAGE] ${data.length} files (${pinFiles.length} pin, ${areaFiles.length} area, ${nmaxFiles.length} nmax${orphanedFiles.length > 0 ? `, ${orphanedFiles.length} orphaned` : ''})`);
      } else {
        console.log(`📊 [FILE-STORAGE] Query returned 0 files`);
      }

      perfLogger.end(`getProjectFiles-${projectId.slice(0, 8)}`, `${data?.length || 0} files`);

      // Transform snake_case to camelCase for return
      return (data || []).map(item => ({
        id: item.id,
        pinId: item.pin_id,
        areaId: item.area_id,
        fileName: item.file_name,
        filePath: item.file_path,
        fileSize: item.file_size,
        fileType: item.file_type,
        projectId: item.project_id,
        uploadedAt: new Date(item.uploaded_at),
        startDate: item.start_date ? new Date(item.start_date) : undefined,
        endDate: item.end_date ? new Date(item.end_date) : undefined,
        isDiscrete: item.is_discrete || false,
        uniqueDates: item.unique_dates || undefined
      }))
    } catch (error) {
      console.error(`❌ [FILE-STORAGE] Get project files exception:`, error);
      perfLogger.error(`Get project files exception for ${projectId.slice(0, 8)}`, error);
      return []
    }
  }

  /**
   * Create a public URL for a file (for viewing/analysis)
   */
  getPublicUrl(filePath: string): string | null {
    try {
      const { data } = this.supabase.storage
        .from('pin-files')
        .getPublicUrl(filePath)

      return data.publicUrl
    } catch (error) {
      console.error('Get public URL error:', error)
      return null
    }
  }

  /**
   * Update visual properties (style rules) for a file
   */
  async updateFileVisualProperties(
    fileId: string,
    visualProperties: Record<string, any>
  ): Promise<boolean> {
    try {
      console.log('🎨 Updating visual properties for file:', fileId);

      // Get current user to ensure they have access
      const { data: { user }, error: authError } = await this.supabase.auth.getUser();

      if (authError || !user) {
        console.error('❌ Authentication required to update visual properties:', authError);
        return false;
      }

      console.log(`✅ Authenticated as user: ${user.id}`);

      // Get file metadata to verify ownership
      const { data: fileData, error: getError } = await this.supabase
        .from('pin_files')
        .select('pin_id, visual_properties')
        .eq('id', fileId)
        .single();

      if (getError || !fileData) {
        console.error('❌ Get file data error:', getError);
        return false;
      }

      const isAdmin = isPeblAdminEmail(user.email)

      // Verify user has access to the pin (admins bypass ownership check)
      const { data: pinData, error: pinError } = await this.supabase
        .from('pins')
        .select('user_id')
        .eq('id', fileData.pin_id)
        .single();

      if (pinError || !pinData) {
        console.error('❌ Get pin data error:', pinError);
        return false;
      }

      // Check if user owns the pin associated with this file (admins bypass)
      if (!isAdmin && pinData.user_id !== user.id) {
        console.error('🚫 User does not have permission to update this file');
        return false;
      }

      // Merge new visual properties with existing ones
      const existingProps = fileData.visual_properties || {};
      const mergedProps = { ...existingProps, ...visualProperties };

      // Update the visual properties in the database
      console.log('💾 Updating visual properties in database...');
      const { error: updateError } = await this.supabase
        .from('pin_files')
        .update({ visual_properties: mergedProps })
        .eq('id', fileId);

      if (updateError) {
        console.error('❌ Database update error:', updateError);
        return false;
      }

      console.log('✅ Visual properties updated successfully');
      return true;
    } catch (error) {
      console.error('❌ Update visual properties error:', error);
      return false;
    }
  }

  /**
   * Get visual properties for a file
   */
  async getFileVisualProperties(fileId: string): Promise<Record<string, any> | null> {
    try {
      const { data, error } = await this.supabase
        .from('pin_files')
        .select('visual_properties')
        .eq('id', fileId)
        .single();

      if (error) {
        console.error('❌ Get visual properties error:', error);
        return null;
      }

      return data?.visual_properties || {};
    } catch (error) {
      console.error('❌ Get visual properties error:', error);
      return null;
    }
  }
}

export const fileStorageService = new FileStorageService()