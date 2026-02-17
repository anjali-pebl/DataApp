'use client';

import React, { memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Database } from 'lucide-react';
import PinMarineDeviceData from '@/components/pin-data/PinMarineDeviceData';
import type { PinFile } from '@/lib/supabase/file-storage-service';

interface AvailableProject {
  id: string;
  name: string;
}

export interface MarineDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA' | null;
  selectedFiles: File[];
  selectedFileMetadata?: {
    pinLabel?: string;
    startDate?: Date;
    endDate?: Date;
    fileCategories?: string[];
  } | null;
  isLoadingFromSavedPlot: boolean;
  onRequestFileSelection: () => void;
  availableFilesForPlots: PinFile[];
  onDownloadFile: (fileId: string) => void;
  objectGpsCoords: { lat: number; lng: number } | undefined;
  objectName: string;
  multiFileMergeMode: boolean;
  allProjectFilesForTimeline: PinFile[];
  getFileDateRange: (fileId: string) => { start: Date; end: Date } | null;
  projectId: string;
  onRefreshFiles: () => void;
  availableProjects: AvailableProject[];
  onClose: () => void;
}

function MarineDeviceModalComponent({
  open,
  onOpenChange,
  selectedFileType,
  selectedFiles,
  selectedFileMetadata,
  isLoadingFromSavedPlot,
  onRequestFileSelection,
  availableFilesForPlots,
  onDownloadFile,
  objectGpsCoords,
  objectName,
  multiFileMergeMode,
  allProjectFilesForTimeline,
  getFileDateRange,
  projectId,
  onRefreshFiles,
  availableProjects,
  onClose,
}: MarineDeviceModalProps) {
  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="max-w-[100vw] w-[100vw] h-[100vh] max-h-[100vh] m-0 p-0 rounded-none sm:rounded-none border-0 marine-device-modal" data-marine-modal>
        <DialogHeader className="sr-only">
          <DialogTitle>
            {selectedFileType ? `${selectedFileType} Data Analysis` : 'Data Viewer'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {selectedFileType && (selectedFiles.length > 0 || sessionStorage.getItem('pebl-load-plot-view') || isLoadingFromSavedPlot) ? (
            <PinMarineDeviceData
              fileType={selectedFileType}
              files={selectedFiles}
              selectedFileMetadata={selectedFileMetadata}
              onRequestFileSelection={onRequestFileSelection}
              availableFiles={availableFilesForPlots}
              onDownloadFile={onDownloadFile}
              objectLocation={objectGpsCoords}
              objectName={objectName}
              multiFileMergeMode={multiFileMergeMode}
              allProjectFilesForTimeline={allProjectFilesForTimeline}
              getFileDateRange={getFileDateRange}
              projectId={projectId}
              onRefreshFiles={onRefreshFiles}
              availableProjects={availableProjects}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-center">
              <div className="text-muted-foreground">
                <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">No files selected</p>
                <p className="text-sm">Select a file type to begin analysis</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Custom comparison function for React.memo()
// Dialogs should only re-render when open state or critical data changes
const arePropsEqual = (prevProps: MarineDeviceModalProps, nextProps: MarineDeviceModalProps): boolean => {
  // Always re-render if dialog open state changes
  if (prevProps.open !== nextProps.open) {
    return false;
  }

  // If dialog is closed, skip re-renders for other prop changes
  if (!nextProps.open) {
    return true;
  }

  // When dialog is open, check data props
  if (prevProps.selectedFileType !== nextProps.selectedFileType ||
      prevProps.selectedFiles !== nextProps.selectedFiles ||
      prevProps.isLoadingFromSavedPlot !== nextProps.isLoadingFromSavedPlot ||
      prevProps.availableFilesForPlots !== nextProps.availableFilesForPlots ||
      prevProps.objectGpsCoords !== nextProps.objectGpsCoords ||
      prevProps.objectName !== nextProps.objectName ||
      prevProps.multiFileMergeMode !== nextProps.multiFileMergeMode ||
      prevProps.allProjectFilesForTimeline !== nextProps.allProjectFilesForTimeline ||
      prevProps.projectId !== nextProps.projectId ||
      prevProps.availableProjects !== nextProps.availableProjects) {
    return false;
  }

  return true; // Props are equal, skip re-render
};

// Export memoized component for better performance (prevents re-renders when dialog is closed)
export const MarineDeviceModal = memo(MarineDeviceModalComponent, arePropsEqual);
