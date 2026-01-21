'use client';

import { useState, useEffect, useCallback } from 'react';
import { fileStorageService, type PinFile } from '@/lib/supabase/file-storage-service';
import { projectService } from '@/lib/supabase/project-service';
import { pinAreaService } from '@/lib/supabase/pin-area-service';
import { getMergedFilesByProjectAction } from '@/app/api/merged-files/actions';
import type { Pin, Line as LineType, Area, Project, MergedFile } from '@/lib/supabase/types';

export interface ProjectDataState {
  project: Project | null;
  pins: Pin[];
  areas: Area[];
  pinFileMetadata: Record<string, PinFile[]>;
  areaFileMetadata: Record<string, PinFile[]>;
  mergedFiles: MergedFile[];
  isLoading: boolean;
  isLoadingMergedFiles: boolean;
  error: string | null;
}

export interface UseProjectDataReturn extends ProjectDataState {
  reload: () => Promise<void>;
  getProjectFiles: () => Array<PinFile & { pinLabel: string }>;
  groupFilesByType: (files: PinFile[]) => Record<string, Array<PinFile & { pinLabel: string }>>;
  extractDateRange: (fileName: string) => string | null;
}

export function useProjectData(projectId: string): UseProjectDataReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pinFileMetadata, setPinFileMetadata] = useState<Record<string, PinFile[]>>({});
  const [areaFileMetadata, setAreaFileMetadata] = useState<Record<string, PinFile[]>>({});
  const [mergedFiles, setMergedFiles] = useState<MergedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMergedFiles, setIsLoadingMergedFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch merged files (accepts resolved project ID)
  const fetchMergedFiles = useCallback(async (resolvedId?: string) => {
    const idToUse = resolvedId || projectId;
    if (!idToUse) return;

    setIsLoadingMergedFiles(true);
    try {
      const result = await getMergedFilesByProjectAction(idToUse);
      if (result.success && result.files) {
        setMergedFiles(result.files);
      } else {
        console.error('Failed to fetch merged files:', result.error);
        setMergedFiles([]);
      }
    } catch (err) {
      console.error('Error fetching merged files:', err);
      setMergedFiles([]);
    } finally {
      setIsLoadingMergedFiles(false);
    }
  }, [projectId]);

  // Reload all project files
  const reload = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      // First try to get project directly by ID (works for UUID projectIds)
      let projectData = await projectService.getProject(projectId);
      let resolvedProjectId = projectData?.id || projectId;

      // Load project data (pins, areas) - this works with both UUID and slug
      // because pinAreaService queries by project_id which may be the slug
      const projectItems = await pinAreaService.getProjectObjects(projectId);
      const loadedPins = projectItems?.pins || [];
      const loadedAreas = projectItems?.areas || [];

      setPins(loadedPins);
      setAreas(loadedAreas);

      // If we didn't get project info yet, try to find it by slug
      if (!projectData) {
        projectData = await projectService.getProjectBySlug(projectId);
        if (projectData) {
          resolvedProjectId = projectData.id;
        }
      }

      if (projectData) {
        setProject(projectData);
      } else {
        // Known location slug mappings
        const knownLocations: Record<string, string> = {
          'milfordhaven': 'Milford Haven',
          'ramseysound': 'Ramsey Sound',
          'bidefordbay': 'Bideford Bay',
          'blakeneyoverfalls': 'Blakeney Overfalls',
          'pabayinnersound': 'Pabay Inner Sound',
          'lochbay': 'Loch Bay',
          'lochsunart': 'Loch Sunart',
        };

        const formattedName = knownLocations[projectId.toLowerCase()] ||
          // Fallback: try to format unknown slugs
          projectId
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/_/g, ' ')
            .replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ')
            .trim();

        setProject({
          id: projectId,
          name: formattedName,
          createdAt: new Date()
        });
      }

      // Load ALL files for the project using resolved ID
      const allProjectFiles = await fileStorageService.getProjectFiles(resolvedProjectId);

      // Group files by pinId or areaId
      const pinMetadata: Record<string, PinFile[]> = {};
      const areaMetadata: Record<string, PinFile[]> = {};

      for (const file of allProjectFiles) {
        if (file.pinId) {
          if (!pinMetadata[file.pinId]) {
            pinMetadata[file.pinId] = [];
          }
          pinMetadata[file.pinId].push(file);
        } else if (file.areaId) {
          if (!areaMetadata[file.areaId]) {
            areaMetadata[file.areaId] = [];
          }
          areaMetadata[file.areaId].push(file);
        }
      }

      setPinFileMetadata(pinMetadata);
      setAreaFileMetadata(areaMetadata);

      // Also refresh merged files with resolved project ID
      await fetchMergedFiles(resolvedProjectId);

    } catch (err) {
      console.error('Error loading project data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load project data');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, fetchMergedFiles]);

  // Initial load
  useEffect(() => {
    reload();
  }, [reload]);

  // Extract date range from filename (format: YYMM_YYMM)
  const extractDateRange = useCallback((fileName: string): string | null => {
    const match = fileName.match(/(\d{4}_\d{4})/);
    return match ? match[1] : null;
  }, []);

  // Get all project files with pin labels
  const getProjectFiles = useCallback((): Array<PinFile & { pinLabel: string }> => {
    const allFiles: Array<PinFile & { pinLabel: string }> = [];

    // Add pin files
    pins.forEach(pin => {
      const pinFiles = pinFileMetadata[pin.id] || [];
      pinFiles.forEach(file => {
        const fileNameLower = file.fileName.toLowerCase();
        const containsAll = fileNameLower.includes('_all') ||
                            fileNameLower.includes('all_') ||
                            fileNameLower.startsWith('all') ||
                            /\ball\b/.test(fileNameLower);

        let pinLabel: string;
        if (containsAll) {
          pinLabel = 'All Locations';
        } else if (pin.label.toLowerCase().includes('all')) {
          pinLabel = 'All Locations';
        } else {
          pinLabel = pin.label || 'Unnamed Pin';
        }

        allFiles.push({ ...file, pinLabel });
      });
    });

    // Add area files
    areas.forEach(area => {
      const areaFiles = areaFileMetadata[area.id] || [];
      areaFiles.forEach(file => {
        const fileNameLower = file.fileName.toLowerCase();
        const containsAll = fileNameLower.includes('_all') ||
                            fileNameLower.includes('all_') ||
                            fileNameLower.startsWith('all') ||
                            /\ball\b/.test(fileNameLower);

        let areaLabel: string;
        if (containsAll) {
          areaLabel = 'All Locations';
        } else if (area.label.toLowerCase().includes('all')) {
          areaLabel = 'All Locations';
        } else {
          areaLabel = area.label || 'Unnamed Area';
        }

        allFiles.push({ ...file, pinLabel: areaLabel });
      });
    });

    return allFiles;
  }, [pins, areas, pinFileMetadata, areaFileMetadata]);

  // Group files by type (FPOD, SubCam, GP)
  const groupFilesByType = useCallback((files: PinFile[]): Record<string, Array<PinFile & { pinLabel: string }>> => {
    const grouped: Record<string, Array<PinFile & { pinLabel: string }>> = {
      FPOD: [],
      SubCam: [],
      GP: [],
      Other: []
    };

    files.forEach(file => {
      const pin = pins.find(p => p.id === file.pinId);
      const area = areas.find(a => a.id === file.areaId);

      const fileNameLower = file.fileName.toLowerCase();
      const containsAll = fileNameLower.includes('_all') ||
                          fileNameLower.includes('all_') ||
                          fileNameLower.startsWith('all') ||
                          /\ball\b/.test(fileNameLower);

      let pinLabel: string;
      if (containsAll) {
        pinLabel = 'All Locations';
      } else if (pin?.label.toLowerCase().includes('all') || area?.label.toLowerCase().includes('all')) {
        pinLabel = 'All Locations';
      } else {
        pinLabel = pin?.label || area?.label || 'Unnamed';
      }

      const fileWithPinLabel = { ...file, pinLabel };

      const fileName = file.fileName.toUpperCase();
      if (fileName.includes('FPOD') || fileName.startsWith('FPOD_')) {
        grouped.FPOD.push(fileWithPinLabel);
      } else if (fileName.includes('SUBCAM') || fileName.includes('SUB_CAM') || fileName.startsWith('SUBCAM_')) {
        grouped.SubCam.push(fileWithPinLabel);
      } else if (fileName.includes('GP') || fileName.startsWith('GP_') || fileName.includes('GPS')) {
        grouped.GP.push(fileWithPinLabel);
      } else {
        grouped.Other.push(fileWithPinLabel);
      }
    });

    return grouped;
  }, [pins, areas]);

  return {
    project,
    pins,
    areas,
    pinFileMetadata,
    areaFileMetadata,
    mergedFiles,
    isLoading,
    isLoadingMergedFiles,
    error,
    reload,
    getProjectFiles,
    groupFilesByType,
    extractDateRange
  };
}
