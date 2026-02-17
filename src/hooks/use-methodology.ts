import { useState, useEffect, useCallback } from 'react';
import {
  methodologyService,
  type Methodology,
  type MethodologyAttachment,
} from '@/lib/supabase/methodology-service';
import type { TileName } from '@/lib/file-categorization-config';
import { toast } from 'sonner';

interface UseMethodologyOptions {
  projectId: string;
  tileName: TileName;
}

interface UseMethodologyReturn {
  // State
  methodology: Methodology | null;
  attachments: MethodologyAttachment[];
  isLoading: boolean;
  isSaving: boolean;
  isUploading: boolean;
  canEdit: boolean;

  // Content state
  contentHtml: string | null;
  contentJson: Record<string, unknown> | null;

  // Actions
  setContent: (html: string, json: Record<string, unknown>) => void;
  save: () => Promise<void>;
  publish: () => Promise<void>;
  unpublish: () => Promise<void>;
  uploadAttachment: (file: File) => Promise<void>;
  updateCaption: (attachmentId: string, caption: string) => Promise<void>;
  deleteAttachment: (attachmentId: string) => Promise<void>;
  downloadAttachment: (attachment: MethodologyAttachment) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMethodology({ projectId, tileName }: UseMethodologyOptions): UseMethodologyReturn {
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [attachments, setAttachments] = useState<MethodologyAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  // Local content state for editing
  const [contentHtml, setContentHtml] = useState<string | null>(null);
  const [contentJson, setContentJson] = useState<Record<string, unknown> | null>(null);

  // Load methodology and check permissions
  const loadData = useCallback(async () => {
    if (!projectId || !tileName) return;

    setIsLoading(true);
    try {
      // Load methodology
      const methData = await methodologyService.getMethodology(projectId, tileName);
      setMethodology(methData);
      setContentHtml(methData?.contentHtml ?? null);
      setContentJson(methData?.contentJson ?? null);

      // Load attachments if methodology exists
      if (methData) {
        const attachData = await methodologyService.getAttachments(methData.id);
        setAttachments(attachData);
      } else {
        setAttachments([]);
      }

      // Check edit permissions
      const canUserEdit = await methodologyService.canUserEdit(projectId);
      setCanEdit(canUserEdit);
    } catch (error) {
      console.error('Error loading methodology:', error);
      toast.error('Failed to load methodology');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, tileName]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Set content (for editor changes)
  const setContent = useCallback((html: string, json: Record<string, unknown>) => {
    setContentHtml(html);
    setContentJson(json);
  }, []);

  // Save methodology
  const save = useCallback(async () => {
    if (!projectId || !tileName) return;

    setIsSaving(true);
    try {
      const result = await methodologyService.saveMethodology({
        projectId,
        tileName,
        contentHtml,
        contentJson,
      });

      if (result.success && result.data) {
        setMethodology(result.data);
        toast.success('Methodology saved');
      } else {
        toast.error(result.error || 'Failed to save methodology');
      }
    } catch (error) {
      console.error('Error saving methodology:', error);
      toast.error('Failed to save methodology');
    } finally {
      setIsSaving(false);
    }
  }, [projectId, tileName, contentHtml, contentJson]);

  // Publish methodology
  const publish = useCallback(async () => {
    if (!methodology) {
      toast.error('Please save the methodology first');
      return;
    }

    setIsSaving(true);
    try {
      const result = await methodologyService.publishMethodology(methodology.id);
      if (result.success) {
        setMethodology({ ...methodology, isPublished: true });
        toast.success('Methodology published');
      } else {
        toast.error(result.error || 'Failed to publish');
      }
    } catch (error) {
      console.error('Error publishing methodology:', error);
      toast.error('Failed to publish methodology');
    } finally {
      setIsSaving(false);
    }
  }, [methodology]);

  // Unpublish methodology
  const unpublish = useCallback(async () => {
    if (!methodology) return;

    setIsSaving(true);
    try {
      const result = await methodologyService.unpublishMethodology(methodology.id);
      if (result.success) {
        setMethodology({ ...methodology, isPublished: false });
        toast.success('Methodology unpublished');
      } else {
        toast.error(result.error || 'Failed to unpublish');
      }
    } catch (error) {
      console.error('Error unpublishing methodology:', error);
      toast.error('Failed to unpublish methodology');
    } finally {
      setIsSaving(false);
    }
  }, [methodology]);

  // Upload attachment
  const uploadAttachment = useCallback(async (file: File) => {
    console.log('[Methodology] Starting upload for file:', file.name, 'size:', file.size, 'type:', file.type);

    // If no methodology exists yet, save first
    let methId = methodology?.id;
    if (!methId) {
      console.log('[Methodology] No methodology record exists, creating one first...');
      setIsSaving(true);
      try {
        const result = await methodologyService.saveMethodology({
          projectId,
          tileName,
          contentHtml,
          contentJson,
        });
        console.log('[Methodology] Save methodology result:', result);
        if (result.success && result.data) {
          setMethodology(result.data);
          methId = result.data.id;
          console.log('[Methodology] Created methodology with ID:', methId);
        } else {
          console.error('[Methodology] Failed to create methodology:', result.error);
          toast.error(result.error || 'Failed to create methodology');
          setIsSaving(false);
          return;
        }
      } catch (error) {
        console.error('[Methodology] Error creating methodology:', error);
        toast.error('Failed to create methodology');
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    console.log('[Methodology] Uploading attachment to methodology:', methId);
    setIsUploading(true);
    try {
      const result = await methodologyService.uploadAttachment(methId, file);
      console.log('[Methodology] Upload result:', result);
      if (result.success && result.data) {
        setAttachments((prev) => [...prev, result.data!]);
        toast.success('PDF uploaded');
      } else {
        console.error('[Methodology] Upload failed:', result.error);
        toast.error(result.error || 'Failed to upload PDF');
      }
    } catch (error) {
      console.error('[Methodology] Error uploading attachment:', error);
      toast.error('Failed to upload PDF');
    } finally {
      setIsUploading(false);
    }
  }, [methodology, projectId, tileName, contentHtml, contentJson]);

  // Update caption
  const updateCaption = useCallback(async (attachmentId: string, caption: string) => {
    try {
      const result = await methodologyService.updateCaption(attachmentId, caption);
      if (result.success) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === attachmentId ? { ...a, caption } : a))
        );
        toast.success('Caption updated');
      } else {
        toast.error(result.error || 'Failed to update caption');
      }
    } catch (error) {
      console.error('Error updating caption:', error);
      toast.error('Failed to update caption');
    }
  }, []);

  // Delete attachment
  const deleteAttachment = useCallback(async (attachmentId: string) => {
    try {
      const result = await methodologyService.deleteAttachment(attachmentId);
      if (result.success) {
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
        toast.success('Attachment deleted');
      } else {
        toast.error(result.error || 'Failed to delete attachment');
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Failed to delete attachment');
    }
  }, []);

  // Download attachment
  const downloadAttachment = useCallback(async (attachment: MethodologyAttachment) => {
    try {
      const blob = await methodologyService.downloadAttachment(attachment.filePath);
      if (blob) {
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        toast.error('Failed to download file');
      }
    } catch (error) {
      console.error('Error downloading attachment:', error);
      toast.error('Failed to download file');
    }
  }, []);

  // Refresh data
  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  return {
    methodology,
    attachments,
    isLoading,
    isSaving,
    isUploading,
    canEdit,
    contentHtml,
    contentJson,
    setContent,
    save,
    publish,
    unpublish,
    uploadAttachment,
    updateCaption,
    deleteAttachment,
    downloadAttachment,
    refresh,
  };
}
