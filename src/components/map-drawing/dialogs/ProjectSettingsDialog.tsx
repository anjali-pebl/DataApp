'use client';

import React from 'react';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SettingsDialogContent,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast";
import { Settings, Trash2 } from 'lucide-react';

interface SelectedObject {
  id: string;
  type: 'pin' | 'line' | 'area';
  label: string;
}

export interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  selectedObjectIds: Set<string>;
  selectedObjects: SelectedObject[];
  onDeleteProject: () => void;
  onBatchDelete: () => void;
  onCancel: () => void;
  onRename?: (newName: string) => Promise<boolean>;
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectName,
  selectedObjectIds,
  selectedObjects,
  onDeleteProject,
  onBatchDelete,
  onCancel,
  onRename,
}: ProjectSettingsDialogProps) {
  const { toast } = useToast();
  const [projectNameEdit, setProjectNameEdit] = React.useState(projectName);
  const [isSaving, setIsSaving] = React.useState(false);

  // Update internal state when project name changes
  React.useEffect(() => {
    if (open) {
      setProjectNameEdit(projectName);
    }
  }, [open, projectName]);

  const handleSaveChanges = async () => {
    const trimmed = projectNameEdit.trim();
    if (!trimmed) {
      toast({ variant: 'destructive', title: 'Project name cannot be empty', duration: 2000 });
      return;
    }
    if (trimmed === projectName) {
      onOpenChange(false);
      return;
    }
    setIsSaving(true);
    try {
      const success = onRename ? await onRename(trimmed) : false;
      if (success) {
        toast({ title: 'Project Renamed', description: `Display name updated to: ${trimmed}`, duration: 2000 });
        onOpenChange(false);
      } else {
        toast({ variant: 'destructive', title: 'Rename Failed', description: 'Only admins can rename projects.', duration: 3000 });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Rename Failed', duration: 2000 });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = () => {
    onDeleteProject();
  };

  const handleBatchDelete = () => {
    onBatchDelete();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogContent className="sm:max-w-md z-[9999]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Project Settings
          </DialogTitle>
          <DialogDescription>
            Manage settings for {projectName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project Name</label>
            <Input
              value={projectNameEdit}
              onChange={(e) => setProjectNameEdit(e.target.value)}
              placeholder="Enter project name"
            />
            <p className="text-xs text-muted-foreground">
              Changes the display name only. The underlying project data is not affected.
            </p>
          </div>

          {/* BATCH DELETE SECTION - Show when objects selected */}
          {selectedObjectIds.size > 0 && (
            <div className="p-4 border border-orange-500 rounded bg-orange-50 dark:bg-orange-950/20">
              <h3 className="text-sm font-semibold mb-2 text-orange-900 dark:text-orange-200">
                Batch Delete
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                You have selected {selectedObjectIds.size} object{selectedObjectIds.size !== 1 ? 's' : ''} to delete
              </p>

              {/* List selected objects */}
              <div className="space-y-1 max-h-32 overflow-y-auto mb-3 text-xs">
                {selectedObjects.map(obj => (
                  <div key={obj.id} className="flex items-center gap-2">
                    {obj.type === 'pin' && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                    {obj.type === 'line' && <div className="w-3 h-0.5 bg-green-500"></div>}
                    {obj.type === 'area' && <div className="w-2 h-2 bg-red-500/30 border border-red-500"></div>}
                    <span>{obj.label || `Unnamed ${obj.type}`}</span>
                  </div>
                ))}
              </div>

              <Button
                variant="destructive"
                onClick={handleBatchDelete}
                className="w-full flex items-center justify-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected Objects ({selectedObjectIds.size})
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="destructive"
              onClick={handleDeleteProject}
              className="flex items-center gap-2"
              disabled={selectedObjectIds.size > 0} // Disable if batch mode active
            >
              <Trash2 className="h-4 w-4" />
              Delete Project
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveChanges}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </SettingsDialogContent>
    </Dialog>
  );
}
