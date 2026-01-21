'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// Loading fallback for dialogs (minimal, since dialogs are small)
const DialogSkeleton = () => (
  <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
    <div className="bg-background p-6 rounded-lg shadow-lg">
      <Skeleton className="h-8 w-64 mb-4" />
      <Skeleton className="h-32 w-96" />
    </div>
  </div>
);

// Lazy load dialog components (only loaded when needed)
export const LazyFileUploadDialog = dynamic(
  () => import('./FileUploadDialog').then(mod => ({ default: mod.FileUploadDialog })),
  {
    loading: () => null, // Dialogs are small, no loading UI needed
    ssr: false
  }
);

export const LazyProjectSettingsDialog = dynamic(
  () => import('./ProjectSettingsDialog').then(mod => ({ default: mod.ProjectSettingsDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyMarineDeviceModal = dynamic(
  () => import('./MarineDeviceModal').then(mod => ({ default: mod.MarineDeviceModal })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyProjectsDialog = dynamic(
  () => import('./ProjectsDialog').then(mod => ({ default: mod.ProjectsDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyDeleteProjectConfirmDialog = dynamic(
  () => import('./DeleteProjectConfirmDialog').then(mod => ({ default: mod.DeleteProjectConfirmDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyBatchDeleteConfirmDialog = dynamic(
  () => import('./BatchDeleteConfirmDialog').then(mod => ({ default: mod.BatchDeleteConfirmDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyDuplicateWarningDialog = dynamic(
  () => import('./DuplicateWarningDialog').then(mod => ({ default: mod.DuplicateWarningDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

export const LazyAddProjectDialog = dynamic(
  () => import('./AddProjectDialog').then(mod => ({ default: mod.AddProjectDialog })),
  {
    loading: () => null,
    ssr: false
  }
);

// Note: ProjectDataDialog has been converted to a standalone page at /project-data/[projectId]
// The LazyProjectDataDialog export is kept for backward compatibility but should not be used
