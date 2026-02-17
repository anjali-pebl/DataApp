'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileText,
  Upload,
  Trash2,
  Download,
  Pencil,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import type { MethodologyAttachment } from '@/lib/supabase/methodology-service';

interface MethodologyAttachmentsProps {
  attachments: MethodologyAttachment[];
  canEdit: boolean;
  onUpload: (file: File) => Promise<void>;
  onUpdateCaption: (attachmentId: string, caption: string) => Promise<void>;
  onDelete: (attachmentId: string) => Promise<void>;
  onDownload: (attachment: MethodologyAttachment) => Promise<void>;
  uploading?: boolean;
}

export function MethodologyAttachments({
  attachments,
  canEdit,
  onUpload,
  onUpdateCaption,
  onDelete,
  onDownload,
  uploading = false,
}: MethodologyAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUpload(file);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleStartEditCaption = (attachment: MethodologyAttachment) => {
    setEditingCaption(attachment.id);
    setCaptionValue(attachment.caption || '');
  };

  const handleSaveCaption = async (attachmentId: string) => {
    await onUpdateCaption(attachmentId, captionValue);
    setEditingCaption(null);
    setCaptionValue('');
  };

  const handleCancelEditCaption = () => {
    setEditingCaption(null);
    setCaptionValue('');
  };

  const handleDelete = async (attachmentId: string) => {
    setDeletingId(attachmentId);
    await onDelete(attachmentId);
    setDeletingId(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">PDF Attachments</Label>
        {canEdit && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Upload PDF
            </Button>
          </div>
        )}
      </div>

      {attachments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No attachments yet</p>
          {canEdit && (
            <p className="text-xs mt-1">Upload a PDF to add supporting documentation</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30"
            >
              <FileText className="h-8 w-8 text-red-600 shrink-0 mt-0.5" />

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(attachment.fileSize)}
                </p>

                {/* Caption editing */}
                {editingCaption === attachment.id ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={captionValue}
                      onChange={(e) => setCaptionValue(e.target.value)}
                      placeholder="Enter caption..."
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSaveCaption(attachment.id)}
                      className="h-8 w-8 p-0"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEditCaption}
                      className="h-8 w-8 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 mt-1">
                    {attachment.caption ? (
                      <p className="text-sm text-muted-foreground italic">
                        {attachment.caption}
                      </p>
                    ) : canEdit ? (
                      <button
                        onClick={() => handleStartEditCaption(attachment)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Add caption...
                      </button>
                    ) : null}
                    {canEdit && attachment.caption && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEditCaption(attachment)}
                        className="h-6 w-6 p-0"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDownload(attachment)}
                  className="h-8 w-8 p-0"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(attachment.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    title="Delete"
                    disabled={deletingId === attachment.id}
                  >
                    {deletingId === attachment.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
