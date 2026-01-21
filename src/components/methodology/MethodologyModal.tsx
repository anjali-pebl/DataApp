'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMethodology } from '@/hooks/use-methodology';
import { MethodologyEditor } from './MethodologyEditor';
import { MethodologyAttachments } from './MethodologyAttachments';
import { MethodologyDisplay } from './MethodologyDisplay';
import type { TileName } from '@/lib/file-categorization-config';
import {
  Loader2,
  Save,
  Eye,
  EyeOff,
  BookOpen,
  Pencil,
} from 'lucide-react';

interface MethodologyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tileName: TileName;
}

export function MethodologyModal({
  open,
  onOpenChange,
  projectId,
  tileName,
}: MethodologyModalProps) {
  const {
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
  } = useMethodology({ projectId, tileName });

  // Preview mode for owners to see what viewers will see
  const [previewMode, setPreviewMode] = useState(false);

  const hasUnsavedChanges =
    contentHtml !== methodology?.contentHtml ||
    JSON.stringify(contentJson) !== JSON.stringify(methodology?.contentJson);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-teal-600" />
            <DialogTitle>Methodology: {tileName}</DialogTitle>
            {methodology?.isPublished && (
              <Badge variant="secondary" className="ml-2">
                <Eye className="h-3 w-3 mr-1" />
                Published
              </Badge>
            )}
            {canEdit && previewMode && (
              <Badge variant="outline" className="ml-2">
                Preview Mode
              </Badge>
            )}
          </div>
          <DialogDescription>
            {canEdit
              ? previewMode
                ? 'This is how viewers will see your methodology.'
                : 'Document the data collection methodology for this tile. This will be visible to anyone you share this project with.'
              : 'View the data collection methodology documented by the project owner.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : canEdit && !previewMode ? (
          // Editor view for owners
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Documentation</h4>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMode(true)}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </Button>
              </div>
              <MethodologyEditor
                content={contentJson}
                onChange={setContent}
                editable={true}
              />
            </div>

            <Separator />

            <MethodologyAttachments
              attachments={attachments}
              canEdit={true}
              onUpload={uploadAttachment}
              onUpdateCaption={updateCaption}
              onDelete={deleteAttachment}
              onDownload={downloadAttachment}
              uploading={isUploading}
            />
          </div>
        ) : (
          // Read-only view for viewers OR preview mode for owners
          <div className="py-4">
            {canEdit && previewMode && (
              <div className="flex justify-end mb-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMode(false)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Back to Edit
                </Button>
              </div>
            )}
            <MethodologyDisplay
              contentHtml={contentHtml}
              attachments={attachments}
              onDownload={downloadAttachment}
            />
          </div>
        )}

        {canEdit && (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-2">
              {methodology?.isPublished ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unpublish}
                  disabled={isSaving}
                >
                  <EyeOff className="h-4 w-4 mr-2" />
                  Unpublish
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={publish}
                  disabled={isSaving || !methodology}
                  title={!methodology ? 'Save first to publish' : undefined}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Publish
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              )}
              <Button
                type="button"
                onClick={save}
                disabled={isSaving || !hasUnsavedChanges}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
