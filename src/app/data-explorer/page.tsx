
"use client";

import type { CSSProperties } from "react";
import React, { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";


import dynamic from 'next/dynamic';
import type { DateRange } from "react-day-picker";
import { format, formatISO, subDays, addDays, subMonths } from 'date-fns';

import { Button } from "@/components/ui/button";
import { PlotInstance } from "@/components/dataflow/PlotInstance";
import {
  PlusCircle, Waves, MapPin, CalendarDays, Search,
  Loader2, Info, CheckCircle2, XCircle, Copy, CloudSun, Anchor,
  Thermometer, Wind as WindIcon, Compass as CompassIcon, Sailboat, Timer as TimerIcon, ListChecks, FilePenLine,
  ChevronsLeft, ChevronsRight, Home, LayoutGrid, FileText, ChevronDown, ChevronRight, Database, Eye, FolderOpen, Bookmark,
  Trash2, MoreVertical, Clock, AlertTriangle, FolderOpenDot
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePickerWithRange } from "@/components/ui/date-picker-with-range";
import { Label as UiLabel } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CombinedDataPoint, LogStep as ApiLogStep, CombinedParameterKey } from '../om-marine-explorer/shared';
import { ALL_PARAMETERS, PARAMETER_CONFIG } from '../om-marine-explorer/shared';
import { fetchCombinedDataAction } from '../om-marine-explorer/actions';
// Lazy load charts to reduce initial bundle
import MarinePlotsGrid from '@/components/charts/LazyMarinePlotsGrid';
import { useActiveProject } from '@/hooks/use-active-project';
import { LoadPlotViewDialog } from '@/components/pin-data/LoadPlotViewDialog';
import type { SavedPlotView, PlotViewValidationResult } from '@/lib/supabase/plot-view-types';
import { DataTimeline } from '@/components/pin-data/DataTimeline';
import PinMarineDeviceData from '@/components/pin-data/PinMarineDeviceData';
import type { PinFile } from '@/lib/supabase/file-storage-service';
import { getAllUserFilesAction, renameFileAction, deleteFileAction, fetchFileDataAction, downloadFileAction, type UserFileDetails } from './actions';

interface PlotConfig {
  id: string;
  title: string;
}

type ApiLogOverallStatus = 'pending' | 'success' | 'error' | 'idle' | 'warning';

const DataExplorerMapWithNoSSR = dynamic(
  () => import('@/components/map/DataExplorerMap').then(mod => mod.DataExplorerMap),
  {
    ssr: false,
    loading: () => <p className="text-center p-4 text-muted-foreground">Loading map...</p>
  }
);

const DEFAULT_OM_LATITUDE = 51.7128; // Milford Haven
const DEFAULT_OM_LONGITUDE = -5.0341;
const DEFAULT_OM_MAP_ZOOM = 9;

const knownOmLocations: Record<string, { name: string; lat: number; lon: number }> = {
  milfordhaven: { name: "Milford Haven", lat: 51.7128, lon: -5.0341 },
  ramseysound: { name: "Ramsey Sound", lat: 51.871645, lon: -5.313960 },
  bidefordbay: { name: "Bideford Bay", lat: 51.052156, lon: -4.405961 },
  blakeneyoverfalls: { name: "Blakeney Overfalls", lat: 53.028671, lon: 0.939562 },
  pabayinnersound: { name: "Pabay Inner Sound", lat: 57.264780, lon: -5.853793 },
  lochbay: { name: "Loch Bay", lat: 57.506498, lon: -6.620397 },
  lochsunart: { name: "Loch Sunart", lat: 56.666195, lon: -5.917401 },
};
const defaultOmLocationKey = "milfordhaven";


export default function DataExplorerPage() {
  const { toast, dismiss } = useToast();
  const instanceId = useId();

  // Device Data Plot State
  const [plots, setPlots] = useState<PlotConfig[]>([]);
  const plotsInitialized = useRef(false);

  // API Data State (Weather & Marine)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    const from = subDays(today, 7); // 7 days ago
    const to = subDays(today, 1);   // yesterday
    return { from, to };
  });

  const [selectedLocationKey, setSelectedLocationKey] = useState<string>(defaultOmLocationKey);
  const [isApiPlotsExpanded, setIsApiPlotsExpanded] = useState(false);
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  const [mapSelectedCoords, setMapSelectedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [currentLocationName, setCurrentLocationName] = useState<string>("");

  const initialApiPlotVisibility = useMemo(() => {
    return Object.fromEntries(
      ALL_PARAMETERS.map(key => [key, true])
    ) as Record<CombinedParameterKey, boolean>;
  }, []);
  const [apiPlotVisibility, setApiPlotVisibility] = useState<Record<CombinedParameterKey, boolean>>(initialApiPlotVisibility);

  const [apiData, setApiData] = useState<CombinedDataPoint[] | null>(null);
  const [isLoadingApiData, setIsLoadingApiData] = useState(false);
  const [errorApiData, setErrorApiData] = useState<string | null>(null);
  const [apiDataLocationContext, setApiDataLocationContext] = useState<string | null>(null);
  const [apiFetchLogSteps, setApiFetchLogSteps] = useState<ApiLogStep[]>([]);
  const [showApiFetchLogAccordion, setShowApiFetchLogAccordion] = useState<string>("");
  const [isApiLogLoading, setIsApiLogLoading] = useState(false);
  const [apiLogOverallStatus, setApiLogOverallStatus] = useState<ApiLogOverallStatus>('idle');
  const lastApiErrorRef = useRef<string | null>(null);

  // Section visibility states
  const [showDataOverview, setShowDataOverview] = useState(false);
  const [showMarineMeteoData, setShowMarineMeteoData] = useState(false);
  const [showMarineDeviceData, setShowMarineDeviceData] = useState(false);
  const [showSavedPlots, setShowSavedPlots] = useState(true);
  const initialApiFetchDone = useRef(false);

  // Project context for saved plots
  const { activeProject: persistentActiveProject, setActiveProject: setPersistentActiveProject, isLoading: isLoadingActiveProject } = useActiveProject();
  const activeProjectId = persistentActiveProject || 'default';

  // Saved Plots Dialog state
  const [showLoadPlotViewDialog, setShowLoadPlotViewDialog] = useState(false);
  const [savedPlots, setSavedPlots] = useState<SavedPlotView[]>([]);
  const [plotToDelete, setPlotToDelete] = useState<SavedPlotView | null>(null);
  const [plotToShowInfo, setPlotToShowInfo] = useState<SavedPlotView | null>(null);
  const [deletingPlotId, setDeletingPlotId] = useState<string | null>(null);

  // User Files State for DataTimeline
  const [userFiles, setUserFiles] = useState<UserFileDetails[]>([]);
  const [isLoadingUserFiles, setIsLoadingUserFiles] = useState(false);

  // Marine Device Modal State (for plot display)
  const [showMarineDeviceModal, setShowMarineDeviceModal] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<'GP' | 'FPOD' | 'Subcam' | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPinLocation, setSelectedPinLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [selectedObjectName, setSelectedObjectName] = useState<string | undefined>(undefined);

  // Home Location Logic
  useEffect(() => {
    try {
      const savedHome = localStorage.getItem('pebl-home-location');
      if (savedHome) {
        const { key, name, lat, lon } = JSON.parse(savedHome);
        setSelectedLocationKey(key);
        setCurrentLocationName(name);
        setMapSelectedCoords({ lat, lon });
      } else {
        // Set default if no home location
        const defaultLoc = knownOmLocations[defaultOmLocationKey];
        setSelectedLocationKey(defaultOmLocationKey);
        setCurrentLocationName(defaultLoc.name);
        setMapSelectedCoords({ lat: defaultLoc.lat, lon: defaultLoc.lon });
      }
    } catch (e) {
        console.error("Could not read home location from localStorage", e);
        // Fallback to default
        const defaultLoc = knownOmLocations[defaultOmLocationKey];
        setSelectedLocationKey(defaultOmLocationKey);
        setCurrentLocationName(defaultLoc.name);
        setMapSelectedCoords({ lat: defaultLoc.lat, lon: defaultLoc.lon });
    }
  }, []);

  const setHomeLocation = useCallback(() => {
    if (mapSelectedCoords) {
      const homeLocation = {
        key: selectedLocationKey,
        name: currentLocationName,
        lat: mapSelectedCoords.lat,
        lon: mapSelectedCoords.lon,
      };
      try {
        localStorage.setItem('pebl-home-location', JSON.stringify(homeLocation));
        toast({ title: "Home Location Set", description: `${currentLocationName} is now your default location.` });
      } catch (e) {
        console.error("Could not save home location to localStorage", e);
        toast({ variant: "destructive", title: "Could Not Set Home", description: "Your browser may be blocking local storage." });
      }
    }
  }, [mapSelectedCoords, selectedLocationKey, currentLocationName, toast]);

  // Load saved plots for current project
  useEffect(() => {
    const loadSavedPlots = async () => {
      if (!activeProjectId) return;

      try {
        const { plotViewService } = await import('@/lib/supabase/plot-view-service');
        const result = await plotViewService.listPlotViews(activeProjectId);

        if (result.success && result.data) {
          setSavedPlots(result.data);
        }
      } catch (error) {
        console.error('Error loading saved plots:', error);
      }
    };

    loadSavedPlots();
  }, [activeProjectId]);

  // Handle loading a saved plot view - redirect to map-drawing page
  const handleLoadPlotView = useCallback((view: SavedPlotView, validation: PlotViewValidationResult) => {
    console.log('📂 [DATA-EXPLORER] Loading plot view:', view.name);
    console.log('📂 [DATA-EXPLORER] View details:', {
      id: view.id,
      name: view.name,
      createdAt: view.created_at,
      totalPlots: view.view_config.metadata.totalPlots,
      validationValid: validation.valid
    });

    console.log('➡️ [DATA-EXPLORER] Preparing to redirect to map-drawing page...');

    // Store the view to be loaded
    try {
      const dataToStore = {
        viewId: view.id,
        viewName: view.name,
        timestamp: Date.now()
      };

      console.log('💾 [DATA-EXPLORER] Storing in sessionStorage:', dataToStore);

      sessionStorage.setItem('pebl-load-plot-view', JSON.stringify(dataToStore));

      console.log('✅ [DATA-EXPLORER] Successfully stored in sessionStorage');
      console.log('🔄 [DATA-EXPLORER] Initiating redirect to /map-drawing...');

      // Redirect to map-drawing page
      window.location.href = '/map-drawing';

      toast({
        title: "Redirecting...",
        description: `Loading "${view.name}" in Map Drawing page`,
        duration: 2000
      });
    } catch (error) {
      console.error('❌ [DATA-EXPLORER] Failed to store view for loading:', error);
      toast({
        variant: "destructive",
        title: "Navigation Error",
        description: "Failed to redirect to Map Drawing page"
      });
    }
  }, [toast]);

  // Handle opening a plot directly from the card
  const handleOpenPlot = useCallback(async (plot: SavedPlotView) => {
    console.log('📂 Opening plot:', plot.name);

    try {
      const { plotViewService } = await import('@/lib/supabase/plot-view-service');
      const validation = await plotViewService.validatePlotView(plot.view_config);

      if (!validation.valid) {
        toast({
          variant: "destructive",
          title: "Cannot Open Plot",
          description: "This plot references files that are no longer available"
        });
        return;
      }

      handleLoadPlotView(plot, validation);
    } catch (error) {
      console.error('Error opening plot:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to open plot"
      });
    }
  }, [handleLoadPlotView, toast]);

  // Handle deleting a plot
  const handleDeletePlot = useCallback(async () => {
    if (!plotToDelete) return;

    setDeletingPlotId(plotToDelete.id);

    try {
      const { plotViewService } = await import('@/lib/supabase/plot-view-service');
      const result = await plotViewService.deletePlotView(plotToDelete.id);

      if (result.success) {
        toast({
          title: "Plot Deleted",
          description: `"${plotToDelete.name}" has been deleted`
        });

        // Remove from local state
        setSavedPlots(prev => prev.filter(p => p.id !== plotToDelete.id));
      } else {
        toast({
          variant: "destructive",
          title: "Delete Failed",
          description: result.error || "Failed to delete plot"
        });
      }
    } catch (error) {
      console.error('Error deleting plot:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred"
      });
    } finally {
      setDeletingPlotId(null);
      setPlotToDelete(null);
    }
  }, [plotToDelete, toast]);

  // Load user files on mount
  useEffect(() => {
    const loadUserFiles = async () => {
      setIsLoadingUserFiles(true);
      try {
        const result = await getAllUserFilesAction();
        if (result.success && result.data) {
          setUserFiles(result.data);
        } else {
          console.error('Failed to load user files:', result.error);
        }
      } catch (error) {
        console.error('Error loading user files:', error);
      } finally {
        setIsLoadingUserFiles(false);
      }
    };

    loadUserFiles();
  }, []);

  // Transform userFiles to DataTimeline format
  const filesForTimeline = useMemo<(PinFile & { pinLabel: string })[]>(() => {
    return userFiles.map((file) => ({
      id: file.id,
      pinId: file.pinId,
      fileName: file.fileName,
      filePath: '', // Not needed for display
      fileSize: 0, // Not available from UserFileDetails
      fileType: file.deviceType,
      uploadedAt: file.uploadedAt,
      projectId: file.projectId || 'default', // Provide default if null
      startDate: file.startDate || undefined,
      endDate: file.endDate || undefined,
      pinLabel: file.objectLabel || 'Unknown Pin',
      isDiscrete: false,
      fileSource: file.fileSource, // Preserve fileSource to identify merged files
    } as any));
  }, [userFiles]);

  // File operation callbacks for DataTimeline
  const handleFileClick = useCallback(async (file: PinFile & { pinLabel: string }) => {
    try {
      // Determine file type from filename
      // Map all file types to supported plot types: GP, FPOD, or Subcam
      // CROP, CHEM, CHEMSW, CHEMWQ, and WQ are treated as GP for plotting
      let fileType: 'GP' | 'FPOD' | 'Subcam' = 'GP';

      const parts = file.fileName.split('_');
      const position0 = parts[0]?.toLowerCase() || '';
      const position1 = parts[1]?.toLowerCase() || '';
      const fileNameLower = file.fileName.toLowerCase();

      if (position0.includes('fpod') || position1.includes('fpod')) {
        fileType = 'FPOD';
      } else if (position0.includes('subcam') || position1.includes('subcam')) {
        fileType = 'Subcam';
      } else {
        // Default to GP for all other types (including CROP, CHEM, CHEMSW, CHEMWQ, WQ)
        fileType = 'GP';
      }

      // Check if this is a merged file
      const isMergedFile = (file as any).fileSource === 'merged';
      let blob: Blob;
      let fileName: string;

      if (isMergedFile) {
        // For merged files, we need to get the file_path from merged_files table and download
        console.log('Opening merged file:', file.id);
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        // Get merged file metadata
        const { data: mergedFileData, error: getError } = await supabase
          .from('merged_files')
          .select('file_path, file_name')
          .eq('id', file.id)
          .single();

        if (getError || !mergedFileData) {
          console.error('Error fetching merged file:', getError);
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to fetch merged file metadata"
          });
          return;
        }

        if (!mergedFileData.file_path) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Merged file path not found"
          });
          return;
        }

        // Download merged file from storage
        const { data: downloadData, error: downloadError } = await supabase.storage
          .from('pin-files')
          .download(mergedFileData.file_path);

        if (downloadError || !downloadData) {
          console.error('Error downloading merged file:', downloadError);
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: downloadError?.message || "Could not download merged file from storage."
          });
          return;
        }

        blob = downloadData;
        fileName = mergedFileData.file_name;
      } else {
        // For regular files, use the downloadFileAction
        const result = await downloadFileAction(file.id);

        if (!result.success || !result.data) {
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: result.error || "Could not download file from storage."
          });
          return;
        }

        blob = result.data.blob;
        fileName = result.data.fileName;
      }

      // Convert blob to File object
      const actualFile = new File([blob], fileName, {
        type: file.fileType || 'text/csv'
      });

      // Fetch pin/area location for marine data
      console.log('[Data Explorer] 🔍 Starting location fetch for file:', {
        fileName: file.fileName,
        pinId: file.pinId,
        pinLabel: file.pinLabel,
        isMergedFile,
        fileId: file.id
      });

      let location: { lat: number; lng: number } | undefined = undefined;
      let objectName: string | undefined = file.pinLabel || undefined;

      // Fetch pin location if pinId exists (now works for merged files too since they have actual pinIds)
      if (file.pinId) {
        console.log('[Data Explorer] 📍 Fetching pin location for:', file.pinId);
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        // Check if it's a pin or area by checking both tables
        const { data: pinData } = await supabase
          .from('pins')
          .select('latitude, longitude, label')
          .eq('id', file.pinId)
          .single();

        if (pinData && pinData.latitude && pinData.longitude) {
          location = { lat: pinData.latitude, lng: pinData.longitude };
          objectName = pinData.label || objectName;
          console.log('[Data Explorer] ✅ Found pin location:', location);
        } else {
          // Try fetching as an area
          const { data: areaData } = await supabase
            .from('areas')
            .select('path, name')
            .eq('id', file.pinId) // pinId might actually be an areaId
            .single();

          if (areaData && areaData.path && Array.isArray(areaData.path) && areaData.path.length > 0) {
            // Calculate centroid of area polygon
            const centroid = areaData.path.reduce(
              (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
              { lat: 0, lng: 0 }
            );
            location = {
              lat: centroid.lat / areaData.path.length,
              lng: centroid.lng / areaData.path.length
            };
            objectName = areaData.name || objectName;
            console.log('[Data Explorer] ✅ Found area location (centroid):', location);
          } else {
            console.warn('[Data Explorer] ⚠️ No location found for pin/area:', file.pinId);
          }
        }
      } else if (isMergedFile) {
        console.log('[Data Explorer] ℹ️ Merged file - no specific location');
      } else {
        console.log('[Data Explorer] ⚠️ Skipping location fetch - pinId:', file.pinId);
      }

      // Store location and object name
      console.log('[Data Explorer] 💾 Setting location state:', {
        location,
        objectName
      });

      // TEMPORARY TEST: Force a known location for debugging
      const testLocation = { lat: 51.7128, lng: -5.0341 }; // Milford Haven
      console.log('[Data Explorer] 🧪 TEST: Forcing test location:', testLocation);

      setSelectedPinLocation(testLocation);  // Use test location
      setSelectedObjectName(objectName || 'Test Location');

      // Open modal with the downloaded file
      setSelectedFileType(fileType);
      setSelectedFiles([actualFile]);
      setShowMarineDeviceModal(true);
    } catch (error) {
      console.error('Error opening file:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open file."
      });
    }
  }, [toast]);

  const handleDeleteFile = useCallback(async (file: PinFile & { pinLabel: string }) => {
    try {
      // Check if this is a merged file
      const isMergedFile = (file as any).fileSource === 'merged';

      let result;
      if (isMergedFile) {
        console.log('Deleting merged file:', file.id);
        const { deleteMergedFileAction } = await import('@/app/api/merged-files/actions');
        result = await deleteMergedFileAction(file.id);
      } else {
        console.log('Deleting regular file:', file.id);
        result = await deleteFileAction(file.id);
      }

      if (result.success) {
        toast({
          title: "File Deleted",
          description: `${file.fileName} has been deleted successfully`
        });
        // Reload files
        setUserFiles(prev => prev.filter(f => f.id !== file.id));
      } else {
        toast({
          variant: "destructive",
          title: "Delete Failed",
          description: result.error || "Failed to delete file"
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete file"
      });
    }
  }, [toast]);

  const handleRenameFile = useCallback(async (file: PinFile & { pinLabel: string }, newName: string): Promise<boolean> => {
    try {
      // Check if this is a merged file
      const isMergedFile = (file as any).fileSource === 'merged';

      let result;
      if (isMergedFile) {
        console.log('Renaming merged file:', file.id);
        const { renameMergedFileAction } = await import('@/app/api/merged-files/actions');
        result = await renameMergedFileAction(file.id, newName);
      } else {
        console.log('Renaming regular file:', file.id);
        result = await renameFileAction(file.id, newName);
      }

      if (result.success) {
        toast({
          title: "File Renamed",
          description: `File renamed to ${newName}`
        });
        // Update local state
        setUserFiles(prev => prev.map(f =>
          f.id === file.id ? { ...f, fileName: newName } : f
        ));
        return true;
      } else {
        toast({
          variant: "destructive",
          title: "Rename Failed",
          description: result.error || "Failed to rename file"
        });
        return false;
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to rename file"
      });
      return false;
    }
  }, [toast]);

  const getFileDateRange = useCallback(async (file: PinFile) => {
    // For data explorer, dates should already be in the database
    // Return empty if not available
    return {
      totalDays: null,
      startDate: null,
      endDate: null,
      error: 'Date range not available for this file'
    };
  }, []);

  // Download file handler for PinMarineDeviceData
  const handleDownloadFileForPlot = useCallback(async (pinId: string, fileName: string): Promise<File | null> => {
    try {
      // Find the file in our files list
      const fileToDownload = filesForTimeline.find(
        f => f.pinId === pinId && f.fileName === fileName
      );

      if (!fileToDownload) {
        console.error('File not found:', { pinId, fileName });
        toast({
          variant: "destructive",
          title: "File Not Found",
          description: `Could not find ${fileName} in the file list`
        });
        return null;
      }

      // Check if this is a merged file
      const isMergedFile = (fileToDownload as any).fileSource === 'merged';
      let blob: Blob;
      let downloadedFileName: string;

      if (isMergedFile) {
        console.log('Downloading merged file for plot:', fileToDownload.id);
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        // Get merged file metadata
        const { data: mergedFileData, error: getError } = await supabase
          .from('merged_files')
          .select('file_path, file_name')
          .eq('id', fileToDownload.id)
          .single();

        if (getError || !mergedFileData || !mergedFileData.file_path) {
          console.error('Error fetching merged file:', getError);
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: "Could not fetch merged file metadata"
          });
          return null;
        }

        // Download merged file from storage
        const { data: downloadData, error: downloadError } = await supabase.storage
          .from('pin-files')
          .download(mergedFileData.file_path);

        if (downloadError || !downloadData) {
          console.error('Error downloading merged file:', downloadError);
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: "Could not download merged file from storage"
          });
          return null;
        }

        blob = downloadData;
        downloadedFileName = mergedFileData.file_name;
      } else {
        // For regular files, use the downloadFileAction
        console.log('Downloading regular file for plot:', fileToDownload.id);
        const result = await downloadFileAction(fileToDownload.id);

        if (!result.success || !result.data) {
          console.error('Download failed:', result.error);
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: result.error || "Could not download file"
          });
          return null;
        }

        blob = result.data.blob;
        downloadedFileName = result.data.fileName;
      }

      // Convert blob to File object
      const file = new File([blob], downloadedFileName, {
        type: fileToDownload.fileType || 'text/csv'
      });

      console.log('✅ File downloaded successfully for plot:', downloadedFileName);
      return file;
    } catch (error) {
      console.error('Error in handleDownloadFileForPlot:', error);
      toast({
        variant: "destructive",
        title: "Download Error",
        description: error instanceof Error ? error.message : "Failed to download file"
      });
      return null;
    }
  }, [filesForTimeline, toast]);

  const plotConfigIcons: Record<CombinedParameterKey, LucideIcon | undefined> = useMemo(() => {
    const icons: Partial<Record<CombinedParameterKey, LucideIcon>> = {};
    ALL_PARAMETERS.forEach(key => {
      const config = PARAMETER_CONFIG[key as CombinedParameterKey];
      if (config && config.icon) {
        icons[key] = config.icon;
      } else {
        if (key === 'seaLevelHeightMsl') icons[key] = Waves;
        else if (key === 'waveHeight') icons[key] = Sailboat;
        else if (key === 'waveDirection') icons[key] = CompassIcon;
        else if (key === 'wavePeriod') icons[key] = TimerIcon;
        else if (key === 'seaSurfaceTemperature') icons[key] = Thermometer;
        else if (key === 'temperature2m') icons[key] = Thermometer;
        else if (key === 'windSpeed10m') icons[key] = WindIcon;
        else if (key === 'windDirection10m') icons[key] = CompassIcon;
        else if (key === 'ghi') icons[key] = CloudSun;
        else icons[key] = Info;
      }
    });
    return icons as Record<CombinedParameterKey, LucideIcon | undefined>;
  }, []);




  // Device Data Plot Logic
  const addPlot = useCallback(() => {
    setPlots((prevPlots) => [
      ...prevPlots,
      { id: `plot-${Date.now()}-${prevPlots.length}`, title: `Device Data Plot ${prevPlots.length + 1}` },
    ]);
  }, []);

  const removePlot = useCallback((idToRemove: string) => {
    setPlots((prevPlots) => prevPlots.filter((plot) => plot.id !== idToRemove));
  }, []);

  useEffect(() => {
    if (!plotsInitialized.current && plots.length === 0) {
      addPlot();
      plotsInitialized.current = true;
    }
  }, [addPlot, plots.length]);

  // API Location & Parameter Logic
  const handleLocationChange = useCallback((newKey: string) => {
    if (newKey === "__custom__") return; // Ignore if "Custom Location" is somehow selected

    setSelectedLocationKey(newKey);
    const selectedLoc = knownOmLocations[newKey];
    if (selectedLoc) {
      setMapSelectedCoords({ lat: selectedLoc.lat, lon: selectedLoc.lon });
      setCurrentLocationName(selectedLoc.name);
      toast({ title: "Location Selected", description: `${selectedLoc.name} (Lat: ${selectedLoc.lat.toFixed(3)}, Lon: ${selectedLoc.lon.toFixed(3)})`, duration: 3000 });
    }
  }, [toast]);

  const handleMapLocationSelect = useCallback((coords: { lat: number; lon: number }) => {
    setMapSelectedCoords(coords);
    let matchedKey = "";
    for (const key in knownOmLocations) {
      if (knownOmLocations[key].lat.toFixed(3) === coords.lat.toFixed(3) && knownOmLocations[key].lon.toFixed(3) === coords.lon.toFixed(3)) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      setSelectedLocationKey(matchedKey);
      setCurrentLocationName(knownOmLocations[matchedKey].name);
      toast({ title: "Location Selected on Map", description: `${knownOmLocations[matchedKey].name} (Lat: ${coords.lat.toFixed(3)}, Lon: ${coords.lon.toFixed(3)})`, duration: 3000 });
    } else {
      setSelectedLocationKey("__custom__"); // Special key for custom map selection
      setCurrentLocationName("Custom Location");
      toast({ title: "Custom Location Selected on Map", description: `Lat: ${coords.lat.toFixed(3)}, Lon: ${coords.lon.toFixed(3)})`, duration: 3000 });
    }
  }, [toast]);


  const handleFetchApiData = useCallback(async (isInitialLoad = false) => {
    if (!mapSelectedCoords) {
      if (!isInitialLoad) toast({ variant: "destructive", title: "Missing Location", description: "Please select a location." });
      return;
    }
    if (!dateRange || !dateRange.from || !dateRange.to) {
      if (!isInitialLoad) toast({ variant: "destructive", title: "Missing Date Range", description: "Please select a valid date range." });
      return;
    }
    if (dateRange.from > dateRange.to) {
      if (!isInitialLoad) toast({ variant: "destructive", title: "Invalid Date Range", description: "Start date cannot be after end date." });
      return;
    }
    const selectedParams = ALL_PARAMETERS.filter(key => apiPlotVisibility[key as CombinedParameterKey]);
    if (selectedParams.length === 0) {
      if (!isInitialLoad) toast({ variant: "destructive", title: "No API Parameters Selected", description: "Please select at least one API parameter to fetch." });
      return;
    }

    setIsLoadingApiData(true); setErrorApiData(null); setApiData(null); setApiDataLocationContext(null);
    setApiFetchLogSteps([{ message: `Fetching ${selectedParams.length} parameter(s) for ${currentLocationName}...`, status: 'pending' }]);
    lastApiErrorRef.current = null;
    setIsApiLogLoading(true); setApiLogOverallStatus('pending'); setShowApiFetchLogAccordion("api-fetch-log-item");

    let loadingToastId: string | undefined;
    if (!isInitialLoad) {
      loadingToastId = toast({ title: "Fetching API Data", description: `Fetching for ${currentLocationName}...` }).id;
    }

    try {
      const result = await fetchCombinedDataAction({
        latitude: mapSelectedCoords.lat,
        longitude: mapSelectedCoords.lon,
        startDate: formatISO(dateRange.from, { representation: 'date' }),
        endDate: formatISO(dateRange.to, { representation: 'date' }),
        parameters: selectedParams,
      });

      if (loadingToastId) dismiss(loadingToastId);
      setApiFetchLogSteps(result.log || []);
      setIsApiLogLoading(false); 

      if (result.success && result.data) {
        setApiData(result.data);
        setApiDataLocationContext(result.dataLocationContext || `API Data for ${currentLocationName}`);
        if (result.data.length === 0 && !result.error) {
          toast({ variant: "default", title: "No API Data", description: "No data points found for the selected criteria.", duration: 4000 });
          setApiLogOverallStatus('warning');
          setShowApiFetchLogAccordion("api-fetch-log-item");
        } else if (result.data.length > 0) {
          if (!isInitialLoad) {
            toast({ title: "API Data Loaded", description: `Loaded ${result.data.length} API data points for ${currentLocationName}.` });
          }
          setApiLogOverallStatus('success');
          if (result.log && result.log.every(l => l.status !== 'error' && l.status !== 'warning')) {
            setShowApiFetchLogAccordion("");
          } else {
            setShowApiFetchLogAccordion("api-fetch-log-item");
          }
        } else { 
           setErrorApiData(result.error || "Failed to load API data.");
           lastApiErrorRef.current = result.error || "Failed to load API data.";
           toast({ variant: "destructive", title: "Error Loading API Data", description: result.error || "Failed to load API data." });
           setApiLogOverallStatus('error');
           setShowApiFetchLogAccordion("api-fetch-log-item");
        }
      } else {
        setErrorApiData(result.error || "Failed to load API data.");
        lastApiErrorRef.current = result.error || "Failed to load API data.";
        toast({ variant: "destructive", title: "Error Loading API Data", description: result.error || "Failed to load API data." });
        setApiLogOverallStatus('error');
        setShowApiFetchLogAccordion("api-fetch-log-item");
      }
    } catch (e) {
      if (loadingToastId) dismiss(loadingToastId);
      setIsLoadingApiData(false); setIsApiLogLoading(false);
      const errorMsg = e instanceof Error ? e.message : "An unknown error occurred during API fetch.";
      setErrorApiData(errorMsg);
      lastApiErrorRef.current = errorMsg;
      setApiFetchLogSteps(prev => [...prev, { message: `Critical error in API fetch operation: ${errorMsg}`, status: 'error' }]);
      toast({ variant: "destructive", title: "Critical API Fetch Error", description: errorMsg });
      setApiLogOverallStatus('error');
      setShowApiFetchLogAccordion("api-fetch-log-item");
    } finally {
       setIsLoadingApiData(false);
       setIsApiLogLoading(false);
    }
  }, [mapSelectedCoords, currentLocationName, dateRange, apiPlotVisibility, toast, dismiss]);

  useEffect(() => {
    if (!initialApiFetchDone.current) {
      if (mapSelectedCoords && currentLocationName && dateRange?.from && dateRange?.to) {
        const selectedParamsOnInit = ALL_PARAMETERS.filter(key => initialApiPlotVisibility[key as CombinedParameterKey]);
        if (selectedParamsOnInit.length > 0) {
          handleFetchApiData(true);
          initialApiFetchDone.current = true;
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSelectedCoords, currentLocationName, dateRange, handleFetchApiData, initialApiPlotVisibility]);


  const handleApiPlotVisibilityChange = useCallback((key: CombinedParameterKey, checked: boolean) => {
    setApiPlotVisibility(prev => ({ ...prev, [key]: checked }));
  }, []);

  const allApiParamsSelected = useMemo(() => ALL_PARAMETERS.every(key => apiPlotVisibility[key as CombinedParameterKey]), [apiPlotVisibility]);

  const handleSelectAllApiParams = useCallback((checked: boolean) => {
    setApiPlotVisibility(Object.fromEntries(ALL_PARAMETERS.map(key => [key, checked])) as Record<CombinedParameterKey, boolean>);
  }, []);

  const getLogTriggerContent = useCallback((status: ApiLogOverallStatus, isLoading: boolean, defaultTitle: string, lastError?: string | null) => {
    if (isLoading) return <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Fetching log...</>;
    if (status === 'success') return <><CheckCircle2 className="mr-2 h-3 w-3 text-green-500" />{defaultTitle}: Success</>;
    if (status === 'error') return <><XCircle className="mr-2 h-3 w-3 text-destructive" />{defaultTitle}: Failed {lastError ? `(${lastError.substring(0, 30)}...)` : ''}</>;
    if (status === 'pending') return <><Loader2 className="mr-2 h-3 w-3 animate-spin" />{defaultTitle}: In Progress</>;
    if (status === 'warning') return <><Info className="mr-2 h-3 w-3 text-yellow-500" />{defaultTitle}: Warning {lastError ? `(${lastError.substring(0,30)}...)` : ''}</>;
    return <><Info className="mr-2 h-3 w-3 text-muted-foreground" />{defaultTitle}</>;
  }, []);

  const getLogAccordionItemClass = useCallback((status: ApiLogOverallStatus) => {
    if (status === 'pending') return "bg-blue-500/5 dark:bg-blue-500/10";
    if (status === 'success') return "bg-green-500/5 dark:bg-green-500/10";
    if (status === 'error') return "bg-destructive/10 dark:bg-destructive/20";
    if (status === 'warning') return "bg-yellow-500/5 dark:bg-yellow-500/10";
    return "";
  }, []);

  const handleCopyLog = useCallback((logSteps: ApiLogStep[]) => {
    if (logSteps.length === 0) {
      toast({ title: "Log Empty", description: "There are no log messages to copy.", duration: 3000 });
      return;
    }
    const logText = logSteps
      .map(step => `[${step.status.toUpperCase()}] ${step.message}${step.details ? `\n  Details: ${step.details}` : ''}`)
      .join('\n\n');
    navigator.clipboard.writeText(logText)
      .then(() => toast({ title: "Log Copied", description: "Fetch log copied to clipboard.", duration: 3000 }))
      .catch(err => {
        console.error('Failed to copy log: ', err);
        toast({ variant: "destructive", title: "Copy Failed", description: "Could not copy log to clipboard.", duration: 3000 });
      });
  }, [toast]);
  
  const renderLogAccordion = useCallback((
    logSteps: ApiLogStep[],
    accordionValue: string,
    onValueChange: (value: string) => void,
    isLoadingFlag: boolean,
    overallStatus: ApiLogOverallStatus,
    title: string,
    lastError?: string | null
  ) => {
    return (
      (isLoadingFlag || logSteps.length > 0 || overallStatus === 'error' || overallStatus === 'warning') && (
        <CardFooter className="p-0 pt-2 flex flex-col items-stretch">
          <Accordion type="single" collapsible value={accordionValue} onValueChange={onValueChange} className="w-full">
            <AccordionItem value={title.toLowerCase().replace(/\s+/g, '-') + "-log-item"} className={cn("border rounded-md", getLogAccordionItemClass(overallStatus))}>
              <AccordionTrigger className="px-3 py-1.5 text-xs hover:no-underline [&_svg.lucide-chevron-down]:h-3 [&_svg.lucide-chevron-down]:w-3">
                {getLogTriggerContent(overallStatus, isLoadingFlag, title, lastError)}
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-1 pt-0">
                <ScrollArea className="max-h-[35rem] h-auto w-full rounded-md border bg-muted/30 dark:bg-muted/10 p-1.5 mt-1">
                  <ul className="space-y-1 text-[0.7rem]">
                    {logSteps.map((step, index) => (
                      <li key={index} className="flex items-start gap-1.5">
                        {step.status === 'pending' && <Loader2 className="h-3 w-3 mt-0.5 text-blue-500 animate-spin flex-shrink-0" />}
                        {step.status === 'success' && <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />}
                        {step.status === 'error' && <XCircle className="h-3 w-3 mt-0.5 text-destructive flex-shrink-0" />}
                        {step.status === 'info' && <Info className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />}
                        {step.status === 'warning' && <Info className="h-3 w-3 mt-0.5 text-yellow-500 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className={cn("break-words", step.status === 'error' && "text-destructive font-semibold", step.status === 'warning' && "text-yellow-600 dark:text-yellow-400")}>{step.message}</p>
                          {step.details && <p className="text-muted-foreground text-[0.6rem] whitespace-pre-wrap break-all">{step.details}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {logSteps.length === 0 && !isLoadingFlag && <p className="text-center text-muted-foreground text-[0.65rem] py-2">No log details for this operation.</p>}
                </ScrollArea>
                {logSteps.length > 0 && !isLoadingFlag && (
                  <div className="w-full flex justify-end mt-2">
                    <Button variant="outline" size="sm" onClick={() => handleCopyLog(logSteps)} className="h-7 text-xs">
                      <Copy className="mr-1.5 h-3 w-3" /> Copy Log
                    </Button>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardFooter>
      )
    );
  }, [getLogTriggerContent, getLogAccordionItemClass, handleCopyLog]);

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <main className="flex-grow container mx-auto p-2 sm:p-3 space-y-3">
        
        {/* Data Overview Section */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5 font-futura">
                  <Database className="h-4 w-4 text-primary" />
                  Data Overview
                </CardTitle>
                <p className="text-xs text-muted-foreground pebl-body-main">
                  Overview of all uploaded files and their associations
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDataOverview(!showDataOverview)}
                className="h-8 px-3 text-xs"
              >
                {showDataOverview ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                {showDataOverview ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showDataOverview && (
            <CardContent className="p-3">
              {isLoadingUserFiles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading files...</span>
                </div>
              ) : filesForTimeline.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 border rounded-md bg-muted/20">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">No uploaded files found</p>
                  <p className="text-sm">Upload device data files in the Map Drawing page to see them here</p>
                </div>
              ) : (
                <DataTimeline
                  files={filesForTimeline}
                  getFileDateRange={getFileDateRange}
                  onFileClick={handleFileClick}
                  onDeleteFile={handleDeleteFile}
                  onRenameFile={handleRenameFile}
                />
              )}
            </CardContent>
          )}
        </Card>

        {/* Saved Plots Section */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5 font-futura">
                  <Bookmark className="h-4 w-4 text-primary" />
                  Saved Plots
                </CardTitle>
                <p className="text-xs text-muted-foreground pebl-body-main">
                  Quick access to your saved plot configurations
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSavedPlots(!showSavedPlots)}
                className="h-8 px-3 text-xs"
              >
                {showSavedPlots ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                {showSavedPlots ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showSavedPlots && (
            <CardContent className="p-3">
              {isLoadingActiveProject ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                  <span className="text-sm text-muted-foreground">Loading saved plots...</span>
                </div>
              ) : !activeProjectId ? (
                <div className="text-center py-8">
                  <Info className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No project selected</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Visit the map-drawing page to create and manage projects
                  </p>
                </div>
              ) : savedPlots.length === 0 ? (
                <div className="text-center py-8">
                  <FolderOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-sm font-medium text-muted-foreground">No saved plots yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Save plot configurations from the map-drawing page to see them here
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground">
                      {savedPlots.length} saved {savedPlots.length === 1 ? 'plot' : 'plots'} available
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLoadPlotViewDialog(true)}
                      className="h-7 text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1.5" />
                      View All
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {savedPlots.slice(0, 6).map((plot) => (
                      <Card key={plot.id} className="hover:bg-accent/50 transition-colors">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium truncate" title={plot.name}>
                                {plot.name}
                              </h4>
                              {plot.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                  {plot.description}
                                </p>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                  disabled={deletingPlotId === plot.id}
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleOpenPlot(plot)}>
                                  <FolderOpenDot className="h-3.5 w-3.5 mr-2" />
                                  Open
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setPlotToShowInfo(plot)}>
                                  <Info className="h-3.5 w-3.5 mr-2" />
                                  Info
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPlotToDelete(plot)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="space-y-1.5 mt-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{format(new Date(plot.created_at), 'MMM d, yyyy h:mm a')}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {plot.view_config.metadata.totalPlots} {plot.view_config.metadata.totalPlots === 1 ? 'plot' : 'plots'}
                              </span>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleOpenPlot(plot)}
                                className="h-6 text-xs"
                                disabled={deletingPlotId === plot.id}
                              >
                                Open
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {savedPlots.length > 6 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLoadPlotViewDialog(true)}
                      className="w-full h-8 text-xs mt-2"
                    >
                      View {savedPlots.length - 6} more saved {savedPlots.length - 6 === 1 ? 'plot' : 'plots'}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Marine & Meteorological Data Section - Now Collapsible */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5 font-futura">
                  <Waves className="h-4 w-4 text-primary" />
                  Marine & Meteorological Data
                </CardTitle>
                <p className="text-xs text-muted-foreground pebl-body-main">
                  Advanced ocean data visualization for ecological monitoring
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMarineMeteoData(!showMarineMeteoData)}
                className="h-8 px-3 text-xs"
              >
                {showMarineMeteoData ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                {showMarineMeteoData ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showMarineMeteoData && (
          <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
            {!isApiPlotsExpanded && (
              <div className="lg:col-span-4 space-y-3">
                  <Card>
                      <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1.5 font-futura font-semibold"><MapPin className="h-4 w-4 text-primary"/>Marine Location & Data Range</CardTitle></CardHeader>
                      <CardContent className="space-y-2 p-3">
                          <div>
                              <UiLabel htmlFor={`om-location-select-${instanceId}`} className="text-xs font-medium mb-0.5 block">Select Location</UiLabel>
                              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <Select
                                    value={selectedLocationKey}
                                    onValueChange={handleLocationChange}
                                    disabled={isLoadingApiData}
                                >
                                    <SelectTrigger id={`om-location-select-${instanceId}`} className="h-9 text-xs flex-1">
                                        <SelectValue placeholder="Select a location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(knownOmLocations).map(([key, loc]) => (
                                            <SelectItem key={key} value={key} className="text-xs">
                                                {loc.name}
                                            </SelectItem>
                                        ))}
                                        {selectedLocationKey === "__custom__" && (
                                            <SelectItem value="__custom__" disabled className="text-xs font-medium">
                                              {currentLocationName}
                                            </SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                                <div className="flex gap-2 flex-shrink-0">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={setHomeLocation} disabled={!mapSelectedCoords} aria-label="Set as Home Location">
                                            <Home className="h-4 w-4"/>
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent><p>Set as Home Location</p></TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <Button 
                                    variant="outline" 
                                    onClick={() => setIsMapExpanded(!isMapExpanded)}
                                    className="h-9 text-xs whitespace-nowrap"
                                  >
                                    Custom
                                  </Button>
                                </div>
                              </div>
                          </div>

                          {isMapExpanded && (
                            <div className="space-y-2 pt-2">
                                <UiLabel htmlFor={`om-map-container-${instanceId}`} className="text-xs font-medium mb-0.5 block pt-1">Click Map to Select Location</UiLabel>
                                <div id={`om-map-container-${instanceId}`} className="h-[240px] sm:h-[180px] w-full rounded-md overflow-hidden border">
                                <DataExplorerMapWithNoSSR
                                    initialCenter={mapSelectedCoords ? [mapSelectedCoords.lon, mapSelectedCoords.lat] : [DEFAULT_OM_LONGITUDE, DEFAULT_OM_LATITUDE]}
                                    initialZoom={DEFAULT_OM_MAP_ZOOM}
                                    selectedCoords={mapSelectedCoords}
                                    onLocationSelect={handleMapLocationSelect}
                                />
                                </div>
                                {mapSelectedCoords && (
                                <p className="text-xs text-muted-foreground text-center">
                                    {currentLocationName} (Lat: {mapSelectedCoords.lat.toFixed(3)}, Lon: {mapSelectedCoords.lon.toFixed(3)})
                                </p>
                                )}
                            </div>
                           )}

                          <div className="pt-2">
                            <UiLabel htmlFor={`om-date-range-${instanceId}`} className="text-xs font-medium mb-0.5 block">Date Range</UiLabel>
                            <DatePickerWithRange id={`om-date-range-${instanceId}`} date={dateRange} onDateChange={setDateRange} disabled={isLoadingApiData} />
                            {dateRange?.from && dateRange?.to && dateRange.from > dateRange.to && <p className="text-xs text-destructive px-1 pt-1">Start date error.</p>}
                          </div>
                          <div className="pt-2">
                            <Button 
                                onClick={() => handleFetchApiData(false)} 
                                disabled={isLoadingApiData || !mapSelectedCoords || !dateRange?.from || !dateRange?.to} 
                                className="w-full h-9 text-xs"
                            >
                            {isLoadingApiData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4"/>}
                            {isLoadingApiData ? "Fetching API Data..." : "Fetch API Data"}
                            </Button>
                          </div>
                      </CardContent>
                      {renderLogAccordion(apiFetchLogSteps, showApiFetchLogAccordion, setShowApiFetchLogAccordion, isApiLogLoading, apiLogOverallStatus, "API Fetch Log", lastApiErrorRef.current)}
                  </Card>
              </div>
            )}
            <div className={cn("transition-all duration-300", isApiPlotsExpanded ? "lg:col-span-12" : "lg:col-span-8")}>
                 <Card className="shadow-sm h-full">
                    <CardHeader className="p-2 pt-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">{apiDataLocationContext || "Weather & Marine API Data Plots"}</CardTitle>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setIsApiPlotsExpanded(!isApiPlotsExpanded)}
                              aria-label={isApiPlotsExpanded ? "Collapse plot view" : "Expand plot"}
                              className="h-7 w-7"
                            >
                              {isApiPlotsExpanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>{isApiPlotsExpanded ? "Show Controls" : "Expand plot"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </CardHeader>
                    <CardContent className="p-1.5 h-[calc(100%-2.5rem)]"> 
                        <MarinePlotsGrid
                        marineData={apiData} 
                        isLoading={isLoadingApiData}
                        error={errorApiData}
                        plotVisibility={apiPlotVisibility} 
                        handlePlotVisibilityChange={handleApiPlotVisibilityChange}
                        />
                    </CardContent>
                </Card>
            </div>
          </CardContent>
          )}
        </Card>
        
        <Separator className="my-4" />

        {/* Marine Device Data Section - Now Collapsible */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5 font-futura">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  Marine Device Data
                </CardTitle>
                <p className="text-xs text-muted-foreground pebl-body-main">
                  Upload and analyze marine device data files
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMarineDeviceData(!showMarineDeviceData)}
                className="h-8 px-3 text-xs"
              >
                {showMarineDeviceData ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                {showMarineDeviceData ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showMarineDeviceData && (
            <div>
              <div className="px-3 pb-2 flex justify-end">
                <Button onClick={addPlot} size="sm" className="h-8 text-xs">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add New Plot
                </Button>
              </div>
          <CardContent className="p-3">
             {plots.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-muted-foreground h-40 p-2 border rounded-md bg-muted/20">
                <LayoutGrid className="w-8 h-8 mb-2 text-muted" />
                <p className="text-xs">No device data plots to display.</p>
                <p className="text-[0.7rem]">Click "Add New Plot" to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {plots.map((plot) => (
                  <PlotInstance
                    key={plot.id}
                    instanceId={plot.id}
                    initialPlotTitle={plot.title}
                    onRemovePlot={removePlot}
                  />
                ))}
              </div>
            )}
          </CardContent>
            </div>
          )}
        </Card>
      </main>

      <footer className="py-3 sm:px-3 sm:py-2 border-t bg-secondary/50">
        <div className="container flex flex-col items-center justify-center gap-2 sm:h-14 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center sm:items-start gap-1">
            <div className="flex items-center gap-2">
              <div className="text-xs font-futura font-bold text-primary">PEBL</div>
              <div className="text-xs text-muted-foreground pebl-body-main">Ocean Data Platform</div>
            </div>
            <div className="text-[0.6rem] text-primary font-futura font-medium">
              Protecting Ecology Beyond Land
            </div>
          </div>
          <p className="text-balance text-center text-[0.65rem] leading-relaxed text-muted-foreground pebl-body-main">
            Marine & meteorological data visualization • Sustainable ocean monitoring solutions
          </p>
          <div className="text-xs text-muted-foreground pebl-body-main">
            © 2024 PEBL
          </div>
        </div>
      </footer>

      {/* Load Plot View Dialog */}
      {activeProjectId && (
        <LoadPlotViewDialog
          open={showLoadPlotViewDialog}
          onOpenChange={setShowLoadPlotViewDialog}
          projectId={activeProjectId}
          onLoad={handleLoadPlotView}
        />
      )}

      {/* Marine Device Plot Modal */}
      <Dialog
        open={showMarineDeviceModal}
        onOpenChange={(open) => {
          setShowMarineDeviceModal(open);
          if (!open) {
            // Clear the selected files when closing
            setSelectedFileType(null);
            setSelectedFiles([]);
            setSelectedPinLocation(undefined);
            setSelectedObjectName(undefined);
          }
        }}
      >
        <DialogContent className="max-w-6xl h-[80vh] marine-device-modal">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {selectedFileType ? `${selectedFileType} Data Analysis` : 'Data Viewer'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {selectedFileType && selectedFiles.length > 0 ? (
              <PinMarineDeviceData
                fileType={selectedFileType}
                files={selectedFiles}
                projectId={activeProjectId}
                allProjectFilesForTimeline={filesForTimeline}
                getFileDateRange={getFileDateRange}
                onDownloadFile={handleDownloadFileForPlot}
                objectLocation={selectedPinLocation}
                objectName={selectedObjectName}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">No file selected</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!plotToDelete} onOpenChange={(open) => !open && setPlotToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Saved Plot
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>&quot;{plotToDelete?.name}&quot;</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingPlotId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePlot}
              disabled={!!deletingPlotId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPlotId ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Plot Info Dialog */}
      <Dialog open={!!plotToShowInfo} onOpenChange={(open) => !open && setPlotToShowInfo(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              Plot Information
            </DialogTitle>
            <DialogDescription>
              Details about the saved plot configuration
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {plotToShowInfo && (
              <div className="space-y-4">
                {/* Plot Name & Description */}
                <div>
                  <h3 className="text-sm font-semibold mb-1">Name</h3>
                  <p className="text-sm text-muted-foreground">{plotToShowInfo.name}</p>
                </div>

                {plotToShowInfo.description && (
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Description</h3>
                    <p className="text-sm text-muted-foreground">{plotToShowInfo.description}</p>
                  </div>
                )}

                {/* Created Date */}
                <div>
                  <h3 className="text-sm font-semibold mb-1">Created</h3>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(plotToShowInfo.created_at), 'MMMM d, yyyy h:mm a')}
                  </p>
                </div>

                {/* Metadata */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Configuration</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">Total Plots:</span>
                      <span className="font-medium">{plotToShowInfo.view_config.metadata.totalPlots}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">Time Axis Mode:</span>
                      <span className="font-medium capitalize">{plotToShowInfo.view_config.timeAxisMode}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">Time Rounding:</span>
                      <span className="font-medium">{plotToShowInfo.view_config.timeRoundingInterval}</span>
                    </div>
                    {plotToShowInfo.view_config.metadata.dateRangeDisplay && (
                      <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                        <span className="text-muted-foreground">Date Range:</span>
                        <span className="font-medium text-xs">{plotToShowInfo.view_config.metadata.dateRangeDisplay}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Plots & Files */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Plots & Files</h3>
                  <div className="space-y-2">
                    {plotToShowInfo.view_config.plots.map((plot, idx) => (
                      <div key={plot.id} className="border rounded-md p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium">{plot.title}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Type: {plot.type === 'device' ? 'Device Data' : 'Marine/Meteo Data'}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground ml-2">#{idx + 1}</span>
                        </div>

                        {/* Device Plot Files */}
                        {plot.type === 'device' && plot.fileName && (
                          <div className="pl-2 border-l-2 border-muted space-y-1">
                            <p className="text-xs">
                              <span className="font-medium">File: </span>
                              <span className="text-muted-foreground">{plot.fileName}</span>
                            </p>
                            {plot.fileType && (
                              <p className="text-xs">
                                <span className="font-medium">Type: </span>
                                <span className="text-muted-foreground">{plot.fileType}</span>
                              </p>
                            )}
                          </div>
                        )}

                        {/* Marine/Meteo Plot Info */}
                        {plot.type === 'marine-meteo' && plot.location && (
                          <div className="pl-2 border-l-2 border-muted space-y-1">
                            {plot.locationName && (
                              <p className="text-xs">
                                <span className="font-medium">Location: </span>
                                <span className="text-muted-foreground">{plot.locationName}</span>
                              </p>
                            )}
                            <p className="text-xs">
                              <span className="font-medium">Coordinates: </span>
                              <span className="text-muted-foreground">
                                {plot.location.lat.toFixed(3)}, {plot.location.lon.toFixed(3)}
                              </span>
                            </p>
                          </div>
                        )}

                        {/* Merged Plot Info */}
                        {plot.isMerged && plot.mergedParams && plot.mergedParams.length > 0 && (
                          <div className="pl-2 border-l-2 border-primary/30 space-y-1">
                            <p className="text-xs font-medium text-primary">Merged Parameters ({plot.mergedParams.length})</p>
                            {plot.mergedParams.map((param, paramIdx) => (
                              <p key={paramIdx} className="text-xs text-muted-foreground pl-2">
                                • {param.parameter} ({param.sourceLabel}) - {param.axis} axis
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Visible Parameters */}
                        {plot.visibleParameters && plot.visibleParameters.length > 0 && (
                          <div className="text-xs">
                            <span className="font-medium">Visible Parameters: </span>
                            <span className="text-muted-foreground">{plot.visibleParameters.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dataset Names */}
                {plotToShowInfo.view_config.metadata.datasetNames && plotToShowInfo.view_config.metadata.datasetNames.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Datasets</h3>
                    <div className="flex flex-wrap gap-1">
                      {plotToShowInfo.view_config.metadata.datasetNames.map((name, idx) => (
                        <span key={idx} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => setPlotToShowInfo(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
