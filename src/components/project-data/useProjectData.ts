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
      console.log(`[useProjectData] Loading data for projectId: "${projectId}"`);

      // First try to get project directly by ID (works for UUID projectIds)
      let projectData = await projectService.getProject(projectId);
      // Keep the original projectId for file queries - files are stored with slug as project_id
      let resolvedProjectId = projectId;
      console.log(`[useProjectData] After getProject: projectData=${!!projectData}, resolvedProjectId="${resolvedProjectId}"`);

      // Load project data (pins, areas) - this works with both UUID and slug
      // because pinAreaService queries by project_id which may be the slug
      const projectItems = await pinAreaService.getProjectObjects(projectId);
      const loadedPins = projectItems?.pins || [];
      const loadedAreas = projectItems?.areas || [];

      setPins(loadedPins);
      setAreas(loadedAreas);
      console.log(`[useProjectData] Loaded ${loadedPins.length} pins, ${loadedAreas.length} areas`);

      // If we didn't get project info yet, try to find it by slug
      if (!projectData) {
        projectData = await projectService.getProjectBySlug(projectId);
        // Note: Do NOT change resolvedProjectId to projectData.id here!
        // Files are stored with project_id = slug (e.g., "milfordhaven"), not UUID.
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

      // Load ALL files for the project using resolved ID (which is the slug)
      console.log(`[useProjectData] Fetching files with resolvedProjectId: "${resolvedProjectId}"`);
      const allProjectFiles = await fileStorageService.getProjectFiles(resolvedProjectId);
      console.log(`[useProjectData] Got ${allProjectFiles.length} files total`);
      if (allProjectFiles.length > 0) {
        console.log(`[useProjectData] File pinIds:`, allProjectFiles.map(f => f.pinId).filter(Boolean));
      }

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

      // Debug: log area files
      const areaFileCount = Object.values(areaMetadata).flat().length;
      if (areaFileCount > 0) {
        console.log(`[useProjectData] Found ${areaFileCount} area files:`,
          Object.values(areaMetadata).flat().map(f => f.fileName));
      }
      console.log(`[useProjectData] Loaded areas: ${loadedAreas.length}`, loadedAreas.map(a => a.id));

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
    const addedFileIds = new Set<string>();

    // Create lookup maps for pins and areas
    const pinMap = new Map(pins.map(p => [p.id, p]));
    const areaMap = new Map(areas.map(a => [a.id, a]));

    // Add pin files that match loaded pins
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
        addedFileIds.add(file.id);
      });
    });

    // Add area files that match loaded areas
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
        addedFileIds.add(file.id);
      });
    });

    // Add files whose pins/areas aren't in the current project (orphaned files)
    // These are files that belong to this project but reference pins from other projects
    Object.entries(pinFileMetadata).forEach(([pinId, files]) => {
      if (!pinMap.has(pinId)) {
        files.forEach(file => {
          if (!addedFileIds.has(file.id)) {
            const fileNameLower = file.fileName.toLowerCase();
            const containsAll = fileNameLower.includes('_all') ||
                                fileNameLower.includes('all_') ||
                                fileNameLower.startsWith('all') ||
                                /\ball\b/.test(fileNameLower);

            const pinLabel = containsAll ? 'All Locations' : 'Unknown Location';
            allFiles.push({ ...file, pinLabel });
            addedFileIds.add(file.id);
          }
        });
      }
    });

    Object.entries(areaFileMetadata).forEach(([areaId, files]) => {
      if (!areaMap.has(areaId)) {
        files.forEach(file => {
          if (!addedFileIds.has(file.id)) {
            const fileNameLower = file.fileName.toLowerCase();
            const containsAll = fileNameLower.includes('_all') ||
                                fileNameLower.includes('all_') ||
                                fileNameLower.startsWith('all') ||
                                /\ball\b/.test(fileNameLower);

            const areaLabel = containsAll ? 'All Locations' : 'Unknown Location';
            allFiles.push({ ...file, pinLabel: areaLabel });
            addedFileIds.add(file.id);
          }
        });
      }
    });

    // Debug: log what files are being returned
    const areaFilesInResult = allFiles.filter(f => f.areaId);
    if (areaFilesInResult.length > 0 || Object.keys(areaFileMetadata).length > 0) {
      console.log(`[useProjectData.getProjectFiles] Total files: ${allFiles.length}, Area files in result: ${areaFilesInResult.length}`);
      console.log(`[useProjectData.getProjectFiles] areaFileMetadata keys:`, Object.keys(areaFileMetadata));
      console.log(`[useProjectData.getProjectFiles] areas count:`, areas.length);
    }

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
