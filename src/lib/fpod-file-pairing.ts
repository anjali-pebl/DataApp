import type { PinFile } from '@/lib/supabase/file-storage-service';

export interface FpodFilePair {
  baseName: string;
  stdFile: (PinFile & { pinLabel: string }) | null;
  avgFile: (PinFile & { pinLabel: string }) | null;
  isPaired: boolean;
}

export interface PairedTimelineEntry {
  displayFile: PinFile & { pinLabel: string };
  pairedFile: (PinFile & { pinLabel: string }) | null;
  isPaired: boolean;
}

/**
 * Strips `_std` or `_24hr` suffix (before `.csv`) to get the shared base name.
 * Returns null if neither suffix matches.
 *
 * Example: "ALGA_FPOD_C_W_2406_2407_std.csv" -> "ALGA_FPOD_C_W_2406_2407"
 * Example: "ALGA_FPOD_C_W_2406_2407_24hr.csv" -> "ALGA_FPOD_C_W_2406_2407"
 */
export function getFpodBaseName(fileName: string): string | null {
  const lower = fileName.toLowerCase();

  // Match _std before extension
  const stdMatch = lower.match(/^(.+)_std(\.\w+)?$/);
  if (stdMatch) {
    // Return the original casing for the base name portion
    return fileName.slice(0, stdMatch[1].length);
  }

  // Match _24hr before extension
  const avgMatch = lower.match(/^(.+)_24hr(\.\w+)?$/);
  if (avgMatch) {
    return fileName.slice(0, avgMatch[1].length);
  }

  return null;
}

/**
 * Returns the FPOD suffix type: 'std', '24hr', or null
 */
export function getFpodSuffix(fileName: string): 'std' | '24hr' | null {
  const lower = fileName.toLowerCase();
  if (/_std(\.\w+)?$/.test(lower)) return 'std';
  if (/_24hr(\.\w+)?$/.test(lower)) return '24hr';
  return null;
}

type PinFileWithLabel = PinFile & { pinLabel: string };

/**
 * Groups FPOD files by base name into pairs.
 * Returns paired groups and any unpaired files.
 */
export function pairFpodFiles(files: PinFileWithLabel[]): {
  paired: FpodFilePair[];
  unpaired: PinFileWithLabel[];
} {
  const baseNameMap = new Map<string, FpodFilePair>();
  const unpaired: PinFileWithLabel[] = [];

  for (const file of files) {
    const baseName = getFpodBaseName(file.fileName);
    const suffix = getFpodSuffix(file.fileName);
    console.log('[FPOD-PAIRING] File analysis:', {
      fileName: file.fileName,
      baseName,
      suffix,
    });
    if (!baseName) {
      unpaired.push(file);
      continue;
    }

    if (!baseNameMap.has(baseName)) {
      baseNameMap.set(baseName, {
        baseName,
        stdFile: null,
        avgFile: null,
        isPaired: false,
      });
    }

    const pair = baseNameMap.get(baseName)!;
    if (suffix === 'std') {
      pair.stdFile = file;
    } else if (suffix === '24hr') {
      pair.avgFile = file;
    }
  }

  // Determine which are truly paired vs single
  const paired: FpodFilePair[] = [];
  for (const pair of baseNameMap.values()) {
    pair.isPaired = pair.stdFile !== null && pair.avgFile !== null;
    if (pair.isPaired) {
      paired.push(pair);
    } else {
      // Not a true pair - add the existing file to unpaired
      if (pair.stdFile) unpaired.push(pair.stdFile);
      if (pair.avgFile) unpaired.push(pair.avgFile);
    }
  }

  return { paired, unpaired };
}

/**
 * Converts files into timeline entries, consolidating paired FPOD files.
 * Paired files use `_std` as the representative display file.
 * Unpaired files pass through as normal entries.
 */
export function createPairedTimelineEntries(
  files: PinFileWithLabel[]
): PairedTimelineEntry[] {
  const { paired, unpaired } = pairFpodFiles(files);

  const entries: PairedTimelineEntry[] = [];

  // Add paired entries - use std file as the display representative
  for (const pair of paired) {
    entries.push({
      displayFile: pair.stdFile!,
      pairedFile: pair.avgFile!,
      isPaired: true,
    });
  }

  // Add unpaired entries
  for (const file of unpaired) {
    entries.push({
      displayFile: file,
      pairedFile: null,
      isPaired: false,
    });
  }

  return entries;
}
