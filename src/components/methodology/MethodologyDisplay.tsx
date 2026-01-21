'use client';

import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MethodologyAttachment } from '@/lib/supabase/methodology-service';

interface MethodologyDisplayProps {
  contentHtml: string | null;
  attachments: MethodologyAttachment[];
  onDownload: (attachment: MethodologyAttachment) => Promise<void>;
}

export function MethodologyDisplay({
  contentHtml,
  attachments,
  onDownload,
}: MethodologyDisplayProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Content */}
      {contentHtml ? (
        <div
          className="prose prose-sm max-w-none border rounded-lg p-4 bg-muted/20"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      ) : (
        <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
          <p className="text-sm">No methodology documentation has been added yet.</p>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Supporting Documents</h4>
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30"
              >
                <FileText className="h-8 w-8 text-red-600 shrink-0" />

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{attachment.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.fileSize)}
                  </p>
                  {attachment.caption && (
                    <p className="text-sm text-muted-foreground italic mt-1">
                      {attachment.caption}
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDownload(attachment)}
                  className="shrink-0"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
