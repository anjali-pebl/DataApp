'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export interface ProjectMismatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'pin' | 'area';
  currentProjectName: string;
  targetProjectName: string;
  onSwitchAndUpload: () => void;
  onCancel: () => void;
}

export function ProjectMismatchDialog({
  open,
  onOpenChange,
  targetType,
  currentProjectName,
  targetProjectName,
  onSwitchAndUpload,
  onCancel,
}: ProjectMismatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[9999]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-5 w-5" />
            Different Project
          </DialogTitle>
          <DialogDescription>
            This {targetType} is not in the currently active project, would you like to switch active projects?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0">Active project:</span>
              <span className="font-medium">{currentProjectName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0">This {targetType}:</span>
              <span className="font-medium">{targetProjectName}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={onSwitchAndUpload}
            >
              Switch Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
