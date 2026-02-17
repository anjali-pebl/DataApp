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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin, Square, Upload, Image, FileText, FileSpreadsheet } from 'lucide-react';
import { isPhotoFile, isPdfFile } from '@/lib/file-categorization-config';
import type { Pin, Area } from '@/lib/supabase/types';

export interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUploadFiles: File[];
  pins: Pin[];
  areas: Area[];
  currentProjectId: string | null;
  isUploadingFiles: boolean;
  onUpload: (targetId: string, targetType: 'pin' | 'area') => void;
  onCancel: () => void;
}

export function FileUploadDialog({
  open,
  onOpenChange,
  pendingUploadFiles,
  pins,
  areas,
  currentProjectId,
  isUploadingFiles,
  onUpload,
  onCancel,
}: FileUploadDialogProps) {
  const { toast } = useToast();
  const [selectedUploadPinId, setSelectedUploadPinId] = React.useState('');
  const [selectedUploadAreaId, setSelectedUploadAreaId] = React.useState('');
  const [uploadTargetType, setUploadTargetType] = React.useState<'pin' | 'area'>('pin');

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSelectedUploadPinId('');
      setSelectedUploadAreaId('');
      setUploadTargetType('pin');
    }
  }, [open]);

  const handleClose = () => {
    onCancel();
    onOpenChange(false);
  };

  const handleUploadClick = () => {
    const targetId = uploadTargetType === 'pin' ? selectedUploadPinId : selectedUploadAreaId;
    if (targetId) {
      onUpload(targetId, uploadTargetType);
      onOpenChange(false);
    } else {
      toast({
        variant: "destructive",
        title: `No ${uploadTargetType === 'pin' ? 'Pin' : 'Area'} Selected`,
        description: `Please select ${uploadTargetType === 'pin' ? 'a pin' : 'an area'} to upload files to.`
      });
    }
  };

  const handleTargetTypeChange = (value: 'pin' | 'area') => {
    setUploadTargetType(value);
    setSelectedUploadPinId('');
    setSelectedUploadAreaId('');
  };

  // Filter pins and areas for current project
  const projectPins = pins.filter(pin => pin.projectId === currentProjectId);
  const projectAreas = areas.filter(area => area.projectId === currentProjectId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[9999]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Assign Files
          </DialogTitle>
          <DialogDescription>
            {pendingUploadFiles.length} file{pendingUploadFiles.length > 1 ? 's' : ''} selected. Choose where to upload them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Show selected files */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Selected Files:</label>
            <div className="bg-muted/30 rounded-md p-3 max-h-32 overflow-y-auto">
              {pendingUploadFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground py-0.5">
                  {isPhotoFile(file.name) ? (
                    <Image className="h-3 w-3 flex-shrink-0 text-blue-500" />
                  ) : isPdfFile(file.name) ? (
                    <FileText className="h-3 w-3 flex-shrink-0 text-red-500" />
                  ) : (
                    <FileSpreadsheet className="h-3 w-3 flex-shrink-0 text-green-500" />
                  )}
                  {file.name}
                </div>
              ))}
            </div>
          </div>

          {/* Target type selector (Pin vs Area) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Upload to:</label>
            <RadioGroup value={uploadTargetType} onValueChange={handleTargetTypeChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pin" id="target-pin" />
                <Label htmlFor="target-pin" className="flex items-center gap-2 cursor-pointer">
                  <MapPin className="h-4 w-4 text-blue-500" />
                  Pin (Single Location)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="area" id="target-area" />
                <Label htmlFor="target-area" className="flex items-center gap-2 cursor-pointer">
                  <Square className="h-4 w-4 text-purple-500" />
                  Area (Region/Multi-Site)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Pin/Area selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {uploadTargetType === 'pin' ? 'Assign to Pin:' : 'Assign to Area:'}
            </label>
            {uploadTargetType === 'pin' ? (
              <Select value={selectedUploadPinId} onValueChange={setSelectedUploadPinId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a pin..." />
                </SelectTrigger>
                <SelectContent className="z-[99999]">
                  {projectPins.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No pins found in this project.
                    </div>
                  ) : (
                    projectPins.map(pin => (
                      <SelectItem key={pin.id} value={pin.id}>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-blue-500" />
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: pin.color }}
                          />
                          <span>{pin.label || 'Unnamed Pin'}</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            ) : (
              <Select value={selectedUploadAreaId} onValueChange={setSelectedUploadAreaId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an area..." />
                </SelectTrigger>
                <SelectContent className="z-[99999]">
                  {projectAreas.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No areas found in this project.
                    </div>
                  ) : (
                    projectAreas.map(area => (
                      <SelectItem key={area.id} value={area.id}>
                        <div className="flex items-center gap-2">
                          <Square className="h-3 w-3 text-purple-500" />
                          <span>{area.label || 'Unnamed Area'}</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={(!selectedUploadPinId && !selectedUploadAreaId) || isUploadingFiles}
              data-testid="upload-files-confirm-button"
            >
              {isUploadingFiles ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                'Upload Files'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
