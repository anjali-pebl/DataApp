/**
 * CSV Date Range Analyzer
 *
 * Shared utility for analyzing date ranges in CSV files.
 * Downloads files from Supabase Storage, parses dates, and returns a comprehensive date range analysis.
 */

import { createClient } from '@/lib/supabase/client';
import type { PinFile } from '@/lib/supabase/file-storage-service';

export interface DateRangeResult {
  totalDays: number | null;
  startDate: string | null;
  endDate: string | null;
  uniqueDates?: string[];
  isCrop?: boolean;
  error?: string;
}

/**
 * Analyze the date range of a CSV file by downloading and parsing its contents
 * Uses intelligent date format detection and filename-based sanity checking
 */
export async function analyzeCSVDateRange(file: PinFile): Promise<DateRangeResult> {
  console.log('[csv-date-analyzer] Starting analysis for:', {
    fileName: file.fileName,
    fileId: file.id,
    filePath: file.filePath,
  });

  const supabase = createClient();

  try {
    // Use the correct property name for file path
    const storagePath = file.filePath || (file as any).storagePath || (file as any).storage_path;
    console.log('[csv-date-analyzer] Storage path resolved to:', storagePath);

    if (!storagePath) {
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: 'No storage path available'
      };
    }

    // Download file content with cache busting using signed URL
    const timestamp = Date.now();
    console.log('[csv-date-analyzer] Getting signed URL with cache buster:', storagePath);

    const { data: urlData, error: urlError } = await supabase.storage
      .from('pin-files')
      .createSignedUrl(storagePath, 60); // 60 second expiry

    if (urlError || !urlData?.signedUrl) {
      console.error('❌ Failed to create signed URL:', urlError);
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: `Failed to get download URL: ${urlError?.message || 'Unknown error'}`
      };
    }

    // Add cache buster to signed URL
    const downloadUrl = urlData.signedUrl + '&_cb=' + timestamp;
    console.log('[csv-date-analyzer] Fetching from signed URL with cache buster');

    let fileData: Blob;

    try {
      const response = await fetch(downloadUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      fileData = await response.blob();
      console.log('[csv-date-analyzer] File downloaded, size:', fileData.size, 'bytes');
    } catch (error) {
      console.error('❌ File download error:', {
        fileName: file.fileName,
        storagePath: storagePath,
        error: error
      });
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    // Detect if this is a discrete sampling file (CROP, CHEM, CHEMSW, CHEMWQ, WQ, EDNA)
    const fileName = file.fileName.toLowerCase();
    const isDiscreteFile = fileName.includes('crop') || fileName.includes('chem') ||
                           fileName.includes('chemsw') || fileName.includes('chemwq') ||
                           fileName.includes('wq') || fileName.includes('edna');

    // Detect if this is a UK logger file that uses DD/MM/YYYY format (GP files)
    const isUKLoggerFile = fileName.includes('_gp_') || fileName.startsWith('gp_');

    // Convert Blob to File object for csvParser
    const fileObject = new File([fileData], file.fileName, { type: 'text/csv' });

    // Use the intelligent csvParser with auto-detection (supports DD/MM/YYYY, MM/DD/YYYY, and YYYY-MM-DD formats)
    // Force DD/MM/YYYY for known UK data files (discrete sampling and GP logger files)
    const { parseCSVFile } = await import('@/components/pin-data/csvParser');
    const dateFormatOverride = (isDiscreteFile || isUKLoggerFile) ? 'DD/MM/YYYY' as const : undefined;

    const parseResult = await parseCSVFile(fileObject, 'GP', dateFormatOverride);

    console.log('[csv-date-analyzer] Parse result:', {
      headers: parseResult.headers,
      timeColumn: parseResult.summary.timeColumn,
      totalRows: parseResult.summary.totalRows,
      validRows: parseResult.summary.validRows,
      errorCount: parseResult.errors.length
    });

    if (parseResult.errors.length > 0) {
      console.warn('⚠️ CSV parsing warnings:', parseResult.errors.slice(0, 5));
    }

    if (parseResult.data.length === 0) {
      console.error('[csv-date-analyzer] No valid data rows! Check if time column was detected and dates can be parsed.');
      if (parseResult.diagnosticLogs) {
        console.log('[csv-date-analyzer] Diagnostic logs:', parseResult.diagnosticLogs);
      }
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: 'No valid dates could be parsed'
      };
    }

    // Convert time strings to Date objects
    // Handle comma-separated dates (e.g., "2024-07-30T00:00:00Z,2024-07-31T00:00:00Z")
    console.log('[csv-date-analyzer] Processing', parseResult.data.length, 'rows');
    if (parseResult.data.length > 0) {
      console.log('[csv-date-analyzer] First row time value:', parseResult.data[0].time);
    }

    const dates: Date[] = parseResult.data
      .flatMap(row => {
        try {
          // Check if this is a comma-separated multi-date value
          if (row.time.includes(',')) {
            console.log('[csv-date-analyzer] Multi-date detected:', row.time);
            return row.time.split(',').map(dateStr => {
              try {
                const d = new Date(dateStr.trim());
                console.log('[csv-date-analyzer] Parsed multi-date part:', dateStr.trim(), '→', d.toISOString());
                return d;
              } catch {
                return null;
              }
            });
          }
          // Single date
          return [new Date(row.time)];
        } catch {
          return [null];
        }
      })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

    console.log('[csv-date-analyzer] Total valid dates extracted:', dates.length);

    // SANITY CHECK: Extract expected date range from filename
    // E.g., "ALGA_CROP_F_L_2503-2506" means March 2025 (2503) to June 2025 (2506)
    // Support both hyphen and underscore separators (e.g., 2503-2506 or 2504_2506)
    const filenameMatch = file.fileName.match(/(\d{2})(\d{2})[-_](\d{2})(\d{2})/);
    if (filenameMatch && (isDiscreteFile || isUKLoggerFile)) {
      const [, startYY, startMM, endYY, endMM] = filenameMatch;
      const expectedStartMonth = parseInt(startMM);
      const expectedEndMonth = parseInt(endMM);
      const expectedStartYear = 2000 + parseInt(startYY);
      const expectedEndYear = 2000 + parseInt(endYY);

      // Validate each parsed date against expected range
      const invalidDates: Date[] = [];
      dates.forEach(date => {
        const dateYear = date.getFullYear();
        const dateMonth = date.getMonth() + 1; // 1-based month

        // Check if date is outside expected range
        const beforeStart = dateYear < expectedStartYear ||
                           (dateYear === expectedStartYear && dateMonth < expectedStartMonth);
        const afterEnd = dateYear > expectedEndYear ||
                        (dateYear === expectedEndYear && dateMonth > expectedEndMonth);

        if (beforeStart || afterEnd) {
          invalidDates.push(date);
        }
      });

      if (invalidDates.length > 0) {
        console.warn(`⚠️ Date format may be incorrect for ${file.fileName}: ${invalidDates.length} dates outside expected range ${expectedStartMonth}/${expectedStartYear}-${expectedEndMonth}/${expectedEndYear}`);
      }
    }

    if (dates.length === 0) {
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: 'No valid dates could be parsed'
      };
    }

    // Sort dates and calculate range
    dates.sort((a, b) => a.getTime() - b.getTime());
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Format dates in DD/MM/YYYY format for CSV files
    const formatDateForCSV = (date: Date): string => {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = String(date.getFullYear()); // Full 4-digit year
      return `${day}/${month}/${year}`;
    };

    // Use the discrete file detection from earlier (already determined above)
    const isDiscrete = isDiscreteFile;

    // For discrete files, count unique days; for others, calculate continuous range
    let totalDays: number;
    let uniqueDates: string[] | undefined;

    if (isDiscrete) {
      // Get unique dates (date-only, ignoring time)
      const uniqueDateSet = new Set<string>();
      dates.forEach(date => {
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        uniqueDateSet.add(formatDateForCSV(dateOnly));
      });
      uniqueDates = Array.from(uniqueDateSet).sort((a, b) => {
        // Parse dates back for proper sorting
        const [dayA, monthA, yearA] = a.split('/').map(Number);
        const [dayB, monthB, yearB] = b.split('/').map(Number);
        const dateA = new Date(yearA, monthA - 1, dayA);
        const dateB = new Date(yearB, monthB - 1, dayB);
        return dateA.getTime() - dateB.getTime();
      });
      totalDays = uniqueDates.length; // Number of unique sampling days
    } else {
      // Continuous data: calculate range
      totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    const formattedStartDate = formatDateForCSV(startDate);
    const formattedEndDate = formatDateForCSV(endDate);

    // Only log if there seems to be an issue
    if (totalDays > 365 || totalDays < 1) {
      console.warn(`⚠️ Unusual duration for ${file.fileName}: ${totalDays} days (${formattedStartDate} to ${formattedEndDate})`);
    }

    return {
      totalDays,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
      uniqueDates,
      isCrop: isDiscrete,
    };

  } catch (error) {
    console.error('❌ CSV analysis error:', {
      fileName: file.fileName,
      error: error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    });
    return {
      totalDays: null,
      startDate: null,
      endDate: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
