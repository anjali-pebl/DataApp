/**
 * CSV Parser Utilities for GP, FPOD, and Subcam data files
 * Handles different file formats and data structures
 */

import { detectSampleIdColumn } from '@/lib/statistical-utils';
import { extractEdnaDate } from '@/lib/edna-utils';
import { lookupSpeciesBatch, getTaxonomyRankAbbreviation, type TaxonomyResult } from '@/lib/taxonomy-service';

export interface ParsedDataPoint {
  time: string;
  [key: string]: string | number | undefined | null;
}

export interface ParseResult {
  data: ParsedDataPoint[];
  headers: string[];
  errors: string[];
  summary: {
    totalRows: number;
    validRows: number;
    columns: number;
    timeColumn: string | null;
  };
  // Optional metadata for parameters (used in merged plots to track source)
  parameterMetadata?: Record<string, {
    source: 'GP' | 'FPOD' | 'Subcam' | 'marine';
    sourceLabel?: string; // e.g., "OM", "GP", "FPOD"
  }>;
  // Optional: Auto-detected sample ID column (for spot-sample data)
  detectedSampleIdColumn?: string | null;
  // Diagnostic logs for debugging (shown in error UI)
  diagnosticLogs?: string[];
}

export type FileType = 'GP' | 'FPOD' | 'Subcam' | 'Hapl';

// Haplotype-specific interfaces
export interface HaplotypeMetadata {
  credibility: 'HIGH' | 'MODERATE' | 'LOW' | string;
  phylum: string;
  isInvasive: boolean;
  invasiveSpeciesName: string | null;
  redListStatus: string;

  // Taxonomy data from WoRMS/GBIF APIs
  taxonomySource?: 'worms' | 'gbif' | 'unknown';
  taxonId?: string; // AphiaID (WoRMS) or usageKey (GBIF)
  commonNames?: string[];
  fullHierarchy?: {
    kingdom?: string;
    phylum?: string;
    class?: string;
    order?: string;
    family?: string;
    genus?: string;
    species?: string;
  };
  taxonomyConfidence?: 'high' | 'medium' | 'low';
  taxonomyRank?: string; // sp./gen./fam./ord./class./phyl.
}

export interface HaplotypeCellData {
  species: string;
  site: string;
  count: number;
  metadata: HaplotypeMetadata;
}

export interface HaplotypeParseResult {
  species: string[];
  sites: string[];
  data: HaplotypeCellData[];
  errors: string[];
  summary: {
    totalSpecies: number;
    totalSites: number;
    totalCells: number;
  };
}

/**
 * Detect date format (DD/MM/YYYY vs MM/DD/YYYY) by analyzing date values
 * Examines first several rows to determine which format is being used
 */
function detectDateFormat(lines: string[], timeColumnIndex: number, startRow: number = 1, fileName: string = ''): 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' {
  const sampleSize = Math.min(20, lines.length - startRow); // Check up to 20 data rows
  const dateValues: string[] = [];
  const isoDateValues: string[] = [];
  const isHaplotypeFile = fileName.toLowerCase().includes('hapl');


  // Extract date values from sample rows (starting from the first data row)
  for (let i = startRow; i < startRow + sampleSize && i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values[timeColumnIndex]) {
      const timeValue = values[timeColumnIndex].trim();
      // Extract just the date part if it has time component
      const datePart = timeValue.split(' ')[0];

      // Check for ISO format (YYYY-MM-DD with dashes)
      if (datePart.includes('-')) {
        const parts = datePart.split('-');
        // ISO format has year first (4 digits) followed by month and day
        if (parts.length === 3 && parts[0].length === 4) {
          isoDateValues.push(datePart);
        }
      }
      // Check for slash-separated dates (DD/MM/YYYY or MM/DD/YYYY)
      else if (datePart.includes('/')) {
        dateValues.push(datePart);
      }
    }
  }

  // Priority 1: If we found ISO format dates, use that
  if (isoDateValues.length > 0) {
    console.log(`[DATE DETECTION] ✓ ISO format (${isoDateValues.length} dates)`);
    return 'YYYY-MM-DD';
  }

  if (dateValues.length > 0) {
    console.log(`[DATE DETECTION] Slash-separated dates found: ${dateValues.length}`);
  }

  // Priority 2: Process slash-separated dates
  if (dateValues.length === 0) {
    console.log('[DATE DETECTION] No date values found, defaulting to DD/MM/YYYY');
    return 'DD/MM/YYYY'; // Default to European format
  }

  let hasFirstComponentOver12 = false;
  let hasSecondComponentOver12 = false;
  const firstComponents: number[] = [];
  const secondComponents: number[] = [];

  // Analyze each date value
  for (const dateStr of dateValues) {
    const parts = dateStr.split('/');
    if (parts.length >= 3) {
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);

      if (!isNaN(first) && !isNaN(second)) {
        firstComponents.push(first);
        secondComponents.push(second);

        if (first > 12) hasFirstComponentOver12 = true;
        if (second > 12) hasSecondComponentOver12 = true;
      }
    }
  }

  console.log('[DATE DETECTION] First components:', firstComponents);
  console.log('[DATE DETECTION] Second components:', secondComponents);
  console.log('[DATE DETECTION] Has first > 12:', hasFirstComponentOver12);
  console.log('[DATE DETECTION] Has second > 12:', hasSecondComponentOver12);

  // Rule 1: If first component > 12, must be DD/MM/YYYY
  if (hasFirstComponentOver12 && !hasSecondComponentOver12) {
    console.log('═══════════════════════════════════════════════════════');
    console.log('[DATE DETECTION] ✓ Detected format: DD/MM/YYYY (Rule 1: first > 12)');
    console.log('═══════════════════════════════════════════════════════');
    return 'DD/MM/YYYY';
  }

  // Rule 2: If second component > 12, must be MM/DD/YYYY
  if (hasSecondComponentOver12 && !hasFirstComponentOver12) {
    console.log('═══════════════════════════════════════════════════════');
    console.log('[DATE DETECTION] ✓ Detected format: MM/DD/YYYY (Rule 2: second > 12)');
    console.log('═══════════════════════════════════════════════════════');
    return 'MM/DD/YYYY';
  }

  // Rule 3: Both ambiguous (all values ≤12), look for sequential patterns
  if (!hasFirstComponentOver12 && !hasSecondComponentOver12 && firstComponents.length > 3) {
    // Check if first components show day-like progression (1-30 range with variety)
    const firstRange = Math.max(...firstComponents) - Math.min(...firstComponents);
    const firstUnique = new Set(firstComponents).size;

    // Check if second components show day-like progression
    const secondRange = Math.max(...secondComponents) - Math.min(...secondComponents);
    const secondUnique = new Set(secondComponents).size;

    console.log('[DATE DETECTION] Pattern analysis - First range:', firstRange, 'unique:', firstUnique);
    console.log('[DATE DETECTION] Pattern analysis - Second range:', secondRange, 'unique:', secondUnique);

    // If first component has wider range and more variety, likely to be days
    if (firstRange > secondRange && firstUnique > secondUnique) {
      console.log('═══════════════════════════════════════════════════════');
      console.log('[DATE DETECTION] ✓ Detected format: DD/MM/YYYY (Rule 3: first has more variety)');
      console.log('═══════════════════════════════════════════════════════');
      return 'DD/MM/YYYY';
    }

    // If second component has wider range and more variety, likely to be days
    if (secondRange > firstRange && secondUnique > firstUnique) {
      console.log('═══════════════════════════════════════════════════════');
      console.log('[DATE DETECTION] ✓ Detected format: MM/DD/YYYY (Rule 3: second has more variety)');
      console.log('═══════════════════════════════════════════════════════');
      return 'MM/DD/YYYY';
    }
  }

  // Default to European format (DD/MM/YYYY) if still ambiguous
  console.log('═══════════════════════════════════════════════════════');
  console.log('[DATE DETECTION] ✓ Using default format: DD/MM/YYYY (ambiguous case)');
  console.log('═══════════════════════════════════════════════════════');
  return 'DD/MM/YYYY';
}

/**
 * Detect the correct header row for eDNA _Meta files
 * These files have a special structure with metadata rows before the actual headers
 */
function detectEdnaMetaHeaderRow(lines: string[], fileName: string): { rowIndex: number; logs: string[] } {
  const logs: string[] = [];

  // Check if this is an eDNA _Meta file
  if (!fileName.toLowerCase().includes('edna') ||
      !(fileName.toLowerCase().includes('_meta') || fileName.toLowerCase().includes('_metadata'))) {
    logs.push('📄 Not an eDNA _Meta file, using first row as header');
    return { rowIndex: 0, logs }; // Not an eDNA _Meta file, use first row
  }

  logs.push('🔍 eDNA _Meta file detected, scanning for actual header row...');

  // Expected eDNA concentration parameter names to look for
  const expectedParams = [
    'edna concentration',
    'dna concentration',
    '18sssu marker concentration',
    'coilb marker concentration',
    'marker concentration'
  ];

  // Scan first 10 rows to find the row containing these parameter names
  const scanLimit = Math.min(10, lines.length);
  logs.push(`📊 Scanning first ${scanLimit} rows for concentration parameter names...`);

  for (let i = 0; i < scanLimit; i++) {
    const lineText = lines[i].toLowerCase();

    // Check if this line contains at least 2 of the expected parameter names
    const matchCount = expectedParams.filter(param => lineText.includes(param)).length;

    if (matchCount > 0) {
      logs.push(`  Row ${i}: Found ${matchCount} parameter match(es)`);
    }

    if (matchCount >= 2) {
      logs.push(`✅ Found eDNA header row at line ${i}`);
      logs.push(`📋 Header preview: ${lines[i].substring(0, 150)}...`);
      console.log(`[CSV PARSER] ✅ Found eDNA header row at line ${i}`);
      console.log(`[CSV PARSER] Header row preview: ${lines[i].substring(0, 200)}...`);
      return { rowIndex: i, logs };
    }
  }

  logs.push('⚠️ Could not find eDNA concentration parameters, using first row as header');
  console.log('[CSV PARSER] ⚠️ Could not find eDNA concentration parameters, using first row as header');
  return { rowIndex: 0, logs };
}

/**
 * Enhanced CSV parsing with robust error handling
 */
export async function parseCSVFile(
  file: File,
  fileType: FileType,
  dateFormatOverride?: 'DD/MM/YYYY' | 'MM/DD/YYYY'
): Promise<ParseResult> {
  const diagnosticLogs: string[] = [];

  const result: ParseResult = {
    data: [],
    headers: [],
    errors: [],
    summary: {
      totalRows: 0,
      validRows: 0,
      columns: 0,
      timeColumn: null,
    },
    diagnosticLogs: diagnosticLogs
  };

  // Detect if this is a haplotype file for enhanced debugging
  const isHaplotypeFile = file.name.toLowerCase().includes('hapl');

  try {
    const text = await file.text();
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');

    if (lines.length === 0) {
      result.errors.push('File is empty');
      diagnosticLogs.push('❌ File is empty');
      return result;
    }

    diagnosticLogs.push(`📁 File: ${file.name}`);
    diagnosticLogs.push(`📊 Total lines in file: ${lines.length}`);

    // 🧬 HAPL_DEBUG: Enhanced logging for haplotype files
    if (isHaplotypeFile) {
      console.log('═════════════════════════════════════════════════════════════');
      console.log('🧬 HAPL_DEBUG: Haplotype file detected');
      console.log('🧬 HAPL_DEBUG: File name:', file.name);
      console.log('🧬 HAPL_DEBUG: File size:', file.size, 'bytes');
      console.log('🧬 HAPL_DEBUG: Total lines:', lines.length);
      console.log('🧬 HAPL_DEBUG: First 3 lines (raw):');
      lines.slice(0, 3).forEach((line, idx) => {
        console.log(`🧬 HAPL_DEBUG:   Line ${idx}:`, line.substring(0, 200));
      });
      console.log('═════════════════════════════════════════════════════════════');
    }

    // Detect the correct header row (important for eDNA _Meta files)
    const headerDetection = detectEdnaMetaHeaderRow(lines, file.name);
    diagnosticLogs.push(...headerDetection.logs);
    const headerRowIndex = headerDetection.rowIndex;

    // Parse headers with cleaning
    const rawHeaders = lines[headerRowIndex].split(',').map(h => h.trim().replace(/"/g, ''));
    result.headers = rawHeaders;
    result.summary.columns = rawHeaders.length;
    result.summary.totalRows = lines.length - headerRowIndex - 1;

    diagnosticLogs.push(`✅ Using row ${headerRowIndex} as header row`);
    diagnosticLogs.push(`📋 Detected ${rawHeaders.length} columns: ${rawHeaders.slice(0, 5).join(', ')}${rawHeaders.length > 5 ? '...' : ''}`);

    console.log(`[CSV PARSER] Headers: ${rawHeaders.length} cols (${rawHeaders.slice(0, 3).join(', ')}${rawHeaders.length > 3 ? '...' : ''})`);

    // 🧬 HAPL_DEBUG: Log all headers for haplotype files
    if (isHaplotypeFile) {
      console.log('🧬 HAPL_DEBUG: Header row index:', headerRowIndex);
      console.log('🧬 HAPL_DEBUG: All headers:', rawHeaders);
      console.log('🧬 HAPL_DEBUG: Total columns:', rawHeaders.length);
    }

    // Detect time column with multiple strategies
    const timeColumnIndex = detectTimeColumn(rawHeaders, fileType);
    if (timeColumnIndex >= 0) {
      result.summary.timeColumn = rawHeaders[timeColumnIndex];
      diagnosticLogs.push(`🕒 Time column detected: "${rawHeaders[timeColumnIndex]}" (index ${timeColumnIndex})`);
    } else {
      result.errors.push(`No time column detected for ${fileType} data`);
      diagnosticLogs.push(`⚠️ No time column detected for ${fileType} data`);
    }

    // 🧬 HAPL_DEBUG: Log time column detection for haplotype files
    if (isHaplotypeFile) {
      console.log('🧬 HAPL_DEBUG: Time column index:', timeColumnIndex);
      if (timeColumnIndex >= 0) {
        console.log('🧬 HAPL_DEBUG: Time column name:', rawHeaders[timeColumnIndex]);
      } else {
        console.log('🧬 HAPL_DEBUG: ⚠️ NO TIME COLUMN DETECTED');
      }
    }

    // Detect sample ID column (for spot-sample data like CROP, CHEM, WQ, EDNA)
    // Special handling for eDNA Meta files: use "Sample Name" column which includes control samples
    const isEdnaMetaFile = file.name.toLowerCase().includes('edna') &&
      (file.name.toLowerCase().includes('_meta') || file.name.toLowerCase().includes('_metadata'));

    if (isEdnaMetaFile) {
      // For eDNA Meta files, prioritize "Sample Name" column which includes all samples including controls
      const sampleNameCol = rawHeaders.find(h => h.toLowerCase() === 'sample name');
      result.detectedSampleIdColumn = sampleNameCol || detectSampleIdColumn(rawHeaders);
      if (sampleNameCol) {
        diagnosticLogs.push(`🏷️ eDNA Meta file: Using "Sample Name" column for sample IDs`);
        console.log('[CSV PARSER] eDNA Meta file: Using "Sample Name" column:', sampleNameCol);
      }
    } else {
      result.detectedSampleIdColumn = detectSampleIdColumn(rawHeaders);
    }

    if (result.detectedSampleIdColumn) {
      diagnosticLogs.push(`🏷️ Sample ID column detected: "${result.detectedSampleIdColumn}"`);
      console.log('[CSV PARSER] Detected sample ID column:', result.detectedSampleIdColumn);
    }

    // Parse data rows (start from the row after the header row)
    const dataStartRow = headerRowIndex + 1;
    diagnosticLogs.push(`📍 Data starts at row ${dataStartRow} (after header at row ${headerRowIndex})`);
    console.log(`[CSV PARSER] Data starts at row ${dataStartRow}`);

    // Use override if provided, otherwise detect date format by analyzing sample data
    const dateFormat = dateFormatOverride || detectDateFormat(lines, timeColumnIndex, dataStartRow, file.name);
    diagnosticLogs.push(`📅 Date format: ${dateFormat} ${dateFormatOverride ? '(override)' : '(auto-detected)'}`);
    console.log('[CSV PARSER] Using date format:', dateFormat, dateFormatOverride ? '(override)' : '(detected)');

    // 🧬 HAPL_DEBUG: Log date format for haplotype files
    if (isHaplotypeFile) {
      console.log('🧬 HAPL_DEBUG: Date format detected:', dateFormat);
      console.log('🧬 HAPL_DEBUG: Date format override?', dateFormatOverride || 'No');
    }

    for (let i = dataStartRow; i < lines.length; i++) {
      try {
        const rowData = parseDataRow(lines[i], rawHeaders, timeColumnIndex, fileType, dateFormat, file.name);
        if (rowData) {
          result.data.push(rowData);
          result.summary.validRows++;
        }
      } catch (rowError) {
        result.errors.push(`Row ${i}: ${rowError instanceof Error ? rowError.message : 'Parse error'}`);
      }
    }

    diagnosticLogs.push(`✅ Parsing complete: ${result.summary.validRows} valid rows out of ${result.summary.totalRows} total rows`);

    // 🧬 HAPL_DEBUG: Log parsed data structure for haplotype files
    if (isHaplotypeFile) {
      console.log('🧬 HAPL_DEBUG: Parsing complete');
      console.log('🧬 HAPL_DEBUG: Valid rows:', result.summary.validRows);
      console.log('🧬 HAPL_DEBUG: Total rows:', result.summary.totalRows);
      console.log('🧬 HAPL_DEBUG: First 3 parsed data points:');
      result.data.slice(0, 3).forEach((dataPoint, idx) => {
        console.log(`🧬 HAPL_DEBUG:   Data point ${idx}:`, dataPoint);
      });
      console.log('🧬 HAPL_DEBUG: Last parsed data point:', result.data[result.data.length - 1]);
    }

    if (result.summary.validRows === 0 && result.summary.totalRows > 0) {
      diagnosticLogs.push(`❌ No valid data rows were parsed! This may indicate:`);
      diagnosticLogs.push(`   • Data types don't match expected format`);
      diagnosticLogs.push(`   • Date values can't be parsed`);
      diagnosticLogs.push(`   • Wrong header row was selected`);

      // 🧬 HAPL_DEBUG: Extra debugging for failed haplotype parsing
      if (isHaplotypeFile) {
        console.log('🧬 HAPL_DEBUG: ❌ NO VALID ROWS PARSED!');
        console.log('🧬 HAPL_DEBUG: This could mean:');
        console.log('🧬 HAPL_DEBUG:   - Date format not recognized');
        console.log('🧬 HAPL_DEBUG:   - Data structure incompatible with parser');
        console.log('🧬 HAPL_DEBUG:   - Wrong header row selected');
      }
    }

    // Validate and sort by time if possible
    if (result.data.length > 0 && result.summary.timeColumn) {
      try {
        result.data.sort((a, b) => {
          const timeA = new Date(a.time).getTime();
          const timeB = new Date(b.time).getTime();
          return timeA - timeB;
        });
        diagnosticLogs.push(`🔄 Data sorted by time column`);

        // 🧬 HAPL_DEBUG: Log date range after sorting
        if (isHaplotypeFile && result.data.length > 0) {
          console.log('🧬 HAPL_DEBUG: Data sorted by time');
          console.log('🧬 HAPL_DEBUG: First date:', result.data[0].time);
          console.log('🧬 HAPL_DEBUG: Last date:', result.data[result.data.length - 1].time);
        }
      } catch (sortError) {
        result.errors.push('Warning: Could not sort data by time');
        diagnosticLogs.push(`⚠️ Could not sort data by time`);

        if (isHaplotypeFile) {
          console.log('🧬 HAPL_DEBUG: ⚠️ Could not sort data by time:', sortError);
        }
      }
    }

  } catch (fileError) {
    const errorMsg = `File reading error: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`;
    result.errors.push(errorMsg);
    diagnosticLogs.push(`❌ ${errorMsg}`);
  }

  return result;
}

/**
 * Detect time column based on file type and common patterns
 */
function detectTimeColumn(headers: string[], fileType: FileType): number {
  const timePatterns = {
    GP: ['time', 'timestamp', 'datetime', 'date_time', 'utc_time'],
    FPOD: ['timestamp', 'time', 'datetime', 'date', 'utc'],
    Subcam: ['time', 'datetime', 'timestamp', 'capture_time', 'image_time']
  };

  const patterns = timePatterns[fileType] || timePatterns.GP;
  
  // First, try exact matches (case insensitive)
  for (const pattern of patterns) {
    const index = headers.findIndex(h => h.toLowerCase() === pattern.toLowerCase());
    if (index >= 0) return index;
  }

  // Then, try partial matches
  for (const pattern of patterns) {
    const index = headers.findIndex(h => h.toLowerCase().includes(pattern.toLowerCase()));
    if (index >= 0) return index;
  }

  // Fallback: look for any column containing 'time' or 'date'
  const fallbackIndex = headers.findIndex(h => 
    h.toLowerCase().includes('time') || h.toLowerCase().includes('date')
  );
  
  return fallbackIndex >= 0 ? fallbackIndex : 0; // Default to first column if nothing found
}

/**
 * Parse individual data row with type conversion and validation
 */
function parseDataRow(
  line: string,
  headers: string[],
  timeColumnIndex: number,
  fileType: FileType,
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD',
  fileName?: string
): ParsedDataPoint | null {
  // Handle CSV with potential quoted values and commas within quotes
  const values = parseCSVLine(line);

  if (values.length !== headers.length) {
    // Try to handle mismatched columns gracefully
    if (values.length < headers.length) {
      // Pad with empty values
      while (values.length < headers.length) {
        values.push('');
      }
    } else {
      // Truncate excess values
      values.splice(headers.length);
    }
  }

  const dataPoint: ParsedDataPoint = { time: '' };
  let hasValidTime = false;

  headers.forEach((header, index) => {
    const rawValue = values[index]?.trim() || '';

    if (index === timeColumnIndex) {
      // Handle time column
      const processedTime = processTimeValue(rawValue, fileType, dateFormat);
      dataPoint.time = processedTime;
      hasValidTime = processedTime !== '';
    } else {
      // Handle data columns
      const processedValue = processDataValue(rawValue, header, fileType);
      dataPoint[header] = processedValue;
    }
  });

  // Special handling for eDNA Meta files without time columns
  // These files have concentration data but no timestamps - use filename date instead
  const isEdnaMetaFile = fileName &&
    fileName.toLowerCase().includes('edna') &&
    (fileName.toLowerCase().includes('_meta') || fileName.toLowerCase().includes('_metadata'));

  if (!hasValidTime && isEdnaMetaFile && fileName) {
    // Extract date from filename (e.g., "NORF_EDNAS_ALL_2507" → "2025-07-01")
    const extractedDate = extractEdnaDate(fileName);
    if (extractedDate) {
      dataPoint.time = extractedDate.toISOString();
      hasValidTime = true;
      // console.log('[CSV PARSER] eDNA Meta file: Injected synthetic date from filename:', dataPoint.time);
    }
  }

  // Return null if we don't have a valid time value
  return hasValidTime ? dataPoint : null;
}

/**
 * Parse CSV line handling quoted values and embedded commas
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current); // Don't forget the last value
  return values.map(v => v.trim().replace(/^"|"$/g, '')); // Remove surrounding quotes
}

/**
 * Process time values with format detection and conversion
 * Handles various formats and ensures ISO 8601 output
 */
function processTimeValue(value: string, fileType: FileType, dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'): string {
  if (!value || value === '') return '';

  // Clean up the value
  const cleanValue = value.trim();

  // Handle case where time might have only HH:MM format (missing date)
  // This would be invalid - skip these rows
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleanValue)) {
    return ''; // Time-only format without date is invalid
  }

  // Check for common date-time formats
  const formats = [
    // ISO 8601 formats (already standard)
    { regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/, handler: (v: string) => v.endsWith('Z') ? v : v + 'Z' },
    { regex: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{3})?$/, handler: (v: string) => v.replace(' ', 'T') + 'Z' },

    // YYYY/MM/DD format with time (year-first with slashes) - handle before DD/MM/YYYY
    { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/, handler: (v: string) => {
      const match = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
      if (!match) return '';
      const [, year, month, day, hour, min, sec] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${min}:${sec}Z`;
    }},

    // Date with slash separators: DD/MM/YYYY HH:MM (no seconds) - MUST come before HH:MM:SS
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/, handler: (v: string) => {
      const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
      if (!match) return '';
      const [, d1, d2, year, hour, min] = match;
      const sec = '00'; // Default seconds to 00
      let result: string;
      let day: string, month: string;

      // Use detected date format
      if (dateFormat === 'DD/MM/YYYY') {
        // Format is DD/MM/YYYY: d1 = day, d2 = month
        day = d1.padStart(2, '0');
        month = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${min}:${sec}Z`;
      } else {
        // Format is MM/DD/YYYY: d1 = month, d2 = day
        month = d1.padStart(2, '0');
        day = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${min}:${sec}Z`;
      }
      console.log(`[TIME CONVERSION HH:MM] Input: "${v}" | Format: ${dateFormat} | d1=${d1}, d2=${d2} | Interpreted as: day=${day}, month=${month} | Output: ${result}`);
      return result;
    }},

    // Date with slash separators: DD/MM/YYYY HH:MM:SS or MM/DD/YYYY HH:MM:SS
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/, handler: (v: string) => {
      const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
      if (!match) return '';
      const [, d1, d2, year, hour, min, sec] = match;
      let result: string;
      let day: string, month: string;

      // Use detected date format
      if (dateFormat === 'DD/MM/YYYY') {
        // Format is DD/MM/YYYY: d1 = day, d2 = month
        day = d1.padStart(2, '0');
        month = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${min}:${sec}Z`;
      } else {
        // Format is MM/DD/YYYY: d1 = month, d2 = day
        month = d1.padStart(2, '0');
        day = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${min}:${sec}Z`;
      }
      console.log(`[TIME CONVERSION HH:MM:SS] Input: "${v}" | Format: ${dateFormat} | d1=${d1}, d2=${d2} | Interpreted as: day=${day}, month=${month} | Output: ${result}`);
      return result;
    }},

    // Date only formats - add midnight time
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, handler: (v: string) => v + 'T00:00:00Z' },

    // Date only with 4-digit year: DD/MM/YYYY or MM/DD/YYYY
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, handler: (v: string) => {
      const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return '';
      const [, d1, d2, year] = match;
      let result: string;
      let day: string, month: string;

      // Use detected date format
      if (dateFormat === 'DD/MM/YYYY') {
        // d1 = day, d2 = month -> ISO format YYYY-MM-DD
        day = d1.padStart(2, '0');
        month = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T00:00:00Z`;
      } else {
        // MM/DD/YYYY format: d1 = month, d2 = day -> ISO format YYYY-MM-DD
        month = d1.padStart(2, '0');
        day = d2.padStart(2, '0');
        result = `${year}-${month}-${day}T00:00:00Z`;
      }
      console.log(`[TIME CONVERSION DATE-ONLY 4Y] Input: "${v}" | Format: ${dateFormat} | d1=${d1}, d2=${d2} | Interpreted as: day=${day}, month=${month} | Output: ${result}`);
      return result;
    }},

    // Date only with 2-digit year: DD/MM/YY or MM/DD/YY (e.g., "10/04/25")
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, handler: (v: string) => {
      const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (!match) return '';
      const [, d1, d2, yy] = match;
      let result: string;
      let day: string, month: string;

      // Convert 2-digit year to 4-digit year (e.g., 25 -> 2025)
      const yearNum = parseInt(yy, 10);
      const fullYear = yearNum < 100 ? 2000 + yearNum : yearNum;

      // Use detected date format
      if (dateFormat === 'DD/MM/YYYY') {
        // Format is DD/MM/YY: d1 = day, d2 = month
        day = d1.padStart(2, '0');
        month = d2.padStart(2, '0');
        result = `${fullYear}-${month}-${day}T00:00:00Z`;
      } else {
        // Format is MM/DD/YY: d1 = month, d2 = day
        month = d1.padStart(2, '0');
        day = d2.padStart(2, '0');
        result = `${fullYear}-${month}-${day}T00:00:00Z`;
      }
      console.log(`[TIME CONVERSION DATE-ONLY 2Y] Input: "${v}" | Format: ${dateFormat} | YY=${yy} -> ${fullYear} | d1=${d1}, d2=${d2} | Interpreted as: day=${day}, month=${month} | Output: ${result}`);
      return result;
    }},

    // Excel serial date number (days since 1900-01-01)
    { regex: /^\d{5,6}(\.\d+)?$/, handler: (v: string) => {
      const serial = parseFloat(v);
      // Excel epoch: 1900-01-01 (but Excel incorrectly treats 1900 as leap year)
      const epoch = new Date(1899, 11, 30); // 30 Dec 1899
      const date = new Date(epoch.getTime() + serial * 86400000);
      return date.toISOString();
    }},
  ];

  // Try each format handler
  for (const format of formats) {
    if (format.regex.test(cleanValue)) {
      try {
        const converted = format.handler(cleanValue);
        const testDate = new Date(converted);

        // Validate date is valid and reasonable
        if (!isNaN(testDate.getTime()) && testDate.getFullYear() >= 1970 && testDate.getFullYear() <= 2100) {
          // Additional validation: check that the ISO string matches expected pattern
          // This catches cases like "2025-15-04" which get auto-corrected by Date
          const isoMatch = converted.match(/^(\d{4})-(\d{2})-(\d{2})T/);
          if (isoMatch) {
            const [, isoYear, isoMonth, isoDay] = isoMatch;
            const monthNum = parseInt(isoMonth, 10);
            const dayNum = parseInt(isoDay, 10);

            // Month must be 1-12, day must be 1-31
            if (monthNum < 1 || monthNum > 12) {
              console.warn(`[TIME VALIDATION] Invalid month detected: ${monthNum} in "${converted}" from "${cleanValue}"`);
              continue;
            }
            if (dayNum < 1 || dayNum > 31) {
              console.warn(`[TIME VALIDATION] Invalid day detected: ${dayNum} in "${converted}" from "${cleanValue}"`);
              continue;
            }

            // Verify that parsing back gives us the same month/day (catches auto-correction)
            if (testDate.getUTCMonth() + 1 !== monthNum || testDate.getUTCDate() !== dayNum) {
              console.warn(`[TIME VALIDATION] Date auto-corrected by JS Date: "${converted}" -> Month ${testDate.getUTCMonth()+1}, Day ${testDate.getUTCDate()}`);
              continue;
            }
          }

          return converted;
        }
      } catch (e) {
        continue;
      }
    }
  }

  // DON'T use native Date parsing - it assumes MM/DD/YYYY for ambiguous formats
  // This was causing DD/MM/YYYY dates to be parsed incorrectly
  // Instead, we explicitly require matching one of our known formats above

  // If all parsing fails, log and return empty string to filter out this row
  console.warn(`[TIME PARSING FAILED] Could not parse time value: "${cleanValue}" with format ${dateFormat}`);
  return '';
}

/**
 * Process data values with type conversion
 */
function processDataValue(value: string, header: string, fileType: FileType): string | number | null {
  if (!value || value === '' || value.toLowerCase() === 'null' || value.toLowerCase() === 'na') {
    return null;
  }

  // IMPORTANT: Keep identifier columns as strings (don't convert to numbers)
  // These are used as categorical identifiers in spot-sample plots and other contexts
  // Even if they start with numbers (e.g., "1-NE-3"), they must remain strings
  const headerLower = header.toLowerCase().replace(/[\s_-]/g, '');
  const stringIdentifiers = [
    'sample',
    'sampleid',
    'stationid',
    'station',
    'subsetid',
    'subset',
    'farmid',
    'farm',
    'imageid',
    'image',
    'site',
    'siteid',
    'location',
    'locationid'
  ];

  if (stringIdentifiers.some(id => headerLower.includes(id))) {
    return value.trim(); // Return as string, trimmed
  }

  // Try to convert to number ONLY if it's a pure numeric value
  // This prevents "1-NE-3" from being converted to 1
  const numValue = parseFloat(value);
  if (!isNaN(numValue) && isFinite(numValue)) {
    // Additional check: ensure the stringified number matches the original value
    // This catches cases like "1-NE-3" where parseFloat returns 1
    const trimmedValue = value.trim();
    if (numValue.toString() === trimmedValue || parseFloat(trimmedValue).toString() === trimmedValue) {
      return numValue;
    }
  }

  // Return as string for non-numeric values or complex identifiers
  return value.trim();
}

/**
 * Merge multiple CSV files of the same type
 */
export async function parseMultipleCSVFiles(
  files: File[],
  fileType: FileType,
  dateFormatOverride?: 'DD/MM/YYYY' | 'MM/DD/YYYY'
): Promise<ParseResult> {
  if (files.length === 0) {
    return {
      data: [],
      headers: [],
      errors: ['No files provided'],
      summary: { totalRows: 0, validRows: 0, columns: 0, timeColumn: null },
      detectedSampleIdColumn: null
    };
  }

  if (files.length === 1) {
    return parseCSVFile(files[0], fileType, dateFormatOverride);
  }

  // Parse all files
  const results = await Promise.all(files.map(file => parseCSVFile(file, fileType, dateFormatOverride)));
  
  // Merge results
  const mergedResult: ParseResult = {
    data: [],
    headers: results[0]?.headers || [],
    errors: [],
    summary: {
      totalRows: 0,
      validRows: 0,
      columns: results[0]?.headers.length || 0,
      timeColumn: results[0]?.summary.timeColumn || null,
    },
    detectedSampleIdColumn: results[0]?.detectedSampleIdColumn || null
  };

  results.forEach((result, index) => {
    mergedResult.data.push(...result.data);
    mergedResult.errors.push(...result.errors.map(err => `File ${index + 1}: ${err}`));
    mergedResult.summary.totalRows += result.summary.totalRows;
    mergedResult.summary.validRows += result.summary.validRows;
  });

  // Sort merged data by time
  if (mergedResult.data.length > 0 && mergedResult.summary.timeColumn) {
    try {
      mergedResult.data.sort((a, b) => {
        const timeA = new Date(a.time).getTime();
        const timeB = new Date(b.time).getTime();
        return timeA - timeB;
      });
    } catch (sortError) {
      mergedResult.errors.push('Warning: Could not sort merged data by time');
    }
  }

  return mergedResult;
}

/**
 * Extract time range from parsed data for Open Meteo API requests
 * Returns { start, end } in ISO format, or null if no valid times found
 */
export function extractTimeRange(data: ParsedDataPoint[]): { start: string; end: string } | null {
  if (data.length === 0) return null;

  const validTimes = data
    .map(point => {
      try {
        const date = new Date(point.time);
        return !isNaN(date.getTime()) ? date : null;
      } catch {
        return null;
      }
    })
    .filter((d): d is Date => d !== null);

  if (validTimes.length === 0) return null;

  const sortedTimes = validTimes.sort((a, b) => a.getTime() - b.getTime());
  const start = sortedTimes[0];
  const end = sortedTimes[sortedTimes.length - 1];

  return {
    start: start.toISOString().split('T')[0], // YYYY-MM-DD format for Open Meteo
    end: end.toISOString().split('T')[0]
  };
}

/**
 * Validate if a time string is in proper ISO 8601 format
 */
export function isValidTimeFormat(timeStr: string): boolean {
  if (!timeStr) return false;
  try {
    const date = new Date(timeStr);
    return !isNaN(date.getTime()) && date.getFullYear() >= 1970 && date.getFullYear() <= 2100;
  } catch {
    return false;
  }
}

/**
 * Parse NMAX CSV file (_nmax.csv format)
 * Structure: Time-series observation data where species names are in column headers (typically starting at column 8)
 * Each row represents a time point with observation counts for different species
 */
async function parseNmaxCsv(file: File): Promise<HaplotypeParseResult> {
  const result: HaplotypeParseResult = {
    species: [],
    sites: [],
    data: [],
    errors: [],
    summary: {
      totalSpecies: 0,
      totalSites: 0,
      totalCells: 0,
    },
  };

  try {
    const text = await file.text();
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');

    if (lines.length < 2) {
      result.errors.push('File must have at least header and one data row');
      return result;
    }

    // Parse header row
    const headerValues = parseCSVLine(lines[0]);

    // NMAX files have metadata columns first (Time, Total Observations, etc.)
    // Species names start appearing around column 7-8
    const metadataColumns = [
      'time', 'total observations', 'cumulative observations',
      'all unique organisms observed today', 'new unique organisms today',
      'cumulative new unique organisms', 'cumulative unique species'
    ];

    const speciesIndices: number[] = [];
    const speciesNames: string[] = [];

    // Identify species columns (those that are not metadata columns)
    headerValues.forEach((header, index) => {
      const headerLower = header.toLowerCase().trim();

      // Skip empty headers
      if (!headerLower) return;

      // Check if this is a metadata column
      const isMetadata = metadataColumns.some(meta =>
        headerLower.includes(meta) || meta.includes(headerLower)
      );

      if (!isMetadata && index >= 7) {
        // This is likely a species column (taxon name)
        speciesIndices.push(index);
        speciesNames.push(header.trim());
      }
    });

    if (speciesNames.length === 0) {
      result.errors.push('No species columns found (expected species names in headers after column 7)');
      return result;
    }

    result.species = speciesNames;

    // For NMAX files, we create a single "site" that represents the aggregated observations
    // Each row is a time point, but for presence-absence we just need to know if species was observed
    result.sites = ['Observations'];

    // Create presence-absence data by checking if any row has a non-zero count for each species
    const speciesPresence: Record<string, number> = {};

    // Parse data rows to detect species presence
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);

        if (values.length < speciesIndices[0]) continue; // Skip invalid rows

        // Check each species column for presence (non-zero value)
        speciesIndices.forEach((speciesIndex, idx) => {
          const countStr = values[speciesIndex]?.trim();
          const count = countStr ? parseFloat(countStr) : 0;

          if (!isNaN(count) && count > 0) {
            const speciesName = speciesNames[idx];
            speciesPresence[speciesName] = (speciesPresence[speciesName] || 0) + count;
          }
        });

      } catch (rowError) {
        result.errors.push(`Row ${i}: ${rowError instanceof Error ? rowError.message : 'Parse error'}`);
      }
    }

    // Create presence-absence data (1 if species present, 0 if absent)
    speciesNames.forEach(speciesName => {
      const count = speciesPresence[speciesName] || 0;

      result.data.push({
        species: speciesName,
        site: 'Observations',
        count: count > 0 ? 1 : 0, // Convert to presence (1) or absence (0)
        metadata: {
          credibility: 'UNKNOWN',
          phylum: 'Unknown',
          isInvasive: false,
          invasiveSpeciesName: null,
          redListStatus: 'Not Evaluated',
        },
      });

      if (count > 0) {
        result.summary.totalCells++;
      }
    });

    // Update summary
    result.summary.totalSpecies = result.species.length;
    result.summary.totalSites = 1; // NMAX has one aggregated "site"

    // Sort species alphabetically
    result.species.sort((a, b) => a.localeCompare(b));

    // Fetch taxonomy data from GBIF (no WoRMS fallback for eDNA - GBIF provides georeferenced sightings)
    try {
      const taxonomyMap = await lookupSpeciesBatch(
        result.species,
        5, // maxConcurrent
        undefined, // onProgress
        false // useWormsFallback - disabled for eDNA
      );

      // Update metadata for each cell with taxonomy data
      result.data.forEach(cell => {
        const taxonomy = taxonomyMap.get(cell.species);
        if (taxonomy) {
          cell.metadata.taxonomySource = taxonomy.source;
          cell.metadata.taxonId = taxonomy.taxonId;
          cell.metadata.commonNames = taxonomy.commonNames;
          cell.metadata.fullHierarchy = taxonomy.hierarchy;
          cell.metadata.taxonomyConfidence = taxonomy.confidence;
          cell.metadata.taxonomyRank = getTaxonomyRankAbbreviation(taxonomy.rank);
        }
      });
    } catch (taxonomyError) {
      console.error('⚠️ Taxonomy lookup failed');
      result.errors.push('Taxonomy lookup failed - data will be displayed without taxonomic information');
    }

  } catch (error) {
    result.errors.push(`File parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

/**
 * Parse Haplotype CSV file (_hapl.csv format)
 * Structure: Species names in first column, metadata columns (score, phylum, NNS, RedList_Status),
 * followed by site columns containing numeric haplotype counts
 */
async function parseHaplotypeCsvOriginal(file: File): Promise<HaplotypeParseResult> {
  const result: HaplotypeParseResult = {
    species: [],
    sites: [],
    data: [],
    errors: [],
    summary: {
      totalSpecies: 0,
      totalSites: 0,
      totalCells: 0,
    },
  };

  try {
    const text = await file.text();
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');

    if (lines.length < 2) {
      result.errors.push('File must have at least header and one data row');
      return result;
    }

    // Parse header row
    const headerValues = parseCSVLine(lines[0]);

    // Identify column types
    const metadataColumns = ['score', 'phylum', 'nns', 'redlist_status', 'redlist'];
    const taxonomyColumns = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'date', 'common'];
    const metadataIndices: Record<string, number> = {};
    const siteIndices: number[] = [];
    let speciesColumnIndex = -1;

    headerValues.forEach((header, index) => {
      const headerLower = header.toLowerCase().trim();

      // Skip empty headers
      if (!headerLower) return;

      // Check if this is a metadata column
      const isMetadata = metadataColumns.some(meta =>
        headerLower === meta ||
        headerLower.includes(meta) ||
        (meta === 'redlist' && headerLower.includes('redlist'))
      );

      // Check if this is a taxonomy column (skip these as sites)
      const isTaxonomy = taxonomyColumns.some(tax => headerLower === tax);

      if (isMetadata) {
        // Store metadata column index
        if (headerLower.includes('score')) metadataIndices.score = index;
        else if (headerLower.includes('phylum')) metadataIndices.phylum = index;
        else if (headerLower === 'nns' || headerLower.includes('nns')) metadataIndices.nns = index;
        else if (headerLower.includes('redlist')) metadataIndices.redList = index;
      } else if (isTaxonomy) {
        // Track species column for later use
        if (headerLower === 'species') {
          speciesColumnIndex = index;
        }
        // Skip taxonomy columns - they're not sites
      } else {
        // This is a site column (contains haplotype counts)
        siteIndices.push(index);
      }
    });

    // Extract site names
    result.sites = siteIndices.map(idx => headerValues[idx]);

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);

        if (values.length < 2) continue; // Skip invalid rows

        // Extract species name from the species column
        const speciesName = speciesColumnIndex >= 0
          ? values[speciesColumnIndex]?.trim()
          : values[0]?.trim(); // Fallback to first column if species column not found

        if (!speciesName) continue;

        result.species.push(speciesName);

        // Extract metadata
        const metadata: HaplotypeMetadata = {
          credibility: metadataIndices.score !== undefined
            ? (values[metadataIndices.score]?.trim().toUpperCase() || 'UNKNOWN')
            : 'UNKNOWN',
          phylum: metadataIndices.phylum !== undefined
            ? (values[metadataIndices.phylum]?.trim() || 'Unknown')
            : 'Unknown',
          isInvasive: false,
          invasiveSpeciesName: null,
          redListStatus: metadataIndices.redList !== undefined
            ? (values[metadataIndices.redList]?.trim() || 'Not Evaluated')
            : 'Not Evaluated',
        };

        // Check NNS (Non-Native Species) column for invasive status
        if (metadataIndices.nns !== undefined) {
          const nnsValue = values[metadataIndices.nns]?.trim();
          if (nnsValue && nnsValue !== 'NA' && nnsValue !== 'N/A' && nnsValue !== '') {
            metadata.isInvasive = true;
            metadata.invasiveSpeciesName = nnsValue;
          }
        }

        // Extract site data (haplotype counts)
        siteIndices.forEach(siteIndex => {
          const siteName = headerValues[siteIndex];
          const countStr = values[siteIndex]?.trim();
          const count = countStr ? parseFloat(countStr) : 0;

          // Only add cells with valid counts
          if (!isNaN(count)) {
            result.data.push({
              species: speciesName,
              site: siteName,
              count: count,
              metadata: { ...metadata }, // Clone metadata for each cell
            });
            result.summary.totalCells++;
          }
        });

      } catch (rowError) {
        result.errors.push(`Row ${i}: ${rowError instanceof Error ? rowError.message : 'Parse error'}`);
      }
    }

    // Update summary
    result.summary.totalSpecies = result.species.length;
    result.summary.totalSites = result.sites.length;

    // Sort species alphabetically (as specified: 2A)
    result.species.sort((a, b) => a.localeCompare(b));

    // Fetch taxonomy data from GBIF (no WoRMS fallback for eDNA - GBIF provides georeferenced sightings)
    try {
      const taxonomyMap = await lookupSpeciesBatch(
        result.species,
        5, // maxConcurrent
        undefined, // onProgress
        false // useWormsFallback - disabled for eDNA
      );

      // Update metadata for each cell with taxonomy data
      result.data.forEach(cell => {
        const taxonomy = taxonomyMap.get(cell.species);
        if (taxonomy) {
          cell.metadata.taxonomySource = taxonomy.source;
          cell.metadata.taxonId = taxonomy.taxonId;
          cell.metadata.commonNames = taxonomy.commonNames;
          cell.metadata.fullHierarchy = taxonomy.hierarchy;
          cell.metadata.taxonomyConfidence = taxonomy.confidence;
          cell.metadata.taxonomyRank = getTaxonomyRankAbbreviation(taxonomy.rank);
        }
      });
    } catch (taxonomyError) {
      console.error('⚠️ Taxonomy lookup failed');
      result.errors.push('Taxonomy lookup failed - data will be displayed without taxonomic information');
    }

  } catch (error) {
    result.errors.push(`File parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

/**
 * Universal parser for HAPL and NMAX files
 * Detects file type by filename and routes to appropriate parser
 *
 * @param file - CSV file to parse (_hapl.csv or _nmax.csv)
 * @returns HaplotypeParseResult with presence-absence data
 */
export async function parseHaplotypeCsv(file: File): Promise<HaplotypeParseResult> {
  const fileName = file.name.toLowerCase();

  // Detect file type by filename pattern
  if (fileName.includes('_nmax') || fileName.includes('_nmx')) {
    // NMAX format: Species in column headers (starting ~column 8)
    return parseNmaxCsv(file);
  } else if (fileName.includes('_hapl')) {
    // HAPL format: Species in first column, sites in headers
    return parseHaplotypeCsvOriginal(file);
  } else {
    // Default to HAPL format for unknown file types
    console.warn(`Unknown file type for presence-absence: ${file.name}, defaulting to HAPL parser`);
    return parseHaplotypeCsvOriginal(file);
  }
}
