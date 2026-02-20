'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Database, Loader2, Upload, ArrowLeft } from 'lucide-react';

export interface ProjectDataHeaderProps {
  projectName: string;
  isUploadingFiles: boolean;
  onUpload: () => void;
  canUpload?: boolean; // Partners cannot upload
}

export function ProjectDataHeader({
  projectName,
  isUploadingFiles,
  onUpload,
  canUpload = true
}: ProjectDataHeaderProps) {
  return (
    <header className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/map-drawing">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="h-4 w-4 mr-1" />
              <span className="text-sm">Back to Map</span>
            </Button>
          </Link>
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-semibold text-base">Project Data Files</h1>
            {projectName && (
              <>
                <span className="text-muted-foreground font-normal">·</span>
                <span className="text-muted-foreground font-normal text-sm">
                  {projectName}
                </span>
              </>
            )}
          </div>
        </div>
        {canUpload && (
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex items-center gap-1.5 h-8 px-3"
              disabled={isUploadingFiles}
              onClick={onUpload}
              data-testid="upload-file-button"
            >
              {isUploadingFiles ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-sm">Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  <span className="text-sm">Upload</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
