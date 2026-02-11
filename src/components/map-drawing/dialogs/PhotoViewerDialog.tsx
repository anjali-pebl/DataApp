'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';

export interface PhotoViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  fileName: string;
  onDownload: () => void;
}

export function PhotoViewerDialog({
  open,
  onOpenChange,
  imageUrl,
  fileName,
  onDownload,
}: PhotoViewerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] z-[9999] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium truncate pr-4">
              {fileName}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="flex-shrink-0"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={fileName}
            className="max-w-full max-h-[70vh] object-contain rounded"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
